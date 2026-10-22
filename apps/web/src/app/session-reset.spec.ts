import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  addDays,
  computeBodyMetrics,
  computeTargets,
  type AuthStatusResponse,
  type ProfileDto,
  type ProfileResponse,
  type UserDto,
} from '@food/shared';
import { apiInterceptor } from './core/api.interceptor';
import { AuthService, HARD_NAVIGATE } from './core/auth.service';
import { CaptureService } from './core/capture.service';
import { ProfileStore } from './core/profile.store';
import { SessionScope } from './core/session-scope';
import { ToastService } from './core/toast.service';
import { HistoryStore } from './features/history/history-store';
import { DEFAULT_PROFILE, toFormModel } from './features/settings/profile-model';
import { SettingsDraftStore } from './features/settings/settings-draft.store';
import { makeDashboard, makeEntry, makeWeightSummary } from './features/today/today-fixtures';
import { TodayStore } from './features/today/today-store';
import { WEIGHT_CARD_WINDOW_DAYS, WeightCardStore } from './features/today/weight-card-store';
import { ConfirmService } from './shared/ui/confirm.service';

@Component({ template: '' })
class Blank {}

const ALICE: UserDto = {
  id: 'user-alice',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'member',
};
const BOB: UserDto = { id: 'user-bob', email: 'bob@example.com', name: 'Bob', role: 'member' };
const DATE = '2026-09-28';
const PASSWORD = 'correct horse battery';
const SERVER_PROFILE: ProfileDto = { ...DEFAULT_PROFILE, weightKg: 70 };

function profileResponse(profile: ProfileDto): ProfileResponse {
  return {
    profile,
    targets: computeTargets(profile),
    body: computeBodyMetrics(profile),
    ai: {
      provider: 'mock',
      voice: true,
      customEndpoint: false,
      defaultModel: 'gpt-5.6-sol',
      preciseModel: 'gpt-6-astra',
      activeModel: 'gpt-5.6-sol',
      reasoningEffort: 'low',
      availableModels: [],
      monthlyBudgetUsd: 5,
    },
  };
}

function statusOf(user: UserDto | null): AuthStatusResponse {
  return { setupRequired: false, authenticated: user !== null, user };
}

