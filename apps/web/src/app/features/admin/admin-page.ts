import {
  Component,
  DOCUMENT,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { KeyboardService } from '../../core/keyboard.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { Skeleton } from '../../shared/ui/skeleton';
import { formatNumber } from '../../shared/utils/format';
import { budgetStatus, formatUsd } from '../settings/usage-math';
import { AdminStore } from './admin.store';
import { InviteSheet } from './invite-sheet';
import { InvitesTab } from './invites-tab';
import { PeopleTab } from './people-tab';
import { RequestsTab } from './requests-tab';

export const ADMIN_TABS = ['requests', 'people', 'invites'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
export const ADMIN_REFRESH_MIN_MS = 5000;

const TAB_LABELS: Record<AdminTab, string> = {
  requests: 'Requests',
  people: 'People',
  invites: 'Invites',
};

const BAR_CLASSES = { ok: 'bg-brand', warn: 'bg-warn', over: 'bg-danger' } as const;

export function parseAdminTab(value: string | null | undefined): AdminTab | null {
  return (ADMIN_TABS as readonly string[]).includes(value ?? '') ? (value as AdminTab) : null;
}

@Component({
  selector: 'app-admin-page',
  imports: [
    RouterLink,
    PageHeader,
    Icon,
    Skeleton,
    EmptyState,
    RequestsTab,
    PeopleTab,
    InvitesTab,
    InviteSheet,
  ],
  providers: [AdminStore],
  templateUrl: './admin-page.html',
  host: { class: 'block' },
})
export class AdminPage {
  private readonly document = inject(DOCUMENT);
  private readonly keyboardOpen = inject(KeyboardService).open;

  protected readonly store = inject(AdminStore);

  readonly tab = input<string>();

  protected readonly tabs = ADMIN_TABS;
  protected readonly tabLabels = TAB_LABELS;
  protected readonly selected = linkedSignal(() => parseAdminTab(this.tab()));
  protected readonly activeTab = computed<AdminTab>(
    () => this.selected() ?? (this.store.pendingRequests() > 0 ? 'requests' : 'people'),
  );
  protected readonly inviteOpen = signal(false);
  protected readonly counts = computed<Record<AdminTab, number>>(() => ({
    requests: this.store.pendingRequests(),
    people: this.store.users().length,
    invites: this.store.pendingInvites(),
  }));
  protected readonly tiles = computed(() => {
    const overview = this.store.overview();
    if (!overview) {
      return [];
    }
    return [
      {
        label: 'People',
        value: formatNumber(overview.users),
        tab: 'people' as AdminTab,
        alert: false,
      },
      {
        label: 'Active 30 d',
        value: formatNumber(overview.activeUsers30d),
        tab: 'people' as AdminTab,
        alert: false,
      },
      {
        label: 'Requests',
        value: formatNumber(overview.pendingRequests),
        tab: 'requests' as AdminTab,
        alert: overview.pendingRequests > 0,
      },
    ];
  });
  protected readonly spend = computed(() => {
    const overview = this.store.overview();
    if (!overview) {
      return null;
    }
    const status = budgetStatus(overview.aiCostMonthUsd, overview.globalBudgetUsd);
    return {
      cost: formatUsd(overview.aiCostMonthUsd),
      requests: `${formatNumber(overview.aiRequestsMonth)} ${overview.aiRequestsMonth === 1 ? 'request' : 'requests'}`,
      status,
      barClass: status ? BAR_CLASSES[status.level] : '',
      budget:
        overview.globalBudgetUsd === null
          ? 'No global budget set'
          : `of ${formatUsd(overview.globalBudgetUsd)} global budget`,
    };
  });
  protected readonly showInviteAction = computed(
    () => this.store.state() === 'ready' && this.activeTab() !== 'requests' && !this.keyboardOpen(),
  );

  constructor() {
    void this.store.load();
    effect(() => {
      if (this.store.state() === 'ready' && this.selected() === null) {
        const initial = this.activeTab();
        untracked(() => this.selected.set(initial));
      }
    });
    const view = this.document.defaultView;
    const onVisible = (): void => {
      if (this.document.visibilityState === 'visible') {
        this.refreshIfStale();
      }
    };
    const onFocus = (): void => this.refreshIfStale();
    this.document.addEventListener('visibilitychange', onVisible);
    view?.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisible);
      view?.removeEventListener('focus', onFocus);
    });
  }

  protected select(tab: AdminTab): void {
    this.selected.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    const count = this.tabs.length;
    const target =
      event.key === 'ArrowRight'
        ? (index + 1) % count
        : event.key === 'ArrowLeft'
          ? (index - 1 + count) % count
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (target === null) {
      return;
    }
    event.preventDefault();
    this.select(this.tabs[target]);
    this.document.getElementById(`admin-tab-${this.tabs[target]}`)?.focus();
  }

  protected openInvite(): void {
    this.inviteOpen.set(true);
  }

  protected retry(): void {
    void this.store.load();
  }

  protected refreshNow(): void {
    void this.store.refresh();
  }

  private refreshIfStale(): void {
    const state = this.store.state();
    if (state === 'error') {
      void this.store.load();
    } else if (
      state === 'ready' &&
      !this.store.refreshing() &&
      this.store.isStale(ADMIN_REFRESH_MIN_MS)
    ) {
      void this.store.refresh();
    }
  }
}
