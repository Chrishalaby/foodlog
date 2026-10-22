import { Location } from '@angular/common';
import {
  Component,
  DOCUMENT,
  ElementRef,
  afterRenderEffect,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CaptureService,
  LOG_PATH,
  type CaptureRequest,
  type PhotoAddition,
} from '../../core/capture.service';
import { DraftSyncService } from '../../core/draft-sync.service';
import { ToastService } from '../../core/toast.service';
import { registerUnsavedWork } from '../../core/unsaved-work.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { FavoriteRenameOffer } from '../favorites/favorite-rename-offer';
import { AnalyzingPanel } from './analyzing-panel';
import { BarcodeFlow } from './barcode/barcode-flow';
import { BarcodeFlowStore, PRODUCT_SAVED, PRODUCT_SKIPPED } from './barcode/barcode-flow.store';
import { CaptureHome } from './capture-home';
import { ComposePanel } from './compose-panel';
import { DRAFTS_PATH, DRAFT_UPLOADING_MESSAGE } from './drafts/draft-actions';
import { DraftResumeHandoff, type DraftResumeRequest } from './drafts/draft-resume';
import { normalizeQuery } from './food-search';
import { FoodSearchStore } from './food-search.store';
import { LibraryActions } from './library-actions';
import { LibraryDraftHandoff } from './library-draft-handoff';
import { MealsPanel } from './meals-panel';
import { TODAY_PATH } from './log-helpers';
import {
  LogStore,
  MAX_PHOTOS,
  type DraftSaveOutcome,
  type LibraryDraft,
  type LogPhase,
  type LogView,
} from './log.store';
import { ReviewPanel } from './review-panel';
import type { UnsavedChangesAware } from './unsaved-changes.guard';

interface DiscardCopy {
  title: string;
  message: string;
  confirmLabel: string;
}

const DISCARD_COPY: Partial<Record<LogPhase, DiscardCopy>> = {
  compose: {
    title: 'Discard this meal?',
    message: 'Your photo and description will be lost.',
    confirmLabel: 'Discard',
  },
  analyzing: {
    title: 'Stop the analysis?',
    message: 'The current analysis will be cancelled.',
    confirmLabel: 'Stop',
  },
  review: {
    title: 'Discard this meal?',
    message: "It hasn't been saved to your log yet.",
    confirmLabel: 'Discard',
  },
};

const DISCARD_MEALS: DiscardCopy = {
  title: 'Discard these meals?',
  message: "They haven't been saved to your log yet.",
  confirmLabel: 'Discard',
};

export function mealsSavedMessage(count: number): string {
  return count === 1 ? 'Saved 1 meal' : `Saved ${count} meals`;
}

export function mealsLeftMessage(name: string, remaining: number): string {
  return `Saved ${name} · ${remaining === 1 ? '1 meal' : `${remaining} meals`} left`;
}

const DISCARD_PHOTOS_MESSAGE = 'Your photos and description will be lost.';

const LEAVE_DRAFT: DiscardCopy = {
  title: 'Leave this draft?',
  message: "It stays in your drafts, but the changes you just made won't be kept.",
  confirmLabel: 'Leave',
};

export const DRAFT_SAVED_MESSAGE = 'Saved to drafts';
export const DRAFT_UPDATED_MESSAGE = 'Draft updated';
export const DRAFT_SAVED_OFFLINE = "Saved on this phone — will upload when you're back online";
export const DRAFT_SAVED_UNREACHABLE = 'Saved on this phone — will upload automatically';
export const DRAFT_SAVED_MEMORY =
  "Saved for now — keep FoodLog open until you're back online so it can upload";

export function draftSavedMessage(outcome: DraftSaveOutcome): string {
  switch (outcome.kind) {
    case 'created':
      return DRAFT_SAVED_MESSAGE;
    case 'updated':
      return DRAFT_UPDATED_MESSAGE;
    default:
      if (!outcome.persisted) {
        return DRAFT_SAVED_MEMORY;
      }
      return outcome.offline ? DRAFT_SAVED_OFFLINE : DRAFT_SAVED_UNREACHABLE;
  }
}

export function photosLeftOutMessage(count: number): string {
  const photos = count === 1 ? '1 photo was' : `${count} photos were`;
  return `A meal takes up to ${MAX_PHOTOS} photos, so ${photos} left out.`;
}

