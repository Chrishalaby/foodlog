import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AccessRequestStatusResponse, UserDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import {
  ACCESS_REQUEST_STORAGE_KEY,
  AccessRequestStore,
  accessRequestView,
  parseStoredRequest,
  type StoredAccessRequest,
} from './access-request.store';

const STORED: StoredAccessRequest = {
  statusToken: 'status-token',
  email: 'lina@example.com',
  name: 'Lina',
  createdAt: '2026-09-28T08:00:00.000Z',
};

function statusOf(
  status: AccessRequestStatusResponse['status'],
  canCreateAccount = false,
): AccessRequestStatusResponse {
  return {
    status,
    email: 'lina@example.com',
    name: 'Lina',
    createdAt: STORED.createdAt,
    decidedAt: status === 'pending' ? null : '2026-09-28T09:00:00.000Z',
    canCreateAccount,
  };
}

const USER: UserDto = { id: 'u9', email: 'lina@example.com', name: 'Lina', role: 'member' };

describe('parseStoredRequest', () => {
  it('accepts well-formed records only', () => {
    expect(parseStoredRequest(JSON.stringify(STORED))).toEqual(STORED);
    expect(parseStoredRequest(null)).toBeNull();
    expect(parseStoredRequest('not json')).toBeNull();
    expect(parseStoredRequest(JSON.stringify({ ...STORED, statusToken: '' }))).toBeNull();
    expect(parseStoredRequest(JSON.stringify({ statusToken: 'x' }))).toBeNull();
  });
});

describe('accessRequestView', () => {
  it('maps the stored request and live status to a view', () => {
    expect(accessRequestView(null, null, false, false)).toBe('none');
    expect(accessRequestView(STORED, null, true, false)).toBe('checking');
    expect(accessRequestView(STORED, null, false, true)).toBe('error');
    expect(accessRequestView(STORED, statusOf('pending'), false, false)).toBe('pending');
    expect(accessRequestView(STORED, statusOf('approved', true), false, false)).toBe('approved');
    expect(accessRequestView(STORED, statusOf('approved', false), false, false)).toBe('ready');
    expect(accessRequestView(STORED, statusOf('rejected'), false, false)).toBe('rejected');
  });
});

describe('AccessRequestStore', () => {
  let api: {
    accessRequestStatus: ReturnType<typeof vi.fn>;
    acceptAccessRequest: ReturnType<typeof vi.fn>;
    authStatus: ReturnType<typeof vi.fn>;
  };

  function setup(stored: StoredAccessRequest | null = STORED): AccessRequestStore {
    localStorage.clear();
    if (stored) {
      localStorage.setItem(ACCESS_REQUEST_STORAGE_KEY, JSON.stringify(stored));
    }
    api = {
      accessRequestStatus: vi.fn(async () => statusOf('pending')),
      acceptAccessRequest: vi.fn(async () => USER),
      authStatus: vi.fn(async () => ({ setupRequired: false, authenticated: true, user: USER })),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
    return TestBed.inject(AccessRequestStore);
  }

  afterEach(() => localStorage.clear());

  it('reads the request kept on this device and checks its status', async () => {
    const store = setup();
    expect(store.stored()).toEqual(STORED);
    expect(store.view()).toBe('checking');
    await store.check();
    expect(api.accessRequestStatus).toHaveBeenCalledWith({ statusToken: 'status-token' });
    expect(store.view()).toBe('pending');
    expect(store.checkedAt()).not.toBeNull();
  });

  it('remembers a new request and shows it as pending straight away', () => {
    const store = setup(null);
    expect(store.view()).toBe('none');
    store.remember('new-token', { email: 'omar@example.com', name: 'Omar' });
    expect(parseStoredRequest(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY))?.statusToken).toBe(
      'new-token',
    );
    expect(store.view()).toBe('pending');
    expect(store.status()?.email).toBe('omar@example.com');
  });

  it('forgets requests the server no longer knows', async () => {
    const store = setup();
    api.accessRequestStatus.mockResolvedValueOnce({ ...statusOf('pending'), status: 'unknown' });
    await store.check();
    expect(store.view()).toBe('none');
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it('keeps the request and reports an error when the check fails', async () => {
    const store = setup();
    api.accessRequestStatus.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await store.check();
    expect(store.view()).toBe('error');
    expect(store.error()).toContain('offline');
    expect(store.stored()).toEqual(STORED);
  });

  it('shares one status request between callers', async () => {
    const store = setup();
    await Promise.all([store.check(), store.check()]);
    expect(api.accessRequestStatus).toHaveBeenCalledTimes(1);
  });

  it('creates the account once approved, signs in and forgets the request', async () => {
    const store = setup();
    api.accessRequestStatus.mockResolvedValueOnce(statusOf('approved', true));
    await store.check();
    expect(store.view()).toBe('approved');
    await store.accept('correct-horse');
    expect(api.acceptAccessRequest).toHaveBeenCalledWith({
      statusToken: 'status-token',
      password: 'correct-horse',
    });
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
    expect(store.view()).toBe('none');
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it('keeps the request when creating the account fails', async () => {
    const store = setup();
    api.acceptAccessRequest.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    await expect(store.accept('correct-horse')).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(store.stored()).toEqual(STORED);
  });

  it('forgets the request once that email signs in, and only then', () => {
    const store = setup();
    store.forgetIfFor('someone@example.com');
    expect(store.stored()).toEqual(STORED);
    store.forgetIfFor(' LINA@example.com ');
    expect(store.stored()).toBeNull();
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it('picks up a request stored by another tab', () => {
    const store = setup(null);
    localStorage.setItem(ACCESS_REQUEST_STORAGE_KEY, JSON.stringify(STORED));
    store.syncFromStorage();
    expect(store.stored()).toEqual(STORED);
  });
});
