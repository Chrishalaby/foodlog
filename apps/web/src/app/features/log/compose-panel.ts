import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { API_LIMITS, type AnalysisPhotoRef, type ImageRole } from '@food/shared';
import { AuthService } from '../../core/auth.service';
import { CaptureService, type ImageCaptureSource } from '../../core/capture.service';
import { VoiceIntentService } from '../../core/voice-intent.service';
import { Icon } from '../../shared/ui/icon';
import { BarcodeNote } from './barcode/barcode-note';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { Spinner } from '../../shared/ui/spinner';
import { VoiceButton } from '../../shared/ui/voice-button';
import { IMAGE_ROLE_LABELS } from '../../shared/utils/entry-photos';
import { appendTranscript } from '../../shared/utils/voice-text';
import { photoTimeLabel } from './entry-timing';
import type { AnalyzeFailureKind } from './analyze-errors';
import { ErrorCard } from './error-card';
import {
  DESCRIPTION_HELP,
  DESCRIPTION_PLACEHOLDERS,
  hasHint,
  hintsFor,
  mentionsAmount,
  otherRole,
  preciseDetail,
  toggleHint,
} from './log-helpers';
import { LogStore, MAX_PHOTOS, type DraftPhoto, type PhotoMode } from './log.store';
import { AfterMidnightNote } from './after-midnight-note';
import { PhotoTimeNote } from './photo-time-note';
import { StickyActions } from './sticky-actions';
import { ToggleRow } from '../../shared/ui/toggle-row';

const COMPOSE_TITLES = {
  food_photo: 'Food photo',
  nutrition_label: 'Nutrition label',
  text: 'Describe your meal',
} as const;

@Component({
  selector: 'app-compose-panel',
  imports: [
    AfterMidnightNote,
    BarcodeNote,
    ErrorCard,
    Icon,
    PhotoTimeNote,
    SegmentedControl,
    Spinner,
    StickyActions,
    ToggleRow,
    VoiceButton,
  ],
  host: { class: 'block animate-fade-in' },
  templateUrl: './compose-panel.html',
})
export class ComposePanel {
  private readonly capture = inject(CaptureService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly store = inject(LogStore);
  protected readonly isAdmin = inject(AuthService).isAdmin;

  readonly close = output<void>();
  readonly manual = output<void>();
  readonly saveDraft = output<void>();

  private readonly timeInput = viewChild<ElementRef<HTMLInputElement>>('timeInput');
  private readonly voice = viewChild(VoiceButton);
  private timeFocusPending = false;

  protected readonly voiceRequested = inject(VoiceIntentService).take();
  protected readonly voiceBusy = computed(() => this.voice()?.busy() ?? false);

  protected readonly descriptionMax = API_LIMITS.descriptionMax;
  protected readonly maxPhotos = MAX_PHOTOS;
  protected readonly roleLabels = IMAGE_ROLE_LABELS;
  protected readonly editingTime = signal(false);
  protected readonly brokenThumbs = signal<ReadonlySet<number>>(new Set());
  protected readonly modeOptions: readonly SegmentOption<PhotoMode>[] = [
    { value: 'food_photo', label: 'Food', icon: 'utensils' },
    { value: 'nutrition_label', label: 'Label', icon: 'label' },
  ];
  protected readonly isText = computed(() => this.store.mode() === 'text');
  protected readonly photoMode = computed<PhotoMode>(() => {
    const mode = this.store.mode();
    return mode === 'text' ? 'food_photo' : mode;
  });
  protected readonly photos = this.store.photos;
  protected readonly remotePhotos = this.store.remotePhotos;
  protected readonly fromDraft = computed(() => this.store.attachedDraft() !== null);
  protected readonly showDraftAction = computed(() => this.store.barcode() === null);
  protected readonly draftLabel = computed(() =>
    this.fromDraft() ? 'Update draft' : 'Save for later',
  );
  protected readonly mealTime = computed(() => photoTimeLabel(this.store.dateTime()));
  protected readonly laterKinds: ReadonlySet<AnalyzeFailureKind> = new Set([
    'offline',
    'rate_limited',
    'ai_unavailable',
  ]);
  protected readonly multiple = computed(() => this.photos().length > 1);
  protected readonly title = computed(() => {
    const roles = new Set(this.photos().map((photo) => photo.role));
    return roles.size > 1 ? 'Food & label' : COMPOSE_TITLES[this.store.mode()];
  });
  protected readonly addPrompt = computed(() =>
    this.photos()[0]?.role === 'label'
      ? { title: 'Add another photo', detail: 'The food itself, or another side of the pack' }
      : { title: 'Add a label photo', detail: 'Packaging or nutrition facts, for exact values' },
  );
  protected readonly placeholder = computed(() => DESCRIPTION_PLACEHOLDERS[this.store.mode()]);
  protected readonly help = computed(() => DESCRIPTION_HELP[this.store.mode()]);
  protected readonly hints = computed(() =>
    hintsFor(this.store.mode()).map((hint) => ({
      hint,
      active: hasHint(this.store.description(), hint),
    })),
  );
  protected readonly preciseText = computed(() => preciseDetail(this.store.aiConfig()));
  protected readonly aiUnconfigured = computed(
    () => this.store.aiConfig()?.provider === 'unconfigured',
  );
  protected readonly previewFailed = linkedSignal({
    source: this.store.previewUrl,
    computation: () => false,
  });
  protected readonly descriptionCount = computed(() => this.store.description().length);
  protected readonly needsAmount = computed(() => {
    const description = this.store.description().trim();
    return this.isText() && description.length > 0 && !mentionsAmount(description);
  });
  protected readonly analyzeHint = computed(() => {
    if (this.voiceBusy()) {
      return 'Finish the voice note to continue.';
    }
    if (this.store.canAnalyze()) {
      return null;
    }
    return this.isText() ? 'Describe what you ate to continue.' : 'Add a photo to continue.';
  });

  constructor() {
    afterRenderEffect(() => {
      const input = this.timeInput()?.nativeElement;
      if (input && this.timeFocusPending) {
        untracked(() => {
          this.timeFocusPending = false;
          input.focus();
        });
      }
    });
    afterNextRender(() => {
      if (this.voiceRequested) {
        this.voice()?.start();
      }
    });
  }

  protected editTime(): void {
    this.timeFocusPending = true;
    this.editingTime.set(true);
  }

  protected onTime(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value !== this.store.dateTime()) {
      this.store.setCaptureTime(value);
    }
  }

