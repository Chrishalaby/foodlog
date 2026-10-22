import { Component, computed, inject, output, signal } from '@angular/core';
import type { AdminAccessRequestDto, AdminUserDto, InviteLinkResponse } from '@food/shared';
import { errorMessage } from '../../core/errors';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { AdminStore } from './admin.store';
import { emailsMatch, initials, timeAgo } from './admin-format';
import { LinkSheet } from './link-sheet';

interface SharedLink {
  request: AdminAccessRequestDto;
  link: InviteLinkResponse;
}

@Component({
  selector: 'app-requests-tab',
  imports: [EmptyState, Icon, Spinner, LinkSheet],
  template: `
    @if (pending().length === 0) {
      <div class="card">
        <app-empty-state
          icon="check"
          title="No pending requests"
          text="When someone asks for access from the sign-in screen, they show up here for you to approve."
        >
          <button type="button" class="btn btn-primary" (click)="invite.emit()">
            <app-icon name="user-plus" [size]="18" />
            Invite someone
          </button>
        </app-empty-state>
      </div>
    } @else {
      <ul class="flex flex-col gap-3" role="list" aria-label="Pending requests">
        @for (request of pending(); track request.id) {
          <li>
            <article
              class="card animate-fade-in p-4"
              [attr.aria-labelledby]="'request-' + request.id"
            >
              <div class="flex items-start gap-3">
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-full bg-warn/15 text-sm font-bold text-warn"
                  aria-hidden="true"
                >
                  {{ initialsOf(request) }}
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="truncate font-semibold text-fg" [id]="'request-' + request.id">
                    {{ request.name }}
                  </h3>
                  <p class="truncate text-sm text-muted">{{ request.email }}</p>
                </div>
                <time
                  class="shrink-0 pt-0.5 text-xs text-muted"
                  [attr.datetime]="request.createdAt"
                >
                  {{ ago(request.createdAt) }}
                </time>
              </div>
              @if (request.message) {
                <p
                  class="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm leading-relaxed break-words whitespace-pre-line text-fg"
                >
                  {{ request.message }}
                </p>
              }
              @if (request.hasAccount) {
                <p class="mt-2 flex items-center gap-1.5 text-xs text-warn">
                  <app-icon name="info" [size]="14" />
                  This email already has an account
                </p>
              }
              @if (request.hasAccount) {
                @if (accountFor(request); as account) {
                  <div class="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      class="btn btn-secondary min-h-12"
                      [attr.aria-label]="'Dismiss ' + request.name"
                      [disabled]="busyId() !== null"
                      (click)="reject(request)"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary min-h-12"
                      [attr.aria-label]="'Send reset link to ' + request.name"
                      [disabled]="busyId() !== null"
                      (click)="sendReset(request, account)"
                    >
                      @if (busyId() === request.id + ':reset') {
                        <app-spinner [size]="18" label="Creating reset link" />
                      } @else {
                        <app-icon name="key" [size]="18" />
                      }
                      Reset link
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
                    class="btn btn-secondary mt-4 min-h-12 w-full"
                    [attr.aria-label]="'Dismiss ' + request.name"
                    [disabled]="busyId() !== null"
                    (click)="reject(request)"
                  >
                    Dismiss
                  </button>
                }
              } @else {
                <div class="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    class="btn btn-secondary min-h-12 text-danger"
                    [attr.aria-label]="'Reject ' + request.name"
                    [disabled]="busyId() !== null"
                    (click)="reject(request)"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    class="btn btn-primary min-h-12"
                    [attr.aria-label]="'Approve ' + request.name"
                    [disabled]="busyId() !== null"
                    (click)="approve(request)"
                  >
                    @if (busyId() === request.id + ':approve') {
                      <app-spinner [size]="18" label="Approving" />
                    } @else {
                      <app-icon name="check" [size]="18" />
                    }
                    Approve
                  </button>
                </div>
              }
            </article>
          </li>
        }
      </ul>
    }

    @if (decided().length > 0) {
      <details class="group card mt-4">
        <summary
          class="flex min-h-12 list-none items-center justify-between gap-3 px-4 py-2 font-semibold text-fg [&::-webkit-details-marker]:hidden"
        >
          <span class="flex items-center gap-2">
            <app-icon class="text-muted" name="history" [size]="18" />
            Decided requests
            <span class="chip">{{ decided().length }}</span>
          </span>
          <app-icon
            class="text-muted transition group-open:rotate-180"
            name="chevron-down"
            [size]="18"
          />
        </summary>
        <ul class="divide-y divide-line/60 border-t border-line/60" role="list">
          @for (request of decided(); track request.id) {
            <li class="flex items-start gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-fg">{{ request.name }}</p>
                <p class="truncate text-xs text-muted">{{ request.email }}</p>
                <p class="mt-0.5 text-xs text-muted">
                  {{ statusVerb(request) }}
                  {{ ago(request.decidedAt ?? request.createdAt) }}
                  @if (request.decidedByEmail) {
                    · by {{ request.decidedByEmail }}
                  }
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1.5">
                <span class="chip" [class]="statusClass(request)">{{ statusLabel(request) }}</span>
                @if (canResend(request)) {
                  <button
                    type="button"
                    class="btn btn-ghost min-h-11 px-2.5 text-sm text-brand"
                    [attr.aria-label]="'New invite link for ' + request.name"
                    [disabled]="busyId() !== null"
                    (click)="approve(request)"
                  >
                    @if (busyId() === request.id + ':approve') {
                      <app-spinner [size]="16" label="Creating link" />
                    }
                    New link
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      </details>
    }

    <app-link-sheet
      [heading]="linkHeading()"
      [(open)]="linkOpen"
      [link]="shared()?.link ?? null"
      [intro]="approvedIntro()"
      [note]="approvedNote()"
    />
  `,
})
export class RequestsTab {
  private readonly store = inject(AdminStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly invite = output<void>();

  protected readonly pending = computed(() => this.store.requestGroups().pending);
  protected readonly decided = computed(() => this.store.requestGroups().decided);
  protected readonly busyId = signal<string | null>(null);
  protected readonly shared = signal<SharedLink | null>(null);
  protected readonly linkOpen = signal(false);
  private readonly sharedApproval = computed(() => {
    const shared = this.shared();
    return shared && shared.link.invite.type !== 'reset' ? shared : null;
  });
  protected readonly linkHeading = computed(() =>
    this.shared()?.link.invite.type === 'reset' ? 'Password reset link' : 'Request approved',
  );
  protected readonly approvedIntro = computed(() => {
    const approved = this.sharedApproval();
    return approved ? `${approved.request.name} is approved. Send them this link` : '';
  });
  protected readonly approvedNote = computed(() =>
    this.sharedApproval()
      ? `No link needed if they use the same device they asked from: FoodLog there now says “You’re in! Create your password”.`
      : '',
  );

  protected initialsOf(request: AdminAccessRequestDto): string {
    return initials(request);
  }

  protected ago(iso: string): string {
    return timeAgo(iso);
  }

  protected accountFor(request: AdminAccessRequestDto): AdminUserDto | null {
    return (
      this.store
        .users()
        .find((user) => user.status === 'active' && emailsMatch(user.email, request.email)) ?? null
    );
  }

  protected statusVerb(request: AdminAccessRequestDto): string {
    if (request.status === 'approved') {
      return 'Approved';
    }
    return request.hasAccount ? 'Dismissed' : 'Rejected';
  }

  protected statusLabel(request: AdminAccessRequestDto): string {
    if (request.status === 'rejected') {
      return request.hasAccount ? 'Dismissed' : 'Rejected';
    }
    return request.acceptedAt || request.hasAccount ? 'Joined' : 'Approved';
  }

  protected statusClass(request: AdminAccessRequestDto): string {
    if (request.status === 'rejected') {
      return request.hasAccount ? 'bg-surface-2 text-muted' : 'bg-danger/12 text-danger';
    }
    return request.acceptedAt || request.hasAccount
      ? 'bg-brand/15 text-brand'
      : 'bg-accent/15 text-accent';
  }

  protected async approve(request: AdminAccessRequestDto): Promise<void> {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(`${request.id}:approve`);
    try {
      const link = await this.store.approveRequest(request.id);
      this.shared.set({ request, link });
      this.linkOpen.set(true);
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not approve ${request.name}.`));
    } finally {
      this.busyId.set(null);
    }
  }

  protected async sendReset(request: AdminAccessRequestDto, account: AdminUserDto): Promise<void> {
    if (this.busyId() !== null) {
      return;
    }
    this.busyId.set(`${request.id}:reset`);
    try {
      const link = await this.store.resetLink(account.id);
      this.shared.set({ request, link });
      this.linkOpen.set(true);
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not create a reset link for ${request.name}.`));
    } finally {
      this.busyId.set(null);
    }
  }

  protected canResend(request: AdminAccessRequestDto): boolean {
    return request.status === 'approved' && !request.acceptedAt && !request.hasAccount;
  }

  protected async reject(request: AdminAccessRequestDto): Promise<void> {
    if (this.busyId() !== null) {
      return;
    }
    const confirmed = await this.confirm.confirm(
      request.hasAccount
        ? {
            title: `Dismiss ${request.name}’s request?`,
            message: `${request.email} already has an account, so there’s nothing to approve.`,
            confirmLabel: 'Dismiss',
          }
        : {
            title: `Reject ${request.name}?`,
            message: `${request.email} won’t get access. If they check on their device, they’ll see the request wasn’t approved.`,
            confirmLabel: 'Reject',
            tone: 'danger',
          },
    );
    if (!confirmed) {
      return;
    }
    this.busyId.set(`${request.id}:reject`);
    try {
      await this.store.rejectRequest(request.id);
      this.toast.success(
        request.hasAccount ? 'Request dismissed.' : `Rejected ${request.name}’s request.`,
      );
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not reject ${request.name}.`));
    } finally {
      this.busyId.set(null);
    }
  }
}
