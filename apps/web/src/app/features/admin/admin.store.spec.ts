import { HttpErrorResponse } from '@angular/common/http';
import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { AdminAccessRequestDto, AdminUserDto } from '@food/shared';
import { AdminPendingService } from '../../core/admin-pending.service';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { AdminStore } from './admin.store';
import { adminApiImpl, adminOverview, adminUser } from './testing/admin-fixtures';

type AdminApiImpl = ReturnType<typeof adminApiImpl>;

function createAdminApi(): { [K in keyof AdminApiImpl]: Mock<AdminApiImpl[K]> } {
  const impl = adminApiImpl();
  return Object.fromEntries(
    Object.entries(impl).map(([key, fn]) => [key, vi.fn(fn)]),
  ) as unknown as { [K in keyof AdminApiImpl]: Mock<AdminApiImpl[K]> };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('AdminStore', () => {
  let api: ReturnType<typeof createAdminApi>;
  let store: AdminStore;
  let pendingSet: Mock<(count: number) => void>;

  beforeEach(() => {
    api = createAdminApi();
    pendingSet = vi.fn<(count: number) => void>();
    TestBed.configureTestingModule({
      providers: [
        AdminStore,
        { provide: ApiService, useValue: api },
        { provide: AdminPendingService, useValue: { set: pendingSet } },
      ],
    });
    store = TestBed.inject(AdminStore);
  });

  it('loads the overview, people, requests and invites together', async () => {
    await store.load();
    expect(store.state()).toBe('ready');
    expect(store.overview()?.users).toBe(3);
    expect(store.users().map((u) => u.id)).toEqual(['me', 'maya']);
    expect(store.pendingRequests()).toBe(1);
    expect(store.pendingInvites()).toBe(1);
  });

  it('shows a forbidden state for non-admins and rechecks the signed-in role', async () => {
    const reload = vi.spyOn(TestBed.inject(AuthService), 'load').mockRejectedValue(new Error('x'));
    api.adminOverview.mockRejectedValueOnce(new HttpErrorResponse({ status: 403 }));
    await store.load();
    expect(store.state()).toBe('forbidden');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps showing data when a background refresh fails', async () => {
    await store.load();
    api.adminUsers.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await store.refresh();
    expect(store.state()).toBe('ready');
    expect(store.users().length).toBe(2);
  });

  it('reports errors when the first load fails', async () => {
    api.adminInvites.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await store.load();
    expect(store.state()).toBe('error');
    expect(store.error()).toContain('offline');
  });

  it('rejects optimistically and restores the request when the server refuses', async () => {
    await store.load();
    const pending = deferred<AdminAccessRequestDto>();
    api.adminRejectRequest.mockReturnValueOnce(pending.promise);
    const rejecting = store.rejectRequest('lina');
    expect(store.pendingRequests()).toBe(0);
    expect(store.overview()?.pendingRequests).toBe(0);
    pending.reject(new HttpErrorResponse({ status: 500 }));
    await expect(rejecting).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.pendingRequests()).toBe(1);
    expect(store.overview()?.pendingRequests).toBe(1);
  });

  it('keeps the pending-access badge in step while a rejection fails', async () => {
    await store.load();
    expect(pendingSet).toHaveBeenLastCalledWith(1);
    const failing = deferred<AdminAccessRequestDto>();
    api.adminRejectRequest.mockReturnValueOnce(failing.promise);
    const rejecting = store.rejectRequest('lina');
    expect(pendingSet).toHaveBeenLastCalledWith(0);
    failing.reject(new HttpErrorResponse({ status: 500 }));
    await expect(rejecting).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(pendingSet).toHaveBeenLastCalledWith(1);
  });

  it('clears the pending-access badge once the last request is decided', async () => {
    await store.load();
    api.adminOverview.mockResolvedValue(adminOverview({ pendingRequests: 0 }));
    await store.rejectRequest('lina');
    expect(pendingSet).toHaveBeenLastCalledWith(0);
    await vi.waitFor(() => expect(api.adminOverview).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(store.refreshing()).toBe(false));
    expect(pendingSet).toHaveBeenLastCalledWith(0);
  });

  it('approves a request, records the new invite and refreshes afterwards', async () => {
    await store.load();
    const link = await store.approveRequest('lina');
    expect(api.adminApproveRequest).toHaveBeenCalledWith('lina');
    expect(link.url).toContain('/invite/');
    expect(store.requests()[0].status).toBe('approved');
    expect(store.invites()[0].id).toBe('inv-lina');
    await vi.waitFor(() => expect(api.adminOverview).toHaveBeenCalledTimes(2));
  });

  it('updates people optimistically and rolls back on failure', async () => {
    await store.load();
    const pending = deferred<AdminUserDto>();
    api.adminUpdateUser.mockReturnValueOnce(pending.promise);
    const updating = store.updateUser('maya', { status: 'disabled' });
    expect(store.userById('maya')?.status).toBe('disabled');
    pending.reject(new HttpErrorResponse({ status: 409 }));
    await expect(updating).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.userById('maya')?.status).toBe('active');
  });

  it('shows the new effective budget while a budget change is saving', async () => {
    await store.load();
    const pending = deferred<AdminUserDto>();
    api.adminUpdateUser.mockReturnValue(pending.promise);

    const unlimited = store.updateUser('maya', { aiBudgetUnlimited: true });
    expect(store.userById('maya')).toMatchObject({
      aiBudgetUnlimited: true,
      effectiveBudgetUsd: null,
    });
    pending.resolve(adminUser({ id: 'maya', aiBudgetUnlimited: true, effectiveBudgetUsd: null }));
    await unlimited;

    const next = deferred<AdminUserDto>();
    api.adminUpdateUser.mockReturnValue(next.promise);
    const custom = store.updateUser('maya', { aiBudgetUnlimited: false, aiMonthlyBudgetUsd: 12 });
    expect(store.userById('maya')).toMatchObject({
      aiBudgetUnlimited: false,
      aiMonthlyBudgetUsd: 12,
      effectiveBudgetUsd: 12,
    });
    next.resolve(adminUser({ id: 'maya', aiMonthlyBudgetUsd: 12, effectiveBudgetUsd: 12 }));
    await custom;
  });

  it('keeps the effective budget as it is for changes that cannot affect it', async () => {
    api.adminUsers.mockResolvedValue([adminUser({ id: 'maya', effectiveBudgetUsd: 7 })]);
    await store.load();
    const pending = deferred<AdminUserDto>();
    api.adminUpdateUser.mockReturnValueOnce(pending.promise);
    const renaming = store.updateUser('maya', { name: 'Maya H.' });
    expect(store.userById('maya')).toMatchObject({ name: 'Maya H.', effectiveBudgetUsd: 7 });
    pending.resolve(adminUser({ id: 'maya', name: 'Maya H.', effectiveBudgetUsd: 7 }));
    await renaming;
  });

  it('does not let a refresh that started before a change overwrite it', async () => {
    await store.load();
    const slowUsers = deferred<AdminUserDto[]>();
    api.adminUsers
      .mockReturnValueOnce(slowUsers.promise)
      .mockResolvedValue([adminUser({ id: 'maya', role: 'admin' })]);
    const refreshing = store.refresh();
    await store.updateUser('maya', { role: 'admin' });
    slowUsers.resolve([adminUser({ id: 'maya', role: 'member' })]);
    await refreshing;
    expect(store.userById('maya')?.role).toBe('admin');
    await vi.waitFor(() => expect(api.adminUsers).toHaveBeenCalledTimes(3));
    expect(store.userById('maya')?.role).toBe('admin');
  });

  it('removes deleted people, clears sessions and manages invites', async () => {
    await store.load();
    await store.revokeSessions('maya');
    expect(store.userById('maya')?.activeSessions).toBe(0);
    await store.deleteUser('maya');
    expect(store.userById('maya')).toBeNull();
    expect(store.overview()?.users).toBe(2);

    const created = await store.createInvite({ email: 'sami@example.com' });
    expect(created.invite.email).toBe('sami@example.com');
    expect(store.invites()[0].id).toBe('created');

    await store.regenerateInvite('nour');
    expect(store.invites().find((i) => i.id === 'nour')?.status).toBe('revoked');
    expect(store.invites()[0].id).toBe('nour-2');

    await store.revokeInvite('created');
    expect(store.invites().find((i) => i.id === 'created')?.status).toBe('revoked');
  });

  it('restores an invite when revoking fails', async () => {
    await store.load();
    api.adminRevokeInvite.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    await expect(store.revokeInvite('nour')).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.invites()[0].status).toBe('pending');
  });
});