  protected searchFoods(): void {
    this.capture.openSearch();
  }

  protected scanBarcode(): void {
    this.capture.requestBarcode();
  }

  protected takePhoto(): void {
    this.capture.requestCamera(this.photoMode());
  }

  protected choosePhoto(): void {
    this.capture.requestLibrary(this.photoMode());
  }

  protected addPhoto(source: ImageCaptureSource): void {
    this.capture.requestAddPhoto(source, { max: this.maxPhotos - this.photos().length });
  }

  protected removePhoto(photo: DraftPhoto, index: number): void {
    this.store.removePhoto(photo.id);
    afterNextRender(() => this.focusAfterRemoval(index), { injector: this.injector });
  }

  private focusAfterRemoval(index: number): void {
    const host = this.host.nativeElement;
    const remaining = host.querySelectorAll<HTMLElement>('[data-photo-remove]');
    const target =
      remaining.item(Math.min(index, remaining.length - 1)) ?? host.querySelector('h1');
    target?.focus();
  }

  protected toggleRole(photo: DraftPhoto): void {
    this.store.setPhotoRole(photo.id, otherRole(photo.role));
  }

  protected roleAction(photo: DraftPhoto, index: number): string {
    const next: ImageRole = otherRole(photo.role);
    return `Photo ${index + 1}: ${this.roleLabels[photo.role]}. Mark as ${this.roleLabels[next].toLowerCase()}`;
  }

  protected isFailed(photo: DraftPhoto): boolean {
    return this.store.failedPhotos().has(photo.id);
  }

  protected isBroken(photo: DraftPhoto): boolean {
    return this.brokenThumbs().has(photo.id);
  }

  protected markBroken(photo: DraftPhoto): void {
    this.brokenThumbs.update((ids) => new Set(ids).add(photo.id));
  }

  protected setMode(mode: PhotoMode): void {
    this.store.setMode(mode);
  }

  protected onDescription(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.store.description.set(value.slice(0, this.descriptionMax));
  }

  protected addTranscript(transcript: string): void {
    this.store.description.update((description) =>
      appendTranscript(description, transcript, this.descriptionMax),
    );
  }

  protected toggle(hint: string): void {
    this.store.description.update((description) => toggleHint(description, hint));
  }

  protected analyze(): void {
    void this.store.analyze();
  }

  protected remoteAlt(ref: AnalysisPhotoRef, index: number): string {
    return `Photo ${index + 1}, ${this.roleLabels[ref.role].toLowerCase()}`;
  }
}
