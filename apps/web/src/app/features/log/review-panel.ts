import { Component, computed, inject, output, signal } from '@angular/core';
import { API_LIMITS, type MyFoodDto } from '@food/shared';
import { CaptureService, type ImageCaptureSource } from '../../core/capture.service';
import { Icon } from '../../shared/ui/icon';
import { PhotoStrip } from '../../shared/ui/photo-strip';
import { PhotoViewer } from '../../shared/ui/photo-viewer';
import { BarcodeNote } from './barcode/barcode-note';
import { SaveMyFoodSheet, type SaveMyFoodSeed } from '../../shared/ui/my-foods/save-my-food-sheet';
import { Spinner } from '../../shared/ui/spinner';
import { savedFoodRef } from '../../shared/utils/saved-foods';
import { coverIndex, viewerPhotos, type ViewerPhoto } from '../../shared/utils/entry-photos';
import { formatNutrientValue } from '../../shared/utils/format';
import { CorrectAiCard } from './correct-ai-card';
import { EntryForm } from './entry-form';
import { ErrorCard } from './error-card';
import { FollowUpCard } from './follow-up-card';
import { LabelPanel } from './label-panel';
import { LabelPhotoCard } from './label-photo-card';
import {
  LABEL_HINT_TEXT,
  SOURCE_LABELS,
  correctionPrefix,
  deriveMealName,
  usageLine,
} from './log-helpers';
import { LogStore } from './log.store';
import { StickyActions } from './sticky-actions';
import { ToggleRow } from '../../shared/ui/toggle-row';

export const ASSUMPTIONS_PREVIEW = 3;

@Component({
  selector: 'app-review-panel',
  imports: [
    BarcodeNote,
    CorrectAiCard,
    EntryForm,
    ErrorCard,
    FollowUpCard,
    Icon,
    LabelPanel,
    LabelPhotoCard,
    PhotoStrip,
    PhotoViewer,
    SaveMyFoodSheet,
    Spinner,
    StickyActions,
    ToggleRow,
  ],
  host: { class: 'block animate-fade-in' },
  templateUrl: './review-panel.html',
})
export class ReviewPanel {
  protected readonly store = inject(LogStore);
  private readonly capture = inject(CaptureService);
  private seedSeq = 0;

