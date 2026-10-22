import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type ProfileDto,
  type ProfileResponse,
  type UserDto,
  computeBodyMetrics,
  computeTargets,
} from '@food/shared';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DataEventsService } from './data-events.service';
import {
  DAY_START_STORAGE_KEY,
  DEFAULT_DAY_START_HOUR,
  dayStartHour,
  setDayStartHour,
} from './day-start';
import { PROFILE_LOAD_FAILED_MESSAGE, ProfileStore } from './profile.store';
import { SessionScope } from './session-scope';
import { THEME_STORAGE_KEY, ThemeService } from './theme.service';

const PROFILE: ProfileDto = {
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  bodyFatPct: null,
  tdeeOverride: null,
  onboarded: false,
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 0,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'light',
};

function response(profile: ProfileDto): ProfileResponse {
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
      monthlyBudgetUsd: null,
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeAuth {
  readonly user = signal<UserDto | null>({
    id: 'u1',
    email: 'me@example.com',
    name: null,
    role: 'member',
  });
}

describe('ProfileStore', () => {
  let api: {
    getProfile: ReturnType<typeof vi.fn<() => Promise<ProfileResponse>>>;
    putProfile: ReturnType<typeof vi.fn<(body: ProfileDto) => Promise<ProfileResponse>>>;
  };
  let auth: FakeAuth;

  beforeEach(() => {
    localStorage.clear();
    api = {
      getProfile: vi.fn(async () => response(PROFILE)),
      putProfile: vi.fn(async (body: ProfileDto) => response({ ...body })),
    };
    auth = new FakeAuth();
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    });
  });

  afterEach(() => {
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
    localStorage.clear();
  });

  function create(): ProfileStore {
    const store = TestBed.inject(ProfileStore);
    TestBed.tick();
    return store;
  }

  it('loads the profile once and exposes it through signals', async () => {
    const store = create();
    expect(store.loaded()).toBe(false);
    const pending = store.load();
    expect(store.loading()).toBe(true);
    await pending;
    expect(store.loading()).toBe(false);
    expect(store.profile()?.weightKg).toBe(80);
    expect(store.targets()?.base.calories).toBe(2760);
    expect(store.body()?.bmi).toBe(24.7);
    expect(store.ai()?.provider).toBe('mock');
    expect(store.needsOnboarding()).toBe(true);
    expect(await store.ensureLoaded()).toBe(store.response());
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });

  it('makes the profile day start the logical day for the whole app', async () => {
    api.getProfile.mockResolvedValue(response({ ...PROFILE, dayStartHour: 5 }));
    const store = create();
    await store.load();
    expect(dayStartHour()).toBe(5);
    expect(localStorage.getItem(DAY_START_STORAGE_KEY)).toBe('5');

    await store.save({ ...PROFILE, dayStartHour: 0 });
    expect(dayStartHour()).toBe(0);
  });

  it('falls back to the default day start when the profile has none', async () => {
    setDayStartHour(6, null);
    const store = create();
    await store.load();
    expect(dayStartHour()).toBe(DEFAULT_DAY_START_HOUR);
  });

  it('shares one request between concurrent loads', async () => {
    const store = create();
    const [a, b, c] = await Promise.all([store.load(), store.load(), store.ensureLoaded()]);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });

  it('reports load failures and resolves ensureLoaded with null', async () => {
    api.getProfile.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
    const store = create();
    expect(await store.ensureLoaded()).toBeNull();
    expect(store.error()).toBe(PROFILE_LOAD_FAILED_MESSAGE);
    expect(store.loaded()).toBe(false);
    expect(store.loading()).toBe(false);

    api.getProfile.mockResolvedValue(response(PROFILE));
    await store.load();
    expect(store.error()).toBeNull();
    expect(store.loaded()).toBe(true);
  });

  it('saves, updates the cache and notifies without reloading itself', async () => {
    const store = create();
    const events = TestBed.inject(DataEventsService);
    await store.load();
    const saved = await store.save({ ...PROFILE, weightKg: 82, onboarded: true });
    expect(api.putProfile).toHaveBeenCalledWith({ ...PROFILE, weightKg: 82, onboarded: true });
    expect(store.response()).toBe(saved);
    expect(store.needsOnboarding()).toBe(false);
    expect(events.profile()).toBe(1);
    TestBed.tick();
    await Promise.resolve();
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });

  it('reloads when the profile changes elsewhere', async () => {
    const store = create();
    const events = TestBed.inject(DataEventsService);
    await store.load();
    api.getProfile.mockResolvedValueOnce(response({ ...PROFILE, weightKg: 78 }));
    events.notify('profile');
    TestBed.tick();
    await store.load();
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(store.profile()?.weightKg).toBe(78);
  });

  it('still reloads for an outside change that lands right before its own save', async () => {
    const store = create();
    const events = TestBed.inject(DataEventsService);
    await store.load();
    events.notify('profile');
    await store.save({ ...PROFILE, age: 41 });
    TestBed.tick();
    await store.load();
    expect(api.getProfile).toHaveBeenCalledTimes(2);
  });

  it('does not fetch on outside changes before anything was loaded', () => {
    create();
    TestBed.inject(DataEventsService).notify('profile');
    TestBed.tick();
    expect(api.getProfile).not.toHaveBeenCalled();
  });

  it('drops a slow response that was overtaken by a save', async () => {
    const slow = deferred<ProfileResponse>();
    api.getProfile.mockReturnValueOnce(slow.promise);
    const store = create();
    const loading = store.load();
    await store.save({ ...PROFILE, age: 40 });
    slow.resolve(response(PROFILE));
    expect((await loading).profile.age).toBe(40);
    expect(store.profile()?.age).toBe(40);
  });

  it('clears the cache when the session resets', async () => {
    const store = create();
    await store.load();
    TestBed.inject(SessionScope).reset();
    expect(store.loaded()).toBe(false);
    expect(store.isFresh(60_000)).toBe(false);
  });

  it('drops a load that was in flight when the session reset', async () => {
    const slow = deferred<ProfileResponse>();
    api.getProfile.mockReturnValueOnce(slow.promise);
    const store = create();
    const loading = store.load();
    TestBed.inject(SessionScope).reset();
    expect(store.loading()).toBe(false);
    slow.resolve(response(PROFILE));
    await loading;
    expect(store.loaded()).toBe(false);
  });

  it('refetches when the cached profile belongs to another user', async () => {
    const store = create();
    await store.load();
    auth.user.set({ id: 'u2', email: 'other@example.com', name: null, role: 'member' });
    await store.ensureLoaded();
    expect(api.getProfile).toHaveBeenCalledTimes(2);
  });

  it('discards a response that arrives after logging out', async () => {
    const slow = deferred<ProfileResponse>();
    api.getProfile.mockReturnValueOnce(slow.promise);
    const store = create();
    const loading = store.load();
    store.clear();
    slow.resolve(response(PROFILE));
    await loading;
    expect(store.loaded()).toBe(false);
  });

  it('applies the profile theme on the first load when the device has none', async () => {
    const store = create();
    const theme = TestBed.inject(ThemeService);
    await store.load();
    expect(theme.preference()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    theme.setPreference('dark');
    api.getProfile.mockResolvedValueOnce(response({ ...PROFILE, theme: 'system' }));
    await store.load();
    expect(theme.preference()).toBe('dark');
  });

  it('keeps the theme saved on this device', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const store = create();
    await store.load();
    expect(TestBed.inject(ThemeService).preference()).toBe('dark');
  });

  describe('fresh', () => {
    it('returns the cached profile when nothing is reloading', async () => {
      const store = create();
      const loaded = await store.load();
      expect(await store.fresh()).toBe(loaded);
      expect(api.getProfile).toHaveBeenCalledTimes(1);
    });

    it('loads the profile when nothing is cached', async () => {
      const store = create();
      expect((await store.fresh()).profile.weightKg).toBe(80);
      expect(api.getProfile).toHaveBeenCalledTimes(1);
    });

    it('waits for a reload in flight instead of returning the old profile', async () => {
      const store = create();
      const events = TestBed.inject(DataEventsService);
      await store.load();
      const reload = deferred<ProfileResponse>();
      api.getProfile.mockReturnValueOnce(reload.promise);
      events.notify('profile');
      TestBed.tick();
      expect(store.loading()).toBe(true);
      const latest = store.fresh();
      reload.resolve(response({ ...PROFILE, weightKg: 76 }));
      expect((await latest).profile.weightKg).toBe(76);
      expect(api.getProfile).toHaveBeenCalledTimes(2);
    });

    it('starts the reload for a change that was announced but not handled yet', async () => {
      const store = create();
      await store.load();
      api.getProfile.mockResolvedValueOnce(response({ ...PROFILE, weightKg: 77 }));
      TestBed.inject(DataEventsService).notify('profile');
      expect((await store.fresh()).profile.weightKg).toBe(77);
      TestBed.tick();
      await Promise.resolve();
      expect(api.getProfile).toHaveBeenCalledTimes(2);
    });

    it('follows a reload that replaced the one it was waiting for', async () => {
      const store = create();
      const events = TestBed.inject(DataEventsService);
      await store.load();
      const first = deferred<ProfileResponse>();
      const second = deferred<ProfileResponse>();
      api.getProfile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      events.notify('profile');
      TestBed.tick();
      const latest = store.fresh();
      events.notify('profile');
      TestBed.tick();
      first.resolve(response({ ...PROFILE, weightKg: 79 }));
      await Promise.resolve();
      second.resolve(response({ ...PROFILE, weightKg: 75 }));
      expect((await latest).profile.weightKg).toBe(75);
    });

    it('retries once more when the reload it waited for failed', async () => {
      const store = create();
      const events = TestBed.inject(DataEventsService);
      await store.load();
      api.getProfile
        .mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }))
        .mockResolvedValueOnce(response({ ...PROFILE, weightKg: 74 }));
      events.notify('profile');
      TestBed.tick();
      expect((await store.fresh()).profile.weightKg).toBe(74);
      expect(api.getProfile).toHaveBeenCalledTimes(3);
    });

    it('rejects when the profile cannot be loaded', async () => {
      api.getProfile.mockRejectedValue(new HttpErrorResponse({ status: 503 }));
      const store = create();
      await expect(store.fresh()).rejects.toBeInstanceOf(HttpErrorResponse);
    });

    it('refetches when the cached profile belongs to another user', async () => {
      const store = create();
      await store.load();
      auth.user.set({ id: 'u2', email: 'other@example.com', name: null, role: 'member' });
      api.getProfile.mockResolvedValueOnce(response({ ...PROFILE, age: 52 }));
      expect((await store.fresh()).profile.age).toBe(52);
      expect(api.getProfile).toHaveBeenCalledTimes(2);
    });
  });

  it('knows how fresh the cache is', async () => {
    const store = create();
    expect(store.isFresh(1000)).toBe(false);
    await store.load();
    expect(store.isFresh(1000)).toBe(true);
    store.clear();
    expect(store.isFresh(1000)).toBe(false);
  });
});
