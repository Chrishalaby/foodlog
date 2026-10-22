import {
  Component,
  DOCUMENT,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DataEventsService } from '../../core/data-events.service';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { Icon, type IconName } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { Spinner } from '../../shared/ui/spinner';
import { BarcodeScanner } from '../log/barcode/barcode-scanner';
import { StickyActions } from '../log/sticky-actions';
import { AddOptionSheet, FULL_MESSAGE, type PhotoPick, type SheetStep } from './add-option-sheet';
import { CompareBudget } from './budget-card';
import { MAX_OPTIONS, MIN_TO_COMPARE, optionNutrients, type OptionPortion } from './compare-model';
import {
  BEST_FIT_LABEL,
  comparisonRows,
  rankOptions,
  type RankContext,
  type RankInput,
} from './compare-ranking';
import { COMPARE_CLOCK, CompareStore, type CompareSlot, type PhotoMode } from './compare.store';
import { CompareTable, type TableColumn } from './compare-table';
import { OptionCard } from './option-card';

type SourceTileId = 'search' | 'barcode' | 'describe' | 'photo' | 'label' | 'menu';

interface SourceTile {
  readonly id: SourceTileId;
  readonly label: string;
  readonly caption: string;
  readonly icon: IconName;
  readonly tone: string;
}

interface PendingPick {
  readonly mode: PhotoMode;
  readonly replaceId: string | null;
}

export const SOURCE_TILES: readonly SourceTile[] = [
  {
    id: 'search',
    label: 'My foods',
    caption: 'Instant',
    icon: 'search',
    tone: 'bg-brand text-brand-fg',
  },
  {
    id: 'barcode',
    label: 'Barcode',
    caption: 'Instant',
    icon: 'barcode',
    tone: 'bg-accent/15 text-accent',
  },
  { id: 'describe', label: 'Describe', caption: 'AI', icon: 'text', tone: 'bg-fat/15 text-fat' },
  { id: 'photo', label: 'Photo', caption: 'AI', icon: 'camera', tone: 'bg-brand/15 text-brand' },
  { id: 'label', label: 'Label', caption: 'AI', icon: 'label', tone: 'bg-carbs/15 text-carbs' },
  {
    id: 'menu',
    label: 'Menu',
    caption: 'AI',
    icon: 'utensils',
    tone: 'bg-protein/15 text-protein',
  },
];

const TICK_BUSY_MS = 1000;
const TICK_IDLE_MS = 60_000;

@Component({
  selector: 'app-compare-page',
  imports: [
    AddOptionSheet,
    BarcodeScanner,
    CompareBudget,
    CompareTable,
    Icon,
    OptionCard,
    PageHeader,
    Spinner,
    StickyActions,
  ],
  templateUrl: './compare-page.html',
})
export class ComparePage {
  protected readonly store = inject(CompareStore);
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private readonly clock = inject(COMPARE_CLOCK);
  private readonly document = inject(DOCUMENT);
  private readonly sheet = viewChild(AddOptionSheet);
  private readonly cameraInput = viewChild.required<ElementRef<HTMLInputElement>>('cameraInput');
  private readonly galleryInput = viewChild.required<ElementRef<HTMLInputElement>>('galleryInput');
  private pendingPick: PendingPick | null = null;

  protected readonly tiles = SOURCE_TILES;
  protected readonly maxOptions = MAX_OPTIONS;
  protected readonly now = signal(this.clock().getTime());
  protected readonly scanning = signal(false);
  protected readonly slots = this.store.slots;
  private readonly today = computed(() => todayLocalDate(new Date(this.now())));

