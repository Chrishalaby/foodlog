import { Component, DOCUMENT, DestroyRef, computed, inject, signal } from '@angular/core';
import type { SessionDto } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { errorMessage, httpStatus } from '../../../core/errors';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import { Icon, type IconName } from '../../../shared/ui/icon';
import { Skeleton } from '../../../shared/ui/skeleton';
import { Spinner } from '../../../shared/ui/spinner';
import { calendarLabel, timeAgo } from '../../admin/admin-format';
import { type DeviceKind, describeUserAgent } from '../user-agent';
import { SettingsSection } from './settings-section';

export const SESSIONS_LOAD_FAILED_MESSAGE = 'Could not load your signed-in devices.';
export const SESSIONS_REFRESH_MIN_MS = 10_000;

type LoadState = 'loading' | 'ready' | 'error';

interface DeviceRow {
  session: SessionDto;
  label: string;
  icon: IconName;
  active: string;
  signedIn: string;
}

const KIND_ICONS: Record<DeviceKind, IconName> = {
  phone: 'phone',
  tablet: 'tablet',
  desktop: 'laptop',
  unknown: 'globe',
};

function sessionTime(session: SessionDto): number {
  const time = new Date(session.lastSeenAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function sortSessions(sessions: readonly SessionDto[]): SessionDto[] {
  return [...sessions].sort((a, b) => {
    if (a.current !== b.current) {
      return a.current ? -1 : 1;
    }
    return sessionTime(b) - sessionTime(a);
  });
}

export function toDeviceRow(session: SessionDto, now: number = Date.now()): DeviceRow {
  const device = describeUserAgent(session.userAgent);
  return {
    session,
    label: device.label,
    icon: KIND_ICONS[device.kind],
    active: session.current ? 'Active now' : `Active ${timeAgo(session.lastSeenAt, now)}`,
    signedIn: `Signed in ${calendarLabel(session.createdAt, now)}`,
  };
}

@Component({
  selector: 'app-devices-section',
  imports: [SettingsSection, Icon, Skeleton, Spinner],
  template: `
    <app-settings-section
      sectionId="settings-devices"
      heading="Signed-in devices"
      icon="key"
      tone="accent"
      description="You stay signed in until you sign out. Remove any device you don’t recognise."
    >
      @switch (state()) {
        @case ('loading') {
          <div class="flex flex-col gap-2" aria-busy="true" aria-label="Loading devices">
            <app-skeleton class="h-16" />
            <app-skeleton class="h-16" />
          </div>
        }
        @case ('error') {
          <div class="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3" role="alert">
            <app-icon class="text-danger" name="alert" [size]="18" />
            <p class="min-w-0 flex-1 text-sm text-muted">{{ error() }}</p>
            <button type="button" class="btn btn-ghost px-3 text-brand" (click)="load()">
              Retry
            </button>
          </div>
        }
        @default {
          <ul class="flex flex-col gap-2" role="list" aria-label="Signed-in devices">
            @for (row of rows(); track row.session.id) {
              <li
                class="flex min-h-16 items-center gap-3 rounded-xl bg-surface-2 py-2.5 pr-1.5 pl-3.5"
              >
                <span
                  class="flex size-10 shrink-0 items-center justify-center rounded-xl"
                  [class]="
                    row.session.current ? 'bg-brand/15 text-brand' : 'bg-elevated text-muted'
                  "
                  aria-hidden="true"
                >
                  <app-icon [name]="row.icon" [size]="20" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="flex min-w-0 items-center gap-1.5">
                    <span class="truncate text-sm font-semibold text-fg">{{ row.label }}</span>
                    @if (row.session.current) {
                      <span class="chip shrink-0 bg-brand/15 px-2 py-0.5 text-brand"
                        >This device</span
                      >
                    }
                  </p>
                  <p class="text-xs leading-snug text-muted">
                    <span class="whitespace-nowrap">{{ row.active }}</span> ·
                    <span class="whitespace-nowrap">{{ row.signedIn }}</span>
                  </p>
                </div>
                @if (!row.session.current) {
                  <button
                    type="button"
                    class="btn btn-ghost btn-icon text-muted hover:text-danger"
                    [attr.aria-label]="'Sign out ' + row.label"
                    [disabled]="busy()"
                    (click)="revoke(row.session, row.label)"
                  >
                    <app-icon name="logout" [size]="18" />
                  </button>
                }
              </li>
            }
          </ul>
          @if (others() > 0) {
            <button
              type="button"
              class="btn btn-secondary mt-3 w-full text-danger"
              [disabled]="busy()"
              (click)="signOutOthers()"
            >
              @if (busy()) {
                <app-spinner [size]="18" label="Signing out other devices" />
              } @else {
                <app-icon name="logout" [size]="18" />
              }
              Sign out
              {{ others() === 1 ? 'the other device' : 'all ' + others() + ' other devices' }}
            </button>
          } @else {
            <p class="mt-3 text-xs text-muted">
              This is the only device signed in to your account.
            </p>
          }
        }
      }
    </app-settings-section>
  `,
})
export class DevicesSection {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly document = inject(DOCUMENT);
  private loadVersion = 0;
  private loadedAt = 0;

  protected readonly sessions = signal<SessionDto[]>([]);
  protected readonly state = signal<LoadState>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly rows = computed(() => {
    const now = Date.now();
    return sortSessions(this.sessions()).map((session) => toDeviceRow(session, now));
  });
  protected readonly others = computed(
    () => this.sessions().filter((session) => !session.current).length,
  );

  constructor() {
    void this.load();
    const onVisibility = (): void => {
      if (
        this.document.visibilityState === 'visible' &&
        Date.now() - this.loadedAt >= SESSIONS_REFRESH_MIN_MS
      ) {
        void this.load({ silent: true });
      }
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisibility),
    );
  }

  async load(options: { silent?: boolean } = {}): Promise<void> {
    const silent = options.silent === true && this.state() === 'ready';
    const version = ++this.loadVersion;
    if (!silent) {
      this.state.set('loading');
      this.error.set(null);
    }
    try {
      const sessions = await this.api.sessions();
      if (version !== this.loadVersion) {
        return;
      }
      this.sessions.set(sessions);
      this.state.set('ready');
      this.loadedAt = Date.now();
    } catch (err) {
      if (version !== this.loadVersion || silent) {
        return;
      }
      this.error.set(errorMessage(err, SESSIONS_LOAD_FAILED_MESSAGE));
      this.state.set('error');
    }
  }

  protected async revoke(session: SessionDto, label: string): Promise<void> {
    if (this.busy() || session.current) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: `Sign out ${label}?`,
      message: 'It will need your password to sign in again. This device stays signed in.',
      confirmLabel: 'Sign out',
      tone: 'danger',
    });
    if (!confirmed || this.busy()) {
      return;
    }
    this.loadVersion++;
    this.sessions.update((list) => list.filter((entry) => entry.id !== session.id));
    try {
      await this.revokeOne(session.id);
      this.toast.success(`Signed out ${label}.`);
    } catch (err) {
      this.sessions.update((list) =>
        list.some((entry) => entry.id === session.id) ? list : [...list, session],
      );
      this.toast.error(errorMessage(err, `Could not sign out ${label}.`));
    }
  }

  protected async signOutOthers(): Promise<void> {
    const others = this.sessions().filter((session) => !session.current);
    if (this.busy() || others.length === 0) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title:
        others.length === 1 ? 'Sign out the other device?' : `Sign out ${others.length} devices?`,
      message: 'They will need your password to sign in again. This device stays signed in.',
      confirmLabel: 'Sign out',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.busy.set(true);
    this.loadVersion++;
    try {
      const results = await Promise.allSettled(others.map((session) => this.revokeOne(session.id)));
      const revoked = new Set(
        others.filter((_, index) => results[index].status === 'fulfilled').map((s) => s.id),
      );
      this.sessions.update((list) => list.filter((session) => !revoked.has(session.id)));
      const failed = others.length - revoked.size;
      if (failed > 0) {
        this.toast.error(
          failed === others.length
            ? 'Could not sign out your other devices.'
            : `Signed out ${revoked.size} of ${others.length} devices. Try again for the rest.`,
        );
      } else {
        this.toast.success(
          revoked.size === 1
            ? 'Signed out the other device.'
            : `Signed out ${revoked.size} devices.`,
        );
      }
    } finally {
      this.busy.set(false);
    }
  }

  private async revokeOne(id: string): Promise<void> {
    try {
      await this.api.revokeSession(id);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        throw err;
      }
    }
  }
}
