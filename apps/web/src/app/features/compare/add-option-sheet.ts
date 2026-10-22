import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { API_LIMITS, type FoodSearchResult, type MenuDish } from '@food/shared';
import { AiAvailability } from '../../core/ai-availability.service';
import { KeyboardPrimer } from '../../core/keyboard-primer';
import { ToastService } from '../../core/toast.service';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { FoodThumb } from '../../shared/ui/food-thumb';
import { Icon } from '../../shared/ui/icon';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { VoiceButton } from '../../shared/ui/voice-button';
import { foodUseSummary } from '../../shared/utils/food-library';
import { formatNumber, formatNutrientValue } from '../../shared/utils/format';
import { amountLine, toPortion } from '../../shared/utils/portion';
import { appendTranscript } from '../../shared/utils/voice-text';
import { FOOD_SEARCH_SCOPE, FoodSearchStore } from '../log/food-search.store';
import { DESCRIPTION_PLACEHOLDERS } from '../log/log-helpers';
import { BlobImage } from './blob-image';
import { MAX_OPTIONS, cleanName } from './compare-model';
import { BEST_FIT_LABEL, rankOptions, type CalorieFit } from './compare-ranking';
import { CompareStore, MENU_PHOTOS_MAX, menuStage, type PhotoMode } from './compare.store';

export type SheetStep = 'sources' | 'search' | 'describe' | 'menu' | 'dishes';
export type PickSource = 'camera' | 'gallery';

export interface PhotoPick {
  readonly mode: PhotoMode;
  readonly source: PickSource;
}

interface DishRow {
  readonly index: number;
  readonly dish: MenuDish;
  readonly kcal: string;
  readonly protein: string;
  readonly amount: string;
  readonly fit: CalorieFit | null;
  readonly top: boolean;
  readonly added: boolean;
}

const TITLES: Record<SheetStep, string> = {
  sources: 'Add an option',
  search: 'Search my foods',
  describe: 'Describe it',
  menu: 'Scan a menu',
  dishes: 'Pick dishes',
};

const FIT_TONES: Record<CalorieFit, string> = {
  fits: 'text-ok',
  close: 'text-warn',
  over: 'text-danger',
};

export const FULL_MESSAGE = `You can compare up to ${MAX_OPTIONS} options. Remove one to add another.`;

@Component({
  selector: 'app-add-option-sheet',
  imports: [BlobImage, BottomSheet, FoodThumb, Icon, Skeleton, Spinner, VoiceButton],
  providers: [FoodSearchStore, { provide: FOOD_SEARCH_SCOPE, useValue: 'standalone' }],
  templateUrl: './add-option-sheet.html',
})
export class AddOptionSheet {
  protected readonly ai = inject(AiAvailability);
  protected readonly store = inject(CompareStore);
  protected readonly search = inject(FoodSearchStore);
  private readonly primer = inject(KeyboardPrimer);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly sheet = viewChild.required(BottomSheet);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly describeInput = viewChild<ElementRef<HTMLTextAreaElement>>('describeInput');
  private readonly voice = viewChild(VoiceButton);
  private readonly menuCamera = viewChild<ElementRef<HTMLInputElement>>('menuCamera');
  private readonly menuGallery = viewChild<ElementRef<HTMLInputElement>>('menuGallery');
  private describeSent = false;

  readonly now = input(0);
  readonly pickPhoto = output<PhotoPick>();
  readonly scanBarcode = output<void>();

  protected readonly open = signal(false);
  protected readonly step = signal<SheetStep>('sources');
  protected readonly describeText = signal('');
  protected readonly menuNote = signal('');
  protected readonly picked = signal<ReadonlySet<number>>(new Set());
  protected readonly descriptionMax = API_LIMITS.descriptionMax;
  protected readonly describePlaceholder = DESCRIPTION_PLACEHOLDERS.text;
  protected readonly menuPhotosMax = MENU_PHOTOS_MAX;
  protected readonly fullMessage = FULL_MESSAGE;
  protected readonly fitTones = FIT_TONES;
  protected readonly bestFitLabel = BEST_FIT_LABEL;

  readonly isOpen = this.open.asReadonly();

  protected readonly title = computed(() => TITLES[this.step()]);
  protected readonly full = computed(() => this.store.freeSlots() <= 0);
  protected readonly voiceBusy = computed(() => this.voice()?.busy() ?? false);
  protected readonly canDescribe = computed(
    () => this.describeText().trim().length > 0 && !this.voiceBusy(),
  );
  protected readonly menu = this.store.menu;
  protected readonly menuSeconds = computed(() => {
    const menu = this.menu();
    return menu.status === 'scanning'
      ? Math.max(0, Math.floor((this.now() - menu.startedAt) / 1000))
      : 0;
  });
  protected readonly menuStageText = computed(() => menuStage(this.menuSeconds()));
  protected readonly menuFailure = computed(() => {
    const menu = this.menu();
    return menu.status === 'failed' ? menu.failure : null;
  });
  protected readonly lastMenu = this.store.lastMenu;
  protected readonly dishRows = computed<DishRow[]>(() => {
    const menu = this.lastMenu();
    if (!menu) {
      return [];
    }
    const added = new Set(
      this.store
        .options()
        .filter((option) => option.source === 'menu')
        .map((option) => option.name),
    );
    const budget = this.store.budget();
    const ranking =
      budget && menu.dishes.length > 0
        ? rankOptions(
            menu.dishes.map((dish, index) => ({ id: String(index), nutrients: dish.nutrients })),
            { budget, hour: new Date(this.now() || Date.now()).getHours() },
          )
        : null;
    return menu.dishes.map((dish, index) => {
      const ranked = ranking?.options[index] ?? null;
      return {
        index,
        dish,
        kcal: formatNutrientValue('calories', dish.nutrients.calories),
        protein: formatNumber(dish.nutrients.protein),
        amount: amountLine(toPortion(dish.portion), dish.grams),
        fit: ranked?.fit ?? null,
        top: ranked?.best === true && ranked.fit !== 'over',
        added: added.has(cleanName(dish.name, 'Dish')),
      };
    });
  });
  protected readonly pickLimit = computed(() => this.store.freeSlots());
  protected readonly pickCount = computed(() => this.picked().size);
  protected readonly pickHint = computed(() => {
    const limit = this.pickLimit();
    if (limit <= 0) {
      return this.fullMessage;
    }
    const left = limit - this.pickCount();
    if (left <= 0) {
      return `That's the maximum. Unselect one to pick another.`;
    }
    return `Pick up to ${limit} to compare.`;
  });

