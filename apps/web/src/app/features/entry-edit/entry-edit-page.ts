import { Location } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { API_LIMITS, type EntryDto } from '@food/shared';
import { errorMessage } from '../../core/errors';
import { relativeDayLabel, toTimeLabel } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { registerUnsavedWork } from '../../core/unsaved-work.service';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PhotoStrip } from '../../shared/ui/photo-strip';
import { PhotoViewer } from '../../shared/ui/photo-viewer';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { coverIndex, viewerPhotos } from '../../shared/utils/entry-photos';
import { formatNutrientValue } from '../../shared/utils/format';
import { amountLine, sumGrams } from '../../shared/utils/portion';
import { FavoriteRenameOffer } from '../favorites/favorite-rename-offer';
import { EntryForm } from '../log/entry-form';
import { sameFoodName } from '../log/food-search';
import { SOURCE_LABELS, TODAY_PATH, deriveMealName } from '../log/log-helpers';
import { StickyActions } from '../log/sticky-actions';
import type { UnsavedChangesAware } from '../log/unsaved-changes.guard';
import {
  EntryEditStore,
  renameOfferTitle,
  renamedOthersMessage,
  type RenameOffer,
} from './entry-edit.store';
import { RawAiPanel } from './raw-ai-panel';

@Component({
  selector: 'app-entry-edit-page',
  imports: [
    BottomSheet,
    EmptyState,
    EntryForm,
    Icon,
    PhotoStrip,
    PhotoViewer,
    RawAiPanel,
    RouterLink,
    Skeleton,
    Spinner,
    StickyActions,
  ],
  providers: [EntryEditStore],
  host: { class: 'block', '(window:beforeunload)': 'onBeforeUnload($event)' },
  templateUrl: './entry-edit-page.html',
})
export class EntryEditPage implements UnsavedChangesAware {
  readonly id = input.required<string>();