const unauthorized = { status: 401, statusText: 'Unauthorized' };
const unauthorizedBody = { statusCode: 401, message: 'Unauthorized' };
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('session reset across stores', () => {
  let backend: HttpTestingController;
  let auth: AuthService;
  let scope: SessionScope;
  let hardNavigate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hardNavigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
        { provide: HARD_NAVIGATE, useValue: hardNavigate },
      ],
    });
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    scope = TestBed.inject(SessionScope);
  });

  afterEach(() => backend.verify());

  function stores() {
    return {
      profiles: TestBed.inject(ProfileStore),
      today: TestBed.inject(TodayStore),
      weightCard: TestBed.inject(WeightCardStore),
      history: TestBed.inject(HistoryStore),
      toasts: TestBed.inject(ToastService),
      capture: TestBed.inject(CaptureService),
      drafts: TestBed.inject(SettingsDraftStore),
      confirms: TestBed.inject(ConfirmService),
    };
  }

  async function signIn(user: UserDto): Promise<void> {
    const login = auth.login({ email: user.email, password: PASSWORD });
    backend.expectOne('/api/auth/login').flush(user);
    await login;
    await settle();
    backend.expectOne('/api/auth/status').flush(statusOf(user));
    await settle();
  }

  function weightsRequest() {
    return backend.expectOne((req) => req.url === '/api/weights');
  }

  async function seed(user: UserDto): Promise<void> {
    const { profiles, today, weightCard, history, toasts, capture, drafts, confirms } = stores();
    const profile = profiles.load();
    backend.expectOne('/api/profile').flush(profileResponse(SERVER_PROFILE));
    await profile;
    const day = today.show(DATE);
    backend
      .expectOne((req) => req.url === '/api/dashboard/day')
      .flush(makeDashboard(DATE, [makeEntry({ id: `${user.id}-meal` })]));
    await day;
    const weights = weightCard.show(DATE);
    weightsRequest().flush(
      makeWeightSummary(addDays(DATE, -(WEIGHT_CARD_WINDOW_DAYS - 1)), DATE, [
        { date: DATE, weightKg: 70, bodyFatPct: null },
      ]),
    );
    await weights;
    const entries = history.load('');
    backend
      .expectOne((req) => req.url === '/api/entries')
      .flush({ items: [makeEntry({ id: `${user.id}-meal` })], nextCursor: null });
    await entries;
    toasts.info('Entry deleted', { action: { label: 'Undo', run: () => undefined } });
    capture.openSearch('eggs');
    drafts.keep({
      userId: user.id,
      serverProfile: SERVER_PROFILE,
      baseline: SERVER_PROFILE,
      model: toFormModel({ ...SERVER_PROFILE, weightKg: 72 }),
    });
    void confirms.confirm({ title: 'Delete this entry?' });
    await settle();

    expect(profiles.response()).not.toBeNull();
    expect(today.dashboard()?.entries).toHaveLength(1);
    expect(weightCard.summary()).not.toBeNull();
    expect(history.entries()).toHaveLength(1);
    expect(toasts.toasts()).toHaveLength(1);
    expect(capture.searchRequest()).not.toBeNull();
    expect(confirms.current()).not.toBeNull();
  }

  function expectNothingLeftFrom(user: UserDto): void {
    const { profiles, today, weightCard, history, toasts, capture, drafts, confirms } = stores();
    expect(profiles.response()).toBeNull();
    expect(today.date()).toBeNull();
    expect(today.dashboard()).toBeNull();
    expect(today.foods()).toEqual([]);
    expect(weightCard.date()).toBeNull();
    expect(weightCard.summary()).toBeNull();
    expect(history.entries()).toEqual([]);
    expect(history.status()).toBe('idle');
    expect(toasts.toasts()).toEqual([]);
    expect(capture.searchRequest()).toBeNull();
    expect(drafts.restore(user.id, SERVER_PROFILE)).toBeNull();
    expect(confirms.current()).toBeNull();
  }

  it('clears every signed-in store once when the user logs out', async () => {
    await signIn(ALICE);
    await seed(ALICE);
    const epoch = scope.epoch();

    const logout = auth.logout();
    backend.expectOne('/api/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await logout;

    expect(auth.status()).toBe('anonymous');
    expect(scope.epoch()).toBe(epoch + 1);
    expectNothingLeftFrom(ALICE);
  });

  it('ends the session once on 401s and ignores answers that arrive afterwards', async () => {
    await signIn(ALICE);
    await seed(ALICE);
    const { today, weightCard, history } = stores();
    const epoch = scope.epoch();

    const day = today.refresh();
    const weights = weightCard.refresh();
    const entries = history.load('');
    backend
      .expectOne((req) => req.url === '/api/dashboard/day')
      .flush(unauthorizedBody, unauthorized);
    await day;
    backend.expectOne((req) => req.url === '/api/entries').flush(unauthorizedBody, unauthorized);
    await entries;
    weightsRequest().flush(makeWeightSummary(addDays(DATE, -29), DATE));
    await weights;

    expect(auth.status()).toBe('anonymous');
    expect(scope.epoch()).toBe(epoch + 1);
    expectNothingLeftFrom(ALICE);
  });

  it('drops the previous account before a different user signs in on the same page', async () => {
    await signIn(ALICE);
    await seed(ALICE);
    const { weightCard } = stores();
    const late = weightCard.refresh();
    const epoch = scope.epoch();

    const login = auth.login({ email: BOB.email, password: PASSWORD });
    backend.expectOne('/api/auth/login').flush(BOB);
    await login;

    expect(scope.epoch()).toBe(epoch + 1);
    expectNothingLeftFrom(ALICE);
    weightsRequest().flush(makeWeightSummary(addDays(DATE, -29), DATE));
    await late;
    expect(weightCard.summary()).toBeNull();

    await settle();
    backend.expectOne('/api/auth/status').flush(statusOf(BOB));
    await settle();
    expect(auth.user()?.id).toBe(BOB.id);
    expect(scope.epoch()).toBe(epoch + 1);

    await auth.enterApp('/');
    expect(hardNavigate).toHaveBeenCalledWith('/');
  });

  it('keeps the next user signed in when a 401 from the previous session arrives late', async () => {
    await signIn(ALICE);
    await seed(ALICE);
    const { history } = stores();
    const stale = history.load('');
    await signIn(BOB);
    const epoch = scope.epoch();

    backend.expectOne((req) => req.url === '/api/entries').flush(unauthorizedBody, unauthorized);
    await stale;

    expect(auth.status()).toBe('authenticated');
    expect(auth.user()?.id).toBe(BOB.id);
    expect(scope.epoch()).toBe(epoch);
  });

  it('resets when a status re-check finds a different account', async () => {
    await signIn(ALICE);
    await seed(ALICE);
    const epoch = scope.epoch();

    const check = auth.load();
    await settle();
    backend.expectOne('/api/auth/status').flush(statusOf(BOB));
    await check;

    expect(auth.user()?.id).toBe(BOB.id);
    expect(scope.epoch()).toBe(epoch + 1);
    expectNothingLeftFrom(ALICE);
  });
});
