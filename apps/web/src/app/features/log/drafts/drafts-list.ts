import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { BottomSheet } from '../../../shared/ui/bottom-sheet';
import { Icon, type IconName } from '../../../shared/ui/icon';
import { Spinner } from '../../../shared/ui/spinner';
import { formatNumber } from '../../../shared/utils/format';
import { DraftActions } from './draft-actions';
import { draftStateLabel, type DraftRow } from './draft-rows';
import { DraftsStore } from './drafts.store';

export type DraftsListVariant = 'card' | 'section';

const MODE_ICONS: Record<DraftRow['mode'], IconName> = {
  food_photo: 'camera',
  nutrition_label: 'label',
  text: 'text',
};

interface DraftView {
  row: DraftRow;
  state: string;
  summary: string;
  ready: boolean;
  tone: string;
  icon: IconName;
  label: string;
  more: number;
}

function stateTone(row: DraftRow): string {
  switch (row.upload) {
    case 'waiting':
    case 'uploading':
      return 'text-warn';
    case 'failed':
      return 'text-danger';
    default:
      return row.analysed ? 'text-brand' : 'text-muted';
  }
}

function shortState(row: DraftRow, state: string): string {
  if (row.upload !== 'saved' || !row.analysed || row.calories === null) {
    return state;
  }
  const kcal = `${formatNumber(row.calories)} kcal`;
  return row.amount ? `${row.amount} · ${kcal}` : kcal;
}

function toView(row: DraftRow): DraftView {
  const state = draftStateLabel(row);
  return {
    row,
    state: shortState(row, state),
    summary: state,
    ready: row.upload === 'saved' && row.analysed,
    tone: stateTone(row),
    icon: MODE_ICONS[row.mode],
    label: `${row.title}, ${row.when}, ${state}`,
    more: Math.max(0, row.photoCount - 1),
  };
}

@Component({
  selector: 'app-drafts-list',
  imports: [BottomSheet, Icon, RouterLink, Spinner],
  host: { class: 'block empty:hidden' },
  templateUrl: './drafts-list.html',
  styleUrl: './drafts-list.css',
})
export class DraftsList {
  private readonly store = inject(DraftsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly actions = inject(DraftActions);

  readonly variant = input<DraftsListVariant>('section');
  readonly limit = input<number | null>(null);
  readonly reveal = input(false);

  private readonly selectedKey = signal<string | null>(null);
  protected readonly selected = computed(() => {
    const key = this.selectedKey();
    const row = key === null ? null : this.store.rows().find((candidate) => candidate.key === key);
    return row ? toView(row) : null;
  });
  protected readonly sheetOpen = signal(false);
  protected readonly count = this.store.count;
  protected readonly views = computed(() => {
    const rows = this.store.rows();
    const limit = this.limit();
    return (limit === null ? rows : rows.slice(0, limit)).map(toView);
  });
  protected readonly hidden = computed(() => Math.max(0, this.count() - this.views().length));
  protected readonly titleId = `drafts-title-${Math.random().toString(36).slice(2, 8)}`;
  private revealed = false;

  constructor() {
    this.store.activate();
    effect(() => {
      if (this.sheetOpen() && this.selected() === null) {
        untracked(() => this.sheetOpen.set(false));
      }
    });
    afterRenderEffect(() => {
      if (!this.reveal() || this.views().length === 0 || this.revealed) {
        return;
      }
      untracked(() => {
        this.revealed = true;
        const heading = this.host.nativeElement.querySelector<HTMLElement>('[data-drafts-title]');
        heading?.scrollIntoView?.({ block: 'center' });
        heading?.focus({ preventScroll: true });
      });
    });
  }

  protected open(view: DraftView, analyze = false): void {
    this.sheetOpen.set(false);
    this.actions.open(view.row, analyze);
  }

  protected showActions(view: DraftView): void {
    this.selectedKey.set(view.row.key);
    this.sheetOpen.set(true);
  }

  protected async remove(view: DraftView): Promise<void> {
    this.sheetOpen.set(false);
    await this.actions.remove(view.row);
  }

  protected async retryUpload(view: DraftView): Promise<void> {
    this.sheetOpen.set(false);
    await this.actions.retry(view.row);
  }
}
