import { Component, computed, inject, output, signal } from '@angular/core';
import type { AdminInviteDto, InviteLinkResponse } from '@food/shared';
import { errorMessage } from '../../core/errors';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { AdminStore } from './admin.store';
import {
  INVITE_STATUS_CLASSES,
  expiryLabel,
  inviteStatusLabel,
  inviteStatusOf,
  personLabel,
  timeAgo,
} from './admin-format';
import { LinkSheet } from './link-sheet';

interface InviteRow {
  invite: AdminInviteDto;
  label: string;
  secondary: string | null;
  statusLabel: string;
  statusClass: string;
  detail: string;
}

export function toInviteRow(invite: AdminInviteDto, now: number = Date.now()): InviteRow {
  const status = inviteStatusOf(invite, now);
  const label = personLabel(invite);
  const created = `Created ${timeAgo(invite.createdAt, now)}${invite.createdByEmail ? ` by ${invite.createdByEmail}` : ''}`;
  const when =
    status === 'pending'
      ? expiryLabel(invite.expiresAt, now)
      : status === 'used' && invite.usedAt
        ? `Used ${timeAgo(invite.usedAt, now)}`
        : inviteStatusLabel(invite, status);
  return {
    invite,
    label,
    secondary: label === invite.email ? null : invite.email,
    statusLabel: inviteStatusLabel(invite, status),
    statusClass: INVITE_STATUS_CLASSES[status],
    detail: `${when} · ${created}`,
  };
}

@Component({
  selector: 'app-invites-tab',
  imports: [EmptyState, Icon, Spinner, LinkSheet],
  template: `
    @if (pending().length === 0) {
      <div class="card">
        <app-empty-state
          icon="mail"
          title="No open invites"
          text="Invite links you create appear here until they’re used, revoked or expire."
        >
          <button type="button" class="btn btn-primary" (click)="invite.emit()">
            <app-icon name="user-plus" [size]="18" />
            Invite someone
          </button>
        </app-empty-state>
      </div>
    } @else {
      <ul class="flex flex-col gap-3" role="list" aria-label="Open invites">
        @for (row of pending(); track row.invite.id) {
          <li class="card animate-fade-in p-4">
            <div class="flex items-start gap-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-full"
                [class]="
                  row.invite.type === 'reset' ? 'bg-warn/15 text-warn' : 'bg-accent/15 text-accent'
                "
                aria-hidden="true"
              >
                <app-icon [name]="row.invite.type === 'reset' ? 'key' : 'mail'" [size]="18" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate font-semibold text-fg">{{ row.label }}</p>
                @if (row.secondary) {
                  <p class="truncate text-sm text-muted">{{ row.secondary }}</p>
                }
                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span class="chip" [class]="row.statusClass">{{ row.statusLabel }}</span>
                  @if (row.invite.type === 'reset') {
                    <span class="chip">Password reset</span>
                  }
                  @if (row.invite.role === 'admin' && row.invite.type === 'invite') {
                    <span class="chip bg-accent/15 text-accent">Admin</span>
                  }
                </div>
                <p class="mt-1.5 text-xs leading-snug text-muted">{{ row.detail }}</p>
              </div>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                class="btn btn-secondary text-danger"
                [attr.aria-label]="'Revoke link for ' + row.label"
                [disabled]="busyId() !== null"
                (click)="revoke(row.invite)"
              >
                Revoke
              </button>
              <button
                type="button"
                class="btn btn-secondary"
                [attr.aria-label]="'New link for ' + row.label"
                [disabled]="busyId() !== null"
                (click)="regenerate(row.invite)"
              >
                @if (busyId() === row.invite.id) {
                  <app-spinner [size]="18" label="Creating a new link" />
                } @else {
                  <app-icon name="refresh" [size]="18" />
                }
                New link
              </button>
            </div>
          </li>
        }
      </ul>
      <p class="mt-3 px-1 text-xs leading-relaxed text-muted">
        Links are only shown once for security. Lost one? Tap “New link” — the old link stops
        working.
      </p>
    }

    @if (past().length > 0) {
      <details class="group card mt-4">
        <summary
          class="flex min-h-12 list-none items-center justify-between gap-3 px-4 py-2 font-semibold text-fg [&::-webkit-details-marker]:hidden"
        >
          <span class="flex items-center gap-2">
            <app-icon class="text-muted" name="history" [size]="18" />
            Past links
            <span class="chip">{{ past().length }}</span>
          </span>
          <app-icon
            class="text-muted transition group-open:rotate-180"
            name="chevron-down"
            [size]="18"
          />
        </summary>
        <ul class="divide-y divide-line/60 border-t border-line/60" role="list">
          @for (row of past(); track row.invite.id) {
            <li class="flex items-start gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-fg">{{ row.label }}</p>
                <p class="text-xs leading-snug text-muted">
                  {{ row.invite.type === 'reset' ? 'Password reset' : 'Invite' }} · {{ row.detail }}
                </p>
              </div>
              <span class="chip shrink-0" [class]="row.statusClass">{{ row.statusLabel }}</span>
            </li>
          }
        </ul>
      </details>
    }

    <app-link-sheet
      heading="New link ready"
      note="The previous link no longer works."
      [(open)]="linkOpen"
      [link]="link()"
    />
  `,
})
export class InvitesTab {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly invite = output<void>();

  protected readonly busyId = signal<string | null>(null);
  protected readonly link = signal<InviteLinkResponse | null>(null);
  protected readonly linkOpen = signal(false);
  protected readonly pending = computed(() => {
    const now = Date.now();
    return this.store.inviteGroups().pending.map((invite) => toInviteRow(invite, now));
  });
  protected readonly past = computed(() => {
    const now = Date.now();
    return this.store.inviteGroups().past.map((invite) => toInviteRow(invite, now));
  });

  protected async regenerate(invite: AdminInviteDto): Promise<void> {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(invite.id);
    try {
      this.link.set(await this.store.regenerateInvite(invite.id));
      this.linkOpen.set(true);
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not create a new link.'));
    } finally {
      this.busyId.set(null);
    }
  }

  protected async revoke(invite: AdminInviteDto): Promise<void> {
    if (this.busyId() !== null) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: 'Revoke this link?',
      message: `The link for ${invite.email} stops working right away.`,
      confirmLabel: 'Revoke',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.store.revokeInvite(invite.id);
      this.toast.success('Link revoked.');
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not revoke the link.'));
    }
  }
}