  readonly discard = output<void>();
  readonly save = output<void>();
  readonly followUp = output<string>();
  readonly recheck = output<void>();
  readonly correct = output<string>();
  readonly saveDraft = output<void>();

  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly photoOpen = signal(false);
  protected readonly photoIndex = signal(0);
  protected readonly coverId = computed(() => this.store.coverPhoto()?.id ?? null);
  protected readonly viewerPhotos = computed<ViewerPhoto[]>(() => {
    const subject = deriveMealName(this.store.name(), this.store.items());
    const photos = this.store.reviewPhotos();
    if (photos.length > 0) {
      return viewerPhotos(photos, subject);
    }
    const url = this.store.photoUrl();
    return url
      ? [{ id: url, url, alt: subject ? `Photo of ${subject}` : 'Meal photo', caption: null }]
      : [];
  });
  protected readonly labelHint = computed(() => {
    const hint = this.store.labelHint();
    return hint ? LABEL_HINT_TEXT[hint] : null;
  });
  protected readonly showAllAssumptions = signal(false);
  protected readonly correctFocus = signal(0);
  protected readonly busy = computed(() => {
    const phase = this.store.phase();
    return phase === 'saving' || phase === 'saved' || this.store.draftSaving();
  });
  protected readonly fromDraft = computed(() => this.store.attachedDraft() !== null);
  protected readonly inBatch = computed(() => this.store.activeMeal() !== null);
  protected readonly closeLabel = computed(() => {
    if (this.inBatch()) {
      return 'Back to all meals';
    }
    return this.fromDraft() ? 'Close draft' : 'Discard meal';
  });
  protected readonly showDraftAction = computed(
    () => !this.store.fromLibrary() && this.store.barcode() === null && !this.inBatch(),
  );
  protected readonly logging = computed(() => {
    const phase = this.store.phase();
    return phase === 'saving' || phase === 'saved';
  });
  protected readonly result = this.store.result;
  protected readonly warnings = computed(() => this.result()?.warnings ?? []);
  protected readonly assumptions = computed(() => this.result()?.assumptions ?? []);
  protected readonly visibleAssumptions = computed(() =>
    this.showAllAssumptions()
      ? this.assumptions()
      : this.assumptions().slice(0, ASSUMPTIONS_PREVIEW),
  );
  protected readonly hiddenAssumptions = computed(() =>
    Math.max(0, this.assumptions().length - ASSUMPTIONS_PREVIEW),
  );
  protected readonly followUpQuestion = computed(() => this.result()?.followUpQuestion ?? null);
  protected readonly usage = computed(() => {
    const analysis = this.store.analysis();
    return analysis ? usageLine(analysis.usage) : null;
  });
  protected readonly subtitle = computed(() => {
    if (this.store.fromLibrary()) {
      return 'From your food library';
    }
    const parts = [SOURCE_LABELS[this.store.source()]];
    const position = this.store.activeMealPosition();
    if (position) {
      parts.unshift(`Meal ${position.index} of ${position.total}`);
    }
    if (this.fromDraft()) {
      parts.unshift('Draft');
    }
    if (this.store.analysis()?.precise) {
      parts.push('Precise');
    }
    return parts.join(' · ');
  });
  protected readonly kcal = computed(() =>
    formatNutrientValue('calories', this.store.totals().calories),
  );
  protected readonly namePlaceholder = computed(
    () => deriveMealName('', this.store.items()) || 'Meal name',
  );
  protected readonly favoritePlaceholder = computed(
    () => deriveMealName(this.store.name(), this.store.items()) || 'Favorite name',
  );
  protected readonly barcodeDetail = computed(() => {
    const plan = this.store.productPlan();
    if (plan?.kind === 'skip') {
      return plan.reason === 'values'
        ? "The per-100 values look off, so this barcode won't be remembered."
        : 'Keep a single item to remember this barcode.';
    }
    return this.store.label()
      ? 'The label values are saved with this barcode.'
      : 'Saved with this food, so the next scan is instant.';
  });
  protected readonly labelSaveable = computed(() => {
    const item = this.store.labelItem();
    return this.store.barcode() === null && item !== null && item.productId === null;
  });
  protected readonly labelSavedName = computed(() => {
    const item = this.store.labelItem();
    return item?.productId ? (item.savedFood?.name ?? item.name) : null;
  });
  protected readonly labelSeed = signal<SaveMyFoodSeed | null>(null);
  protected readonly labelSaveOpen = signal(false);
  protected readonly message = computed(
    () => this.store.visibleValidationError() ?? this.store.saveError() ?? this.store.draftError(),
  );

  protected correctAssumption(assumption: string): void {
    const prefix = correctionPrefix(assumption);
    if (!prefix) {
      return;
    }
    this.store.correction.set(prefix);
    this.store.correctionOpen.set(true);
    this.correctFocus.update((value) => value + 1);
  }

  protected openPhoto(index: number = coverIndex(this.store.reviewPhotos(), this.coverId())): void {
    this.photoIndex.set(index);
    this.photoOpen.set(true);
  }

  protected addLabelPhoto(source: ImageCaptureSource): void {
    this.capture.requestAddPhoto(source, { role: 'label', max: 1 });
  }

  protected saveLabelFood(): void {
    const body = this.store.labelFoodRequest();
    if (!body) {
      return;
    }
    this.labelSeed.set({
      id: ++this.seedSeq,
      name: body.name,
      brand: body.brand ?? null,
      basisUnit: body.basisUnit,
      per100: body.per100,
      microsPer100: body.microsPer100 ?? null,
      unitName: null,
      unitGrams: null,
      servingSizeG: body.servingSizeG ?? null,
      source: 'label',
    });
    this.labelSaveOpen.set(true);
  }

  protected onLabelFoodSaved(food: MyFoodDto): void {
    this.store.linkLabelItem(savedFoodRef(food));
  }

  protected onFavoriteName(event: Event): void {
    this.store.favoriteName.set((event.target as HTMLInputElement).value);
  }
}