  protected readonly store = inject(EntryEditStore);
  private readonly toast = inject(ToastService);
  private readonly confirmService = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly renameOffer = inject(FavoriteRenameOffer);
  private leaving = false;

  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly descriptionMax = API_LIMITS.descriptionMax;
  protected readonly photoOpen = signal(false);
  protected readonly photoIndex = signal(0);
  protected readonly coverError = signal<string | null>(null);
  protected readonly favoriteOpen = signal(false);
  protected readonly favoriteName = signal('');
  protected readonly skeletonItems = [0, 1];
  protected readonly entry = this.store.entry;
  protected readonly subtitle = computed(() => {
    const entry = this.entry();
    if (!entry) {
      return '';
    }
    const amount = amountLine(this.store.portion(), sumGrams(this.store.items()));
    return [relativeDayLabel(entry.localDate), toTimeLabel(entry.timestamp), amount]
      .filter((part) => part.length > 0)
      .join(' · ');
  });
  protected readonly sourceLabel = computed(() => {
    const entry = this.entry();
    return entry ? SOURCE_LABELS[entry.source] : '';
  });
  protected readonly showAiDebug = computed(() => {
    const entry = this.entry();
    return entry !== null && entry.source !== 'manual';
  });
  protected readonly viewerPhotos = computed(() =>
    viewerPhotos(this.store.photos(), this.entry()?.name ?? ''),
  );
  protected readonly namePlaceholder = computed(
    () => deriveMealName('', this.store.items()) || 'Meal name',
  );
  protected readonly kcal = computed(() =>
    formatNutrientValue('calories', this.store.totals().calories),
  );
  protected readonly message = computed(
    () => this.store.visibleValidationError() ?? this.store.saveError(),
  );

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.load(id));
    });
    registerUnsavedWork(() => !this.leaving && this.store.dirty());
  }

  canDeactivate(): boolean | Promise<boolean> {
    return this.leaving || !this.store.dirty() ? true : this.confirmDiscardChanges();
  }

  protected reload(): void {
    void this.store.load(this.id());
  }

  protected async back(): Promise<void> {
    if (this.store.dirty() && !(await this.confirmDiscardChanges())) {
      return;
    }
    this.leave();
  }

  protected async save(): Promise<void> {
    const previousName = this.entry()?.name ?? null;
    const updated = await this.store.save();
    if (updated) {
      this.toast.success('Changes saved');
      await this.offerRename(previousName, updated);
      this.leave();
    }
  }

  protected async remove(): Promise<void> {
    const entry = this.entry();
    if (!entry) {
      return;
    }
    const confirmed = await this.confirmService.confirm({
      title: 'Delete this entry?',
      message: `"${entry.name}" will be removed from your log. This can't be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.store.remove();
      this.toast.success(`Deleted ${entry.name}`);
      this.leave();
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't delete this entry. Please try again."));
    }
  }

  protected async logAgain(): Promise<void> {
    if (!(await this.saveIfDirty())) {
      return;
    }
    try {
      const copy = await this.store.logAgain();
      this.toast.success(`Logged ${copy.name} again`, {
        action: { label: 'View', run: () => void this.router.navigate(['/entries', copy.id]) },
      });
      this.leaving = true;
      await this.router.navigateByUrl(TODAY_PATH);
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't log this meal again. Please try again."));
    }
  }

  protected openPhoto(index: number = coverIndex(this.store.photos(), this.store.coverId())): void {
    this.showPhoto(index);
    this.photoOpen.set(true);
  }

  protected showPhoto(index: number): void {
    this.coverError.set(null);
    this.photoIndex.set(index);
  }

  protected async setCover(photoId: string): Promise<void> {
    this.coverError.set(null);
    try {
      await this.store.setCover(photoId);
      this.toast.success('Cover photo updated');
    } catch (err) {
      this.coverError.set(errorMessage(err, "Couldn't change the cover photo. Please try again."));
    }
  }

  protected openFavorite(): void {
    this.favoriteName.set(this.store.name().trim());
    this.favoriteOpen.set(true);
  }

  protected onDescription(event: Event): void {
    this.store.description.set((event.target as HTMLTextAreaElement).value);
  }

  protected submitFavorite(event: Event): void {
    event.preventDefault();
    void this.saveFavorite();
  }

  protected onFavoriteName(event: Event): void {
    this.favoriteName.set((event.target as HTMLInputElement).value);
  }

  private async saveFavorite(): Promise<void> {
    this.favoriteOpen.set(false);
    if (!(await this.saveIfDirty())) {
      return;
    }
    const entryName = this.entry()?.name ?? '';
    try {
      const favorite = await this.store.saveAsFavorite(this.favoriteName());
      this.toast.success(`Added ${favorite.name} to favorites`, {
        action: { label: 'View', run: () => void this.router.navigateByUrl('/favorites') },
      });
      void this.renameOffer.offer(entryName, favorite.name);
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't save the favorite. Please try again."));
    }
  }

  protected async copyRawAi(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.info('AI JSON copied');
    } catch {
      this.toast.error("Couldn't copy to the clipboard.");
    }
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.leaving && this.store.dirty()) {
      event.preventDefault();
    }
  }

  private async saveIfDirty(): Promise<boolean> {
    if (!this.store.dirty()) {
      return true;
    }
    const previousName = this.entry()?.name ?? null;
    const saved = await this.store.save();
    if (!saved) {
      this.toast.error(this.message() ?? 'Fix the highlighted issues first.');
      return false;
    }
    await this.offerRename(previousName, saved);
    return true;
  }

  private async offerRename(previousName: string | null, saved: EntryDto): Promise<void> {
    if (previousName === null || sameFoodName(previousName, saved.name)) {
      return;
    }
    const offer = await this.store.findRenameOffer(previousName, saved.name);
    if (!offer) {
      await this.renameLinkedProduct(saved, previousName);
      return;
    }
    if (!(await this.confirmRename(offer))) {
      return;
    }
    try {
      const result = await this.store.renameOthers(offer);
      if (result.renamedEntries > 0) {
        this.toast.success(renamedOthersMessage(result.renamedEntries, offer.to));
      } else {
        this.toast.info(`No other “${offer.from}” entries were left to rename.`);
      }
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't rename the other entries. Please try again."));
      return;
    }
    await this.renameLinkedProduct(saved, previousName);
    await this.renameLinkedFavorite(saved, previousName);
  }

  private async renameLinkedProduct(saved: EntryDto, previousName: string): Promise<void> {
    try {
      await this.store.renameLinkedProduct(saved, previousName);
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't rename the product too. Please try again."));
    }
  }

  private async renameLinkedFavorite(saved: EntryDto, previousName: string): Promise<void> {
    try {
      await this.store.renameLinkedFavorite(saved, previousName);
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't rename the favorite too. Please try again."));
    }
  }

  private confirmRename(offer: RenameOffer): Promise<boolean> {
    return this.confirmService.confirm({
      title: renameOfferTitle(offer),
      message: 'They will show up as one food in search and quick add.',
      confirmLabel: 'Rename all',
      cancelLabel: 'Just this one',
    });
  }

  private confirmDiscardChanges(): Promise<boolean> {
    return this.confirmService.confirm({
      title: 'Discard changes?',
      message: 'Your edits to this entry will be lost.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
  }

  private leave(): void {
    this.leaving = true;
    if (this.router.lastSuccessfulNavigation()?.previousNavigation) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl(TODAY_PATH);
  }
}