  constructor() {
    effect(() => {
      const active = this.open() && this.step() === 'search';
      untracked(() => (active ? this.search.activate() : this.search.deactivate()));
    });
    effect(() => {
      if (!this.open()) {
        untracked(() => this.voice()?.cancel());
      }
    });
  }

  show(step: SheetStep = 'sources'): void {
    this.picked.set(new Set());
    if (this.describeSent) {
      this.describeSent = false;
      this.describeText.set('');
    }
    this.goTo(step);
    this.open.set(true);
  }

  close(): void {
    this.sheet().close();
  }

  protected goTo(step: SheetStep): void {
    if (step === 'search' || step === 'describe') {
      this.primer.prime();
    }
    if (step !== 'dishes') {
      this.picked.set(new Set());
    }
    this.step.set(step);
    if (step === 'search' || step === 'describe') {
      afterNextRender(() => this.focusField(step), { injector: this.injector });
    }
  }

  protected startScan(): void {
    if (this.guardFull()) {
      return;
    }
    this.close();
    this.scanBarcode.emit();
  }

  protected choosePhoto(mode: PhotoMode, source: PickSource): void {
    if (this.guardFull()) {
      return;
    }
    this.close();
    this.pickPhoto.emit({ mode, source });
  }

  protected onSearchInput(event: Event): void {
    this.search.setText((event.target as HTMLInputElement).value);
  }

  protected addResult(result: FoodSearchResult): void {
    if (this.guardFull()) {
      return;
    }
    if (this.store.addFromLibrary(result)) {
      this.close();
    }
  }

  protected describeInstead(): void {
    const query = this.search.query();
    this.describeSent = false;
    if (query) {
      this.describeText.set(query);
    }
    this.goTo('describe');
  }

  protected onDescribeInput(event: Event): void {
    this.describeText.set((event.target as HTMLTextAreaElement).value);
  }

  protected addTranscript(transcript: string): void {
    this.describeText.update((text) => appendTranscript(text, transcript, this.descriptionMax));
  }

  protected submitDescription(event?: Event): void {
    event?.preventDefault();
    if (!this.canDescribe() || this.guardFull()) {
      return;
    }
    if (this.store.describe(this.describeText())) {
      this.describeSent = true;
      this.close();
    }
  }

  protected takeMenuPhoto(): void {
    this.openPicker(this.menuCamera()?.nativeElement);
  }

  protected chooseMenuPhotos(): void {
    this.openPicker(this.menuGallery()?.nativeElement);
  }

  protected onMenuFiles(input: HTMLInputElement): void {
    const files: File[] = [];
    for (let index = 0; input.files && index < input.files.length; index++) {
      const file = input.files.item(index);
      if (file) {
        files.push(file);
      }
    }
    input.value = '';
    if (files.length === 0) {
      return;
    }
    const skipped = this.store.addMenuPhotos(files);
    if (skipped > 0) {
      this.toast.info(
        `A menu scan takes up to ${MENU_PHOTOS_MAX} photos, so ${skipped === 1 ? '1 photo was' : `${skipped} photos were`} left out.`,
      );
    }
  }

  protected onMenuNote(event: Event): void {
    this.menuNote.set((event.target as HTMLInputElement).value);
  }

  protected async findDishes(): Promise<void> {
    const found = await this.store.scanMenu(this.menuNote());
    if (!found) {
      return;
    }
    this.menuNote.set('');
    if (this.open() && this.step() === 'menu') {
      this.goTo('dishes');
    }
  }

  protected toggleDish(index: number): void {
    const current = this.picked();
    const next = new Set(current);
    if (next.has(index)) {
      next.delete(index);
    } else if (next.size < this.pickLimit()) {
      next.add(index);
    } else {
      return;
    }
    this.picked.set(next);
  }

  protected addPicked(): void {
    const menu = this.lastMenu();
    if (!menu) {
      return;
    }
    const dishes = [...this.picked()]
      .sort((a, b) => a - b)
      .map((index) => menu.dishes[index])
      .filter((dish): dish is MenuDish => dish !== undefined);
    if (this.store.addDishes(dishes) > 0) {
      this.close();
    }
  }

  protected summary(result: FoodSearchResult): string {
    return foodUseSummary(result);
  }

  private guardFull(): boolean {
    if (!this.full()) {
      return false;
    }
    this.toast.info(FULL_MESSAGE);
    return true;
  }

  private openPicker(input: HTMLInputElement | undefined): void {
    if (!input) {
      return;
    }
    input.value = '';
    input.click();
  }

  private focusField(step: SheetStep): void {
    if (!this.open() || this.step() !== step) {
      return;
    }
    const field =
      step === 'search' ? this.searchInput()?.nativeElement : this.describeInput()?.nativeElement;
    field?.focus({ preventScroll: true });
  }
}
