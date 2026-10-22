import { Component, computed, inject, output, signal } from '@angular/core';
import type { AdminUserDto } from '@food/shared';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { formatNumber } from '../../shared/utils/format';
import { budgetStatus, formatUsd } from '../settings/usage-math';
import { AdminStore } from './admin.store';
import { filterPeople, initials, personLabel, sortPeople, timeAgo } from './admin-format';
import { PersonSheet } from './person-sheet';

export const PEOPLE_SEARCH_THRESHOLD = 6;

interface PersonRow {
  user: AdminUserDto;
  label: string;
  secondary: string | null;
  initials: string;
  activity: string;
  aiText: string;
  fillPercent: number | null;
  barClass: string;
}

const BAR_CLASSES = { ok: 'bg-brand', warn: 'bg-warn', over: 'bg-danger' } as const;

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export function toPersonRow(user: AdminUserDto, now: number = Date.now()): PersonRow {
  const label = personLabel(user);
  const status = budgetStatus(user.aiCostMonthUsd, user.effectiveBudgetUsd);
  const budget = user.effectiveBudgetUsd;
  const seen = user.lastSeenAt ? `Active ${timeAgo(user.lastSeenAt, now)}` : 'Never signed in';
  return {
    user,
    label,
    secondary: label === user.email ? null : user.email,
    initials: initials(user),
    activity: [
      seen,
      plural(user.entryCount, 'entry', 'entries'),
      plural(user.activeSessions, 'device', 'devices'),
    ].join(' · '),
    aiText: `${plural(user.aiRequestsMonth, 'request', 'requests')} · ${
      budget === null
        ? `${formatUsd(user.aiCostMonthUsd)} · ${user.aiBudgetUnlimited ? 'unlimited' : 'no limit'}`
        : `${formatUsd(user.aiCostMonthUsd)} of ${formatUsd(budget)}`
    }`,
    fillPercent: status ? status.fillPercent : null,
    barClass: status ? BAR_CLASSES[status.level] : 'bg-brand',
  };
}

@Component({
  selector: 'app-people-tab',
  imports: [EmptyState, Icon, PersonSheet],
  template: `
    @if (users().length > searchThreshold) {
      <div class="relative mb-3" role="search">
        <label class="sr-only" for="people-search">Search people</label>
        <span class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted">
          <app-icon name="search" [size]="18" />
        </span>
        <input
          id="people-search"
          type="search"
          class="input pl-10"
          placeholder="Search by name or email"
          autocomplete="off"
          enterkeyhint="search"
          [value]="query()"
          (input)="onSearch($event)"
        />
      </div>
    }

    @if (rows().length === 0) {
      <div class="card">
        <app-empty-state
          icon="search"
          title="Nobody found"
          [text]="
            query() ? 'No one matches “' + query().trim() + '”.' : 'Invite someone to get started.'
          "
        >
          <button type="button" class="btn btn-primary" (click)="invite.emit()">
            <app-icon name="user-plus" [size]="18" />
            Invite someone
          </button>
        </app-empty-state>
      </div>
    } @else {
      <ul class="card divide-y divide-line/60 overflow-hidden" role="list" aria-label="People">
        @for (row of rows(); track row.user.id) {
          <li>
            <button
              type="button"
              class="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2 active:bg-surface-2"
              aria-haspopup="dialog"
              [attr.data-person]="row.user.id"
              (click)="openPerson(row.user)"
            >
              <span
                class="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                [class]="
                  row.user.status === 'disabled'
                    ? 'bg-surface-2 text-muted'
                    : row.user.role === 'admin'
                      ? 'bg-accent/15 text-accent'
                      : 'bg-brand/15 text-brand'
                "
                aria-hidden="true"
              >
                {{ row.initials }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate font-semibold text-fg">{{ row.label }}</span>
                  @if (row.user.isSelf) {
                    <span class="chip shrink-0 bg-brand/15 px-2 py-0.5 text-brand">You</span>
                  }
                  @if (row.user.role === 'admin') {
                    <span class="chip shrink-0 bg-accent/15 px-2 py-0.5 text-accent">Admin</span>
                  }
                  @if (row.user.status === 'disabled') {
                    <span class="chip shrink-0 bg-danger/12 px-2 py-0.5 text-danger">Disabled</span>
                  }
                </span>
                @if (row.secondary) {
                  <span class="block truncate text-xs text-muted">{{ row.secondary }}</span>
                }
                <span class="mt-0.5 block truncate text-xs text-muted">{{ row.activity }}</span>
                <span class="mt-1.5 flex items-center gap-2">
                  @if (row.fillPercent !== null) {
                    <span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span
                        class="block h-full rounded-full"
                        [class]="row.barClass"
                        [style.width.%]="row.fillPercent"
                      ></span>
                    </span>
                  }
                  <span class="shrink-0 text-xs text-muted tabular-nums">
                    <span class="sr-only">AI this month:</span>
                    {{ row.aiText }}
                  </span>
                </span>
              </span>
              <app-icon class="text-muted" name="chevron-right" [size]="18" />
            </button>
          </li>
        }
      </ul>
    }

    <app-person-sheet [(open)]="sheetOpen" [personId]="selectedId()" />
  `,
})
export class PeopleTab {
  private readonly store = inject(AdminStore);

  readonly invite = output<void>();

  protected readonly searchThreshold = PEOPLE_SEARCH_THRESHOLD;
  protected readonly query = signal('');
  protected readonly users = this.store.users;
  protected readonly selectedId = signal<string | null>(null);
  protected readonly sheetOpen = signal(false);
  protected readonly rows = computed(() => {
    const now = Date.now();
    return filterPeople(sortPeople(this.users()), this.query()).map((user) =>
      toPersonRow(user, now),
    );
  });

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected openPerson(user: AdminUserDto): void {
    this.selectedId.set(user.id);
    this.sheetOpen.set(true);
  }
}