const REPLACE_EDITS: DiscardCopy = {
  title: 'Replace your edits?',
  message:
    'Updating the estimate replaces the items with a new analysis. Meal type and time are kept.',
  confirmLabel: 'Update estimate',
};

@Component({
  selector: 'app-log-page',
  imports: [AnalyzingPanel, BarcodeFlow, CaptureHome, ComposePanel, MealsPanel, ReviewPanel],
  providers: [LogStore, FoodSearchStore, LibraryActions, BarcodeFlowStore],
  host: { class: 'block', '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './log-page.html',
})
export class LogPage implements UnsavedChangesAware {
  readonly q = input<string | undefined>(undefined);
  readonly search = input<string | undefined>(undefined);
  readonly scan = input<string | undefined>(undefined);
  readonly drafts = input<string | undefined>(undefined);

  protected readonly store = inject(LogStore);
  private readonly barcode = inject(BarcodeFlowStore);
  private readonly route = inject(ActivatedRoute);
  private readonly foodSearch = inject(FoodSearchStore);
  private readonly capture = inject(CaptureService);
  private readonly confirmService = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renameOffer = inject(FavoriteRenameOffer);
  private readonly resumeHandoff = inject(DraftResumeHandoff);

  protected readonly searchFocusPending = signal(false);
  private searchPrompt: Promise<void> | null = null;
  private scanPrompt: Promise<void> | null = null;
  private scanReturns = false;

  constructor() {
    const cameFrom = this.previousPath();
    inject(DraftSyncService).start();
    const initial = this.capture.consume();
    const draft = inject(LibraryDraftHandoff).take();
    const resume = this.resumeHandoff.take();
    if (initial) {
      this.store.start(initial);
    } else if (draft) {
      this.store.startFromLibrary(draft);
    } else if (resume) {
      this.applyResume(resume);
    }
    registerUnsavedWork(() => this.store.hasUnsavedWork());
    effect(() => {
      if (this.resumeHandoff.pending()) {
        untracked(() => void this.acceptResume());
      }
    });
    effect(() => {
      if (this.capture.pending()) {
        untracked(() => void this.acceptCapture());
      }
    });
    effect(() => {
      if (this.capture.addition()) {
        untracked(() => void this.acceptAddition());
      }
    });
    effect(() => {
      if (this.capture.searchRequest()) {
        untracked(() => void this.acceptSearch());
      }
    });
    effect(() => {
      if (this.capture.scanRequest()) {
        untracked(() => {
          this.capture.consumeScan();
          void this.openScanner();
        });
      }
    });
    let firstScanCheck = true;
    effect(() => {
      const requested = this.scan() !== undefined;
      untracked(() => {
        if (firstScanCheck) {
          firstScanCheck = false;
          this.scanReturns = requested && cameFrom !== null && cameFrom !== LOG_PATH;
        }
        if (requested) {
          void this.openScanner();
        } else {
          this.barcode.closeScanner();
        }
      });
    });
    let wasScanning = false;
    effect(() => {
      const scanning = this.barcode.scanning();
      untracked(() => {
        if (wasScanning && !scanning) {
          this.leaveScanner();
        }
        wasScanning = scanning;
      });
    });
    effect(() => {
      const query = normalizeQuery(this.q() ?? '');
      const focus = this.search() !== undefined;
      if (query || focus) {
        untracked(() => void this.showSearch(query || null, focus));
      }
    });
    let renderedView: LogView | null = null;
    afterRenderEffect(() => {
      const view = this.store.view();
      untracked(() => {
        if (view !== renderedView && (renderedView !== null || view !== 'idle')) {
          this.onViewRendered();
        }
        renderedView = view;
      });
    });
  }

  canDeactivate(): boolean | Promise<boolean> {
    return this.store.hasUnsavedWork() ? this.confirmDiscard() : true;
  }

  protected startText(description: string): void {
    this.store.start({
      file: null,
      mode: 'text',
      source: 'text',
      ...(description ? { description } : {}),
    });
  }

  protected startManual(): void {
    this.store.startManual();
  }

  protected editDraft(draft: LibraryDraft): void {
    this.store.startFromLibrary(draft);
  }

  protected async discard(): Promise<void> {
    if (this.store.activeMeal()) {
      this.store.closeMeal();
      return;
    }
    if (this.store.hasUnsavedWork() && !(await this.confirmDiscard())) {
      return;
    }
    this.store.discard();
  }

  protected async saveMeals(): Promise<void> {
    const outcome = await this.store.saveMeals();
    if (!outcome) {
      return;
    }
    const count = outcome.entries.length;
    if (count > 0) {
      this.toast.success(mealsSavedMessage(count));
    }
    if (outcome.current && !outcome.failed && !(await this.goToday())) {
      this.store.discard();
    }
  }

  protected async followUp(answer: string): Promise<void> {
    if (!(await this.confirmReplaceEdits())) {
      return;
    }
    await this.store.answerFollowUp(answer);
  }

  protected async correct(text: string): Promise<void> {
    if (!(await this.confirmReplaceEdits())) {
      return;
    }
    await this.store.correct(text);
  }

  protected async recheck(): Promise<void> {
    if (!(await this.confirmReplaceEdits())) {
      return;
    }
    await this.store.recheckPrecise();
  }

  protected async save(): Promise<void> {
    const outcome = await this.store.save();
    if (!outcome) {
      return;
    }
    const { entry } = outcome;
    const saved =
      outcome.remaining > 0
        ? mealsLeftMessage(entry.name, outcome.remaining)
        : `Saved ${entry.name}`;
    this.toast.success(outcome.product === 'saved' ? PRODUCT_SAVED : saved, {
      action: { label: 'View', run: () => void this.router.navigate(['/entries', entry.id]) },
    });
    if (outcome.coverFailed) {
      this.toast.error("The meal was saved, but the cover photo couldn't be changed.");
    }
    if (outcome.favoriteFailed) {
      this.toast.error("The meal was saved, but the favorite couldn't be created.");
    }
    if (outcome.favoriteName !== null) {
      void this.renameOffer.offer(entry.name, outcome.favoriteName);
    }
    if (outcome.product === 'failed') {
      this.toast.error("The meal was saved, but the barcode couldn't be remembered.");
    }
    if (outcome.product === 'skipped') {
      this.toast.info(PRODUCT_SKIPPED);
    }
    if (outcome.current && outcome.remaining === 0 && !(await this.goToday())) {
      this.store.discard();
    }
  }

  protected async saveDraft(): Promise<void> {
    const outcome = await this.store.saveDraft();
    if (!outcome) {
      return;
    }
    const message = draftSavedMessage(outcome);
    const action = {
      label: 'View',
      run: () => void this.router.navigateByUrl(DRAFTS_PATH).catch(() => false),
    };
    if (outcome.kind === 'local') {
      this.toast.info(message, { action });
    } else {
      this.toast.success(message, { action });
    }
    if (!(await this.goToday())) {
      this.store.discard();
    }
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.hasUnsavedWork()) {
      event.preventDefault();
    }
  }

  private async acceptCapture(): Promise<void> {
    const request = this.capture.consume();
    if (!request) {
      return;
    }
    if (this.captureNeedsConfirm(request) && !(await this.confirmDiscard())) {
      return;
    }
    this.store.start(request);
  }

  private async acceptResume(): Promise<void> {
    const request = this.resumeHandoff.take();
    if (!request) {
      return;
    }
    if (this.store.hasUnsavedWork() && !(await this.confirmDiscard())) {
      return;
    }
    this.applyResume(request);
  }

  private applyResume(request: DraftResumeRequest): void {
    if (!this.store.resumeDraft(request.source)) {
      this.toast.info(DRAFT_UPLOADING_MESSAGE);
      return;
    }
    if (request.analyze && this.store.canAnalyze()) {
      void this.store.analyze();
    }
  }

  private async acceptAddition(): Promise<void> {
    const addition = this.capture.consumeAddition();
    if (!addition) {
      return;
    }
    switch (this.store.phase()) {
      case 'compose': {
        const added = this.store.addPhotos(addition.files, addition.source, addition.role);
        const left = addition.files.length + addition.skipped - added;
        if (left > 0) {
          this.toast.info(photosLeftOutMessage(left));
        }
        return;
      }
      case 'review':
        await this.addLabelPhoto(addition);
        return;
      default:
        return;
    }
  }

  private async addLabelPhoto(addition: PhotoAddition): Promise<void> {
    const [file] = addition.files;
    if (!file || !(await this.confirmReplaceEdits())) {
      return;
    }
    await this.store.addLabelPhoto(file, addition.source);
  }

  private openScanner(): Promise<void> {
    if (this.scanPrompt) {
      return this.scanPrompt;
    }
    const prompt = this.leaveForScanner().finally(() => {
      if (this.scanPrompt === prompt) {
        this.scanPrompt = null;
      }
    });
    this.scanPrompt = prompt;
    return prompt;
  }

  private async leaveForScanner(): Promise<void> {
    if (this.barcode.scanning()) {
      return;
    }
    if (this.store.phase() !== 'idle') {
      if (this.store.hasUnsavedWork() && !(await this.confirmDiscard())) {
        this.scanReturns = false;
        this.clearScanParam();
        return;
      }
      this.store.discard();
    }
    this.barcode.openScanner();
  }

  private previousPath(): string | null {
    const previous = this.router.currentNavigation()?.previousNavigation?.finalUrl;
    return previous ? (this.router.serializeUrl(previous).split(/[?#]/)[0] ?? null) : null;
  }

  private leaveScanner(): void {
    const returns = this.scanReturns;
    this.scanReturns = false;
    if (
      returns &&
      this.scan() !== undefined &&
      this.barcode.step().kind === 'idle' &&
      this.store.phase() === 'idle'
    ) {
      this.location.back();
      return;
    }
    this.clearScanParam();
  }

  private clearScanParam(): void {
    if (this.scan() === undefined) {
      return;
    }
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { scan: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(() => false);
  }

  private async acceptSearch(): Promise<void> {
    const request = this.capture.consumeSearch();
    if (request) {
      await this.showSearch(request.query, true);
    }
  }

  private showSearch(query: string | null, focus: boolean): Promise<void> {
    if (this.searchPrompt) {
      return this.searchPrompt;
    }
    const prompt = this.leaveForSearch(query, focus).finally(() => {
      if (this.searchPrompt === prompt) {
        this.searchPrompt = null;
      }
    });
    this.searchPrompt = prompt;
    return prompt;
  }

  private async leaveForSearch(query: string | null, focus: boolean): Promise<void> {
    if (this.store.phase() !== 'idle') {
      if (this.store.hasUnsavedWork() && !(await this.confirmDiscard())) {
        return;
      }
      this.store.discard();
    }
    if (query !== null) {
      this.foodSearch.setText(query);
    }
    if (focus) {
      this.searchFocusPending.set(true);
    }
  }

  private captureNeedsConfirm(request: CaptureRequest): boolean {
    switch (this.store.phase()) {
      case 'analyzing':
        return true;
      case 'meals':
      case 'review':
        return this.store.hasUnsavedWork();
      case 'compose': {
        if (this.store.attachedDraft()) {
          return this.store.hasUnsavedWork();
        }
        const photos = this.store.photos().length;
        return photos > 1 || (request.mode === 'text' && photos > 0);
      }
      default:
        return false;
    }
  }

  private confirmDiscard(): Promise<boolean> {
    const phase = this.store.phase();
    const leavingDraft = this.store.attachedDraft() !== null && phase !== 'analyzing';
    const severalMeals = this.store.meals().length > 1 || phase === 'meals';
    const copy = leavingDraft
      ? LEAVE_DRAFT
      : severalMeals
        ? DISCARD_MEALS
        : (DISCARD_COPY[phase] ?? DISCARD_COPY.review!);
    const message =
      !leavingDraft && phase === 'compose' && this.store.photos().length > 1
        ? DISCARD_PHOTOS_MESSAGE
        : copy.message;
    return this.confirmService.confirm({ ...copy, message, cancelLabel: 'Keep', tone: 'danger' });
  }

  private async confirmReplaceEdits(): Promise<boolean> {
    return !this.store.edited() || this.confirmService.confirm(REPLACE_EDITS);
  }

  private goToday(): Promise<boolean> {
    return this.router.navigateByUrl(TODAY_PATH).catch(() => false);
  }

  private onViewRendered(): void {
    const scroller = this.document.scrollingElement;
    if (scroller) {
      scroller.scrollTop = 0;
    }
    const host = this.host.nativeElement;
    const active = this.document.activeElement;
    if (
      this.searchFocusPending() ||
      (active instanceof HTMLInputElement && host.contains(active))
    ) {
      return;
    }
    host.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }
}