  protected readonly active = computed(() =>
    this.store.options().filter((option) => option.loggedEntryId === null),
  );
  private readonly inputs = computed<RankInput[]>(() =>
    this.active().map((option) => ({ id: option.id, nutrients: optionNutrients(option) })),
  );
  private readonly context = computed<RankContext | null>(() => {
    const budget = this.store.budget();
    return budget ? { budget, hour: new Date(this.now()).getHours() } : null;
  });
  protected readonly ranking = computed(() => {
    const context = this.context();
    const inputs = this.inputs();
    return context && inputs.length > 0 ? rankOptions(inputs, context) : null;
  });
  protected readonly rankedById = computed(
    () => new Map((this.ranking()?.options ?? []).map((ranked) => [ranked.id, ranked])),
  );
  protected readonly winner = computed(() => {
    const ranking = this.ranking();
    const id = ranking?.winnerId;
    const option = id ? this.active().find((candidate) => candidate.id === id) : undefined;
    const ranked = id ? this.rankedById().get(id) : undefined;
    return option && ranked
      ? { option, ranked, label: ranking?.winnerLabel ?? BEST_FIT_LABEL }
      : null;
  });
  protected readonly columns = computed<TableColumn[]>(() => {
    const winnerId = this.ranking()?.winnerId ?? null;
    return this.active().map((option) => ({
      id: option.id,
      name: option.name,
      best: option.id === winnerId,
    }));
  });
  protected readonly rows = computed(() => {
    const inputs = this.inputs();
    return inputs.length >= MIN_TO_COMPARE ? comparisonRows(inputs, this.context()) : [];
  });
  protected readonly hasSlots = computed(() => this.slots().length > 0);
  protected readonly canAdd = computed(() => this.store.freeSlots() > 0);
  protected readonly canClear = computed(
    () => this.hasSlots() || this.store.lastMenu() !== null || this.store.menu().photos.length > 0,
  );
  protected readonly showGrid = computed(() => this.slots().length < MIN_TO_COMPARE);
  protected readonly showSticky = computed(
    () => this.slots().length >= MIN_TO_COMPARE && (this.canAdd() || this.winner() !== null),
  );
  protected readonly sheetOpen = computed(() => this.sheet()?.isOpen() ?? false);
  protected readonly menuScanSeconds = computed(() => {
    const menu = this.store.menu();
    return menu.status === 'scanning'
      ? Math.max(0, Math.floor((this.now() - menu.startedAt) / 1000))
      : 0;
  });
  protected readonly subtitle = computed(() => {
    const count = this.slots().length;
    return count === 0
      ? `Compare up to ${MAX_OPTIONS} options`
      : `${count} of ${MAX_OPTIONS} options`;
  });
  protected readonly statusText = computed(() => {
    const loading = this.slots().filter((slot) => slot.status === 'loading').length;
    if (loading > 0) {
      return loading === 1 ? 'Estimating 1 option' : `Estimating ${loading} options`;
    }
    const winner = this.winner();
    return winner ? `${winner.label}: ${winner.option.name}` : '';
  });
  protected readonly winnerKcal = computed(() => {
    const winner = this.winner();
    return winner ? Math.round(optionNutrients(winner.option).calories) : 0;
  });
  protected readonly winnerAction = computed(() =>
    this.winner()?.label === BEST_FIT_LABEL ? 'Log best fit' : 'Log top pick',
  );

  constructor() {
    this.store.expireStale();
    effect(() => {
      this.events.entries();
      this.events.profile();
      this.today();
      untracked(() => void this.store.loadDay());
    });
    effect((onCleanup) => {
      const interval = this.store.busy() ? TICK_BUSY_MS : TICK_IDLE_MS;
      untracked(() => this.now.set(this.clock().getTime()));
      const timer = setInterval(() => this.now.set(this.clock().getTime()), interval);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected openSheet(step: SheetStep = 'sources'): void {
    if (step !== 'dishes' && step !== 'menu' && this.guardFull()) {
      return;
    }
    this.sheet()?.show(step);
  }

  protected useTile(tile: SourceTile): void {
    switch (tile.id) {
      case 'search':
        this.openSheet('search');
        return;
      case 'describe':
        this.openSheet('describe');
        return;
      case 'menu':
        this.openSheet('menu');
        return;
      case 'barcode':
        this.openScanner();
        return;
      case 'photo':
        this.pickPhoto({ mode: 'food_photo', source: 'camera' });
        return;
      case 'label':
        this.pickPhoto({ mode: 'nutrition_label', source: 'camera' });
        return;
    }
  }

  protected pickPhoto(pick: PhotoPick, replaceId: string | null = null): void {
    if (replaceId === null && this.guardFull()) {
      return;
    }
    const input = (pick.source === 'camera' ? this.cameraInput() : this.galleryInput())
      .nativeElement;
    this.pendingPick = { mode: pick.mode, replaceId };
    input.value = '';
    input.click();
  }

  protected onPhotoChosen(input: HTMLInputElement): void {
    const file = input.files?.item(0) ?? null;
    input.value = '';
    const pick = this.pendingPick;
    this.pendingPick = null;
    if (!file || !pick) {
      return;
    }
    const added = this.store.addPhoto(file, pick.mode, pick.replaceId ?? undefined);
    if (!added && pick.replaceId === null) {
      this.toast.info(FULL_MESSAGE);
    }
  }

  protected openScanner(): void {
    if (!this.guardFull()) {
      this.scanning.set(true);
    }
  }

  protected onBarcode(code: string): void {
    this.scanning.set(false);
    if (!this.store.lookupBarcode(code)) {
      this.toast.info(FULL_MESSAGE);
    }
  }

  protected setPortion(slot: CompareSlot, portion: OptionPortion): void {
    this.store.setPortion(slot.id, portion);
  }

  protected scanLabel(slot: CompareSlot): void {
    this.pickPhoto({ mode: 'nutrition_label', source: 'camera' }, slot.id);
  }

  protected log(slot: CompareSlot): void {
    void this.store.log(slot.id);
  }

  protected logWinner(): void {
    const winner = this.winner();
    if (winner) {
      void this.store.log(winner.option.id);
    }
  }

  protected showOption(id: string): void {
    const card = this.document.getElementById(`compare-${id}`);
    if (typeof card?.scrollIntoView === 'function') {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  private guardFull(): boolean {
    if (this.canAdd()) {
      return false;
    }
    this.toast.info(FULL_MESSAGE);
    return true;
  }
}
