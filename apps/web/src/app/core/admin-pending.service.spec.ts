import { HttpErrorResponse } from '@angular/common/http';
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AdminOverviewResponse } from '@food/shared';
import { AdminPendingService } from './admin-pending.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

function overview(pendingRequests: number): AdminOverviewResponse {
  return {
    users: 3,
    activeUsers30d: 2,
    pendingRequests,
    pendingInvites: 0,
    aiCostMonthUsd: 0,
    aiRequestsMonth: 0,
    globalBudgetUsd: null,
    memberDefaultBudgetUsd: 5,
  };
}

describe('AdminPendingService', () => {
  let isAdmin: ReturnType<typeof signal<boolean>>;
  let adminOverview: ReturnType<typeof vi.fn<() => Promise<AdminOverviewResponse>>>;
  let service: AdminPendingService;

  beforeEach(() => {
    isAdmin = signal(false);
    adminOverview = vi.fn(async () => overview(2));
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { adminOverview } },
        { provide: AuthService, useValue: { isAdmin } },
      ],
    });
    service = TestBed.inject(AdminPendingService);
  });

  afterEach(() =>
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    }),
  );

  async function settle(): Promise<void> {
    TestBed.tick();
    await TestBed.inject(ApplicationRef).whenStable();
  }

  it('never asks the server for members', async () => {
    await settle();
    service.reload();
    await settle();
    expect(adminOverview).not.toHaveBeenCalled();
    expect(service.count()).toBe(0);
  });

  it('counts the people waiting for access for admins', async () => {
    isAdmin.set(true);
    await settle();
    expect(adminOverview).toHaveBeenCalledTimes(1);
    expect(service.count()).toBe(2);

    isAdmin.set(false);
    expect(service.count()).toBe(0);
  });

  it('checks again when the app comes back to the foreground', async () => {
    isAdmin.set(true);
    await settle();
    adminOverview.mockResolvedValueOnce(overview(3));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(adminOverview).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(adminOverview).toHaveBeenCalledTimes(2);
    expect(service.count()).toBe(3);
  });

  it('shows nothing when the overview cannot be loaded', async () => {
    adminOverview.mockRejectedValueOnce(new HttpErrorResponse({ status: 403 }));
    isAdmin.set(true);
    await settle();
    expect(service.count()).toBe(0);
  });

  it('follows decisions made in the admin panel until the next check', async () => {
    isAdmin.set(true);
    await settle();
    service.set(0);
    expect(service.count()).toBe(0);
    service.set(-4);
    expect(service.count()).toBe(0);

    service.reload();
    await settle();
    expect(service.count()).toBe(2);
  });
});
