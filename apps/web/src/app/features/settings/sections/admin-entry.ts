import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminPendingService } from '../../../core/admin-pending.service';
import { AuthService } from '../../../core/auth.service';
import { ADMIN_PATH } from '../../../core/guards';
import { Icon } from '../../../shared/ui/icon';

@Component({
  selector: 'app-admin-entry',
  imports: [RouterLink, Icon],
  host: { class: 'block empty:hidden' },
  template: `
    @if (isAdmin()) {
      <a
        class="card flex min-h-16 items-center gap-3 px-4 py-3 transition active:scale-[0.99]"
        [routerLink]="adminPath"
        [queryParams]="queryParams()"
      >
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
          aria-hidden="true"
        >
          <app-icon name="shield" [size]="20" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block font-semibold text-fg">Admin</span>
          <span class="block truncate text-sm text-muted">{{ summary() }}</span>
        </span>
        @if (pending() > 0) {
          <span
            class="min-w-6 rounded-full bg-warn px-2 text-center text-xs leading-6 font-bold text-bg tabular-nums"
          >
            {{ pending() }}
            <span class="sr-only">pending {{ pending() === 1 ? 'request' : 'requests' }}</span>
          </span>
        }
        <app-icon class="text-muted" name="chevron-right" [size]="18" />
      </a>
    }
  `,
})
export class AdminEntry {
  private readonly auth = inject(AuthService);
  private readonly pendingAccess = inject(AdminPendingService);

  protected readonly adminPath = ADMIN_PATH;
  protected readonly isAdmin = this.auth.isAdmin;
  protected readonly pending = this.pendingAccess.count;
  protected readonly summary = computed(() => {
    const pending = this.pending();
    if (pending > 0) {
      return pending === 1
        ? '1 person is waiting for access'
        : `${pending} people are waiting for access`;
    }
    return 'People, invites and access requests';
  });
  protected readonly queryParams = computed(() => (this.pending() > 0 ? { tab: 'requests' } : {}));

  constructor() {
    this.pendingAccess.reload();
    void this.auth.refresh();
  }
}
