import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  AdminAccessRequestDto,
  AdminInviteDto,
  AdminOverviewResponse,
  AdminUserDto,
  CreateInviteRequest,
  InviteLinkResponse,
  UpdateAdminUserRequest,
} from '@food/shared';
import { AdminPendingService } from '../../core/admin-pending.service';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { effectiveBudgetOf, splitInvites, splitRequests } from './admin-format';

export type AdminLoadState = 'loading' | 'ready' | 'error' | 'forbidden';

export const ADMIN_LOAD_FAILED_MESSAGE = 'Could not load the admin panel.';

interface AdminSnapshot {
  overview: AdminOverviewResponse;
  users: AdminUserDto[];
  requests: AdminAccessRequestDto[];
  invites: AdminInviteDto[];
}

const BUDGET_INPUTS: readonly (keyof UpdateAdminUserRequest)[] = [
  'role',
  'aiBudgetUnlimited',
  'aiMonthlyBudgetUsd',
];

function replaceById<T extends { id: string }>(list: readonly T[], item: T): T[] {
  return list.map((entry) => (entry.id === item.id ? item : entry));
}

function patchById<T extends { id: string }>(
  list: readonly T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
}

@Injectable()
export class AdminStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly pendingAccess = inject(AdminPendingService);
  private readonly overviewState = signal<AdminOverviewResponse | null>(null);
  private readonly usersState = signal<AdminUserDto[]>([]);
  private readonly requestsState = signal<AdminAccessRequestDto[]>([]);
  private readonly invitesState = signal<AdminInviteDto[]>([]);
  private readonly loadState = signal<AdminLoadState>('loading');
  private readonly errorState = signal<string | null>(null);
  private readonly refreshingState = signal(false);
  private generation = 0;
  private pendingMutations = 0;
  private lastLoadedAt = 0;

  readonly overview = this.overviewState.asReadonly();
  readonly users = this.usersState.asReadonly();
  readonly requests = this.requestsState.asReadonly();
  readonly invites = this.invitesState.asReadonly();
  readonly state = this.loadState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly refreshing = this.refreshingState.asReadonly();
  readonly requestGroups = computed(() => splitRequests(this.requestsState()));
  readonly inviteGroups = computed(() => splitInvites(this.invitesState()));
  readonly pendingRequests = computed(() => this.requestGroups().pending.length);
  readonly pendingInvites = computed(() => this.inviteGroups().pending.length);

  userById(id: string | null): AdminUserDto | null {
    return id === null ? null : (this.usersState().find((user) => user.id === id) ?? null);
  }

  isStale(maxAgeMs: number, now: number = Date.now()): boolean {
    return now - this.lastLoadedAt >= maxAgeMs;
  }

  async load(options: { silent?: boolean } = {}): Promise<void> {
    const silent = options.silent === true && this.loadState() === 'ready';
    const generation = ++this.generation;
    if (silent) {
      this.refreshingState.set(true);
    } else {
      this.loadState.set('loading');
      this.errorState.set(null);
    }
    try {
      const snapshot = await this.fetchAll();
      if (generation !== this.generation || this.pendingMutations > 0) {
        return;
      }
      this.apply(snapshot);
    } catch (err) {
      if (generation !== this.generation || this.pendingMutations > 0) {
        return;
      }
      if (httpStatus(err) === 403) {
        this.loadState.set('forbidden');
        this.auth.load().catch(() => undefined);
        return;
      }
      if (!silent) {
        this.errorState.set(errorMessage(err, ADMIN_LOAD_FAILED_MESSAGE));
        this.loadState.set('error');
      }
    } finally {
      if (generation === this.generation) {
        this.refreshingState.set(false);
      }
    }
  }

  refresh(): Promise<void> {
    return this.load({ silent: true });
  }

  approveRequest(id: string): Promise<InviteLinkResponse> {
    return this.mutate(async () => {
      const wasPending =
        this.requestsState().find((request) => request.id === id)?.status === 'pending';
      const link = await this.api.adminApproveRequest(id);
      if (wasPending) {
        this.requestsState.update((list) =>
          patchById(list, id, { status: 'approved', decidedAt: new Date().toISOString() }),
        );
        this.adjustOverview({ pendingRequests: -1, pendingInvites: 1 });
      }
      this.prependInvite(link.invite);
      return link;
    });
  }

  rejectRequest(id: string): Promise<void> {
    return this.mutate(async () => {
      const previous = this.requestsState();
      this.requestsState.set(
        patchById(previous, id, { status: 'rejected', decidedAt: new Date().toISOString() }),
      );
      this.adjustOverview({ pendingRequests: -1 });
      try {
        const updated = await this.api.adminRejectRequest(id);
        this.requestsState.update((list) => replaceById(list, updated));
      } catch (err) {
        this.requestsState.set(previous);
        this.adjustOverview({ pendingRequests: 1 });
        throw err;
      }
    });
  }

  updateUser(id: string, patch: UpdateAdminUserRequest): Promise<AdminUserDto> {
    return this.mutate(async () => {
      const previous = this.usersState();
      this.usersState.set(
        previous.map((user) => (user.id === id ? this.optimisticUser(user, patch) : user)),
      );
      try {
        const updated = await this.api.adminUpdateUser(id, patch);
        this.usersState.update((list) => replaceById(list, updated));
        return updated;
      } catch (err) {
        this.usersState.set(previous);
        throw err;
      }
    });
  }

  resetLink(id: string): Promise<InviteLinkResponse> {
    return this.mutate(async () => {
      const link = await this.api.adminResetLink(id);
      this.prependInvite(link.invite);
      return link;
    });
  }

  revokeSessions(id: string): Promise<void> {
    return this.mutate(async () => {
      await this.api.adminRevokeSessions(id);
      this.usersState.update((list) => patchById(list, id, { activeSessions: 0 }));
    });
  }

  deleteUser(id: string): Promise<void> {
    return this.mutate(async () => {
      await this.api.adminDeleteUser(id);
      this.usersState.update((list) => list.filter((user) => user.id !== id));
      this.adjustOverview({ users: -1 });
    });
  }

  createInvite(body: CreateInviteRequest): Promise<InviteLinkResponse> {
    return this.mutate(async () => {
      const link = await this.api.adminCreateInvite(body);
      this.prependInvite(link.invite);
      this.adjustOverview({ pendingInvites: 1 });
      return link;
    });
  }

  regenerateInvite(id: string): Promise<InviteLinkResponse> {
    return this.mutate(async () => {
      const link = await this.api.adminRegenerateInvite(id);
      this.invitesState.update((list) => patchById(list, id, { status: 'revoked' }));
      this.prependInvite(link.invite);
      return link;
    });
  }

  revokeInvite(id: string): Promise<void> {
    return this.mutate(async () => {
      const previous = this.invitesState();
      this.invitesState.set(patchById(previous, id, { status: 'revoked' }));
      this.adjustOverview({ pendingInvites: -1 });
      try {
        await this.api.adminRevokeInvite(id);
      } catch (err) {
        this.invitesState.set(previous);
        this.adjustOverview({ pendingInvites: 1 });
        throw err;
      }
    });
  }

  private async mutate<T>(run: () => Promise<T>): Promise<T> {
    this.generation++;
    this.refreshingState.set(false);
    this.pendingMutations++;
    try {
      return await run();
    } finally {
      this.pendingMutations--;
      void this.refresh();
    }
  }

  private optimisticUser(user: AdminUserDto, patch: UpdateAdminUserRequest): AdminUserDto {
    const next: AdminUserDto = { ...user, ...(patch as Partial<AdminUserDto>) };
    if (!BUDGET_INPUTS.some((key) => key in patch)) {
      return next;
    }
    const memberDefault = this.overviewState()?.memberDefaultBudgetUsd ?? null;
    return { ...next, effectiveBudgetUsd: effectiveBudgetOf(next, memberDefault) };
  }

  private prependInvite(invite: AdminInviteDto): void {
    this.invitesState.update((list) => [invite, ...list.filter((entry) => entry.id !== invite.id)]);
  }

  private async fetchAll(): Promise<AdminSnapshot> {
    const [overview, users, requests, invites] = await Promise.all([
      this.api.adminOverview(),
      this.api.adminUsers(),
      this.api.adminAccessRequests(),
      this.api.adminInvites(),
    ]);
    return { overview, users, requests, invites };
  }

  private apply(snapshot: AdminSnapshot): void {
    this.overviewState.set(snapshot.overview);
    this.pendingAccess.set(snapshot.overview.pendingRequests);
    this.usersState.set(snapshot.users);
    this.requestsState.set(snapshot.requests);
    this.invitesState.set(snapshot.invites);
    this.errorState.set(null);
    this.loadState.set('ready');
    this.lastLoadedAt = Date.now();
  }

  private adjustOverview(
    delta: Partial<Record<'users' | 'pendingRequests' | 'pendingInvites', number>>,
  ): void {
    this.overviewState.update((overview) => {
      if (!overview) {
        return overview;
      }
      return {
        ...overview,
        users: Math.max(0, overview.users + (delta.users ?? 0)),
        pendingRequests: Math.max(0, overview.pendingRequests + (delta.pendingRequests ?? 0)),
        pendingInvites: Math.max(0, overview.pendingInvites + (delta.pendingInvites ?? 0)),
      };
    });
    const overview = this.overviewState();
    if (overview) {
      this.pendingAccess.set(overview.pendingRequests);
    }
  }
}
