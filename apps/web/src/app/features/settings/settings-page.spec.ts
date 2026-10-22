import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type AdminOverviewResponse,
  type AiConfigDto,
  type AiProviderResponse,
  type AuthStatusResponse,
  type ProfileDto,
  type ProfileResponse,
  type SessionDto,
  type UsageSummaryResponse,
  type UserDto,
  type WeightSummaryResponse,
  computeBodyMetrics,
  computeTargets,
} from '@food/shared';
import { AiAvailability } from '../../core/ai-availability.service';
import { ApiService } from '../../core/api.service';
import { AUTH_REFRESH_INTERVAL_MS, AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, dayStartHour, setDayStartHour } from '../../core/day-start';
import { KeyboardService } from '../../core/keyboard.service';
import { THEME_STORAGE_KEY, ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { UnsavedWorkService } from '../../core/unsaved-work.service';
import { ProfileStore } from '../../core/profile.store';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { DEFAULT_PROFILE } from './profile-model';
import {
  NAME_SAVED_MESSAGE,
  PASSWORD_CHANGED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  WRONG_PASSWORD_MESSAGE,
} from './sections/account-section';
import { SAVED_MESSAGE, SettingsPage, UNSAVED_KEPT_MESSAGE } from './settings-page';

const PROFILE: ProfileDto = {
  ...DEFAULT_PROFILE,
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  theme: 'dark',
};

function profileResponse(profile: ProfileDto): ProfileResponse {
  const targets = computeTargets(profile);
  return {
    profile,
    targets,
    body: computeBodyMetrics(profile),
    ai: {
      provider: 'mock',
      voice: true,
      customEndpoint: false,
      defaultModel: 'gpt-5.6-sol',
      preciseModel: 'gpt-6-astra',
      activeModel: profile.aiModel ?? 'gpt-5.6-sol',
      reasoningEffort: 'low',
      availableModels: [
        {
          id: 'gpt-5.6-sol',
          label: 'GPT-5.6 Sol',
          description: 'Default.',
          estCostPerRequestUsd: 0.0412,
          recommended: true,
        },
        {
          id: 'gpt-6-luna',
          label: 'GPT-6 Luna',
          description: 'Cheapest.',
          estCostPerRequestUsd: 0.001,
          recommended: false,
        },
      ],
      monthlyBudgetUsd: 10,
    },
  };
}

const USAGE: UsageSummaryResponse = {
  month: '2026-09',
  monthToDateUsd: 1.25,
  monthRequests: 30,
  monthFailedRequests: 2,
  last30DaysUsd: 1.5,
  allTimeUsd: 4,
  avgCostPerRequestUsd: 0.0417,
  byModel: [{ model: 'gpt-5.6-sol', requests: 30, costUsd: 1.25 }],
  recent: [
    {
      id: 'u1',
      createdAt: '2026-09-28T10:00:00.000Z',
      model: 'gpt-5.6-sol',
      mode: 'food_photo',
      inputTokens: 2800,
      outputTokens: 1500,
      reasoningTokens: 400,
      costUsd: 0.0412,
      durationMs: 8200,
      success: false,
      errorKind: 'rate_limit',
    },
  ],
  budgetUsd: 10,
};

const EMPTY_WEIGHTS: WeightSummaryResponse = {
  from: '2026-08-30',
  to: '2026-09-28',
  logs: [],
  trend: [],
  latest: null,
  weeklyChangeKg: null,
  adaptiveTdee: null,
};

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const SESSIONS: SessionDto[] = [
  {
    id: 's-mac',
    userAgent: MAC_UA,
    createdAt: '2026-09-01T08:00:00.000Z',
    lastSeenAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    current: false,
  },
  {
    id: 's-phone',
    userAgent: IPHONE_UA,
    createdAt: '2026-08-20T08:00:00.000Z',
    lastSeenAt: new Date().toISOString(),
    current: true,
  },
  {
    id: 's-android',
    userAgent: ANDROID_UA,
    createdAt: '2026-09-20T08:00:00.000Z',
    lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    current: false,
  },
];

const MEMBER: UserDto = { id: 'u1', email: 'me@example.com', name: null, role: 'member' };

const NO_PROVIDER: AiProviderResponse = {
  source: 'none',
  editable: true,
  active: false,
  voice: false,
  keyUnreadable: false,
  settings: null,
  server: null,
};

function withAiProvider(provider: AiConfigDto['provider']): ProfileResponse {
  const response = profileResponse(PROFILE);
  return { ...response, ai: { ...response.ai, provider } };
}

function signedIn(user: UserDto): AuthStatusResponse {
  return { setupRequired: false, authenticated: true, user };
}

const OVERVIEW: AdminOverviewResponse = {
  users: 4,
  activeUsers30d: 3,
  pendingRequests: 2,
  pendingInvites: 0,
  aiCostMonthUsd: 3,
  aiRequestsMonth: 60,
  globalBudgetUsd: null,
  memberDefaultBudgetUsd: 5,
};

function createApi() {
  return {
    sessions: vi.fn(async (): Promise<SessionDto[]> => SESSIONS.map((s) => ({ ...s }))),
    revokeSession: vi.fn(async (_id: string): Promise<void> => undefined),
    updateAccount: vi.fn(async (body: { name: string | null }): Promise<UserDto> => ({
      ...MEMBER,
      name: body.name,
    })),
    adminOverview: vi.fn(async (): Promise<AdminOverviewResponse> => OVERVIEW),
    getProfile: vi.fn(async () => profileResponse(PROFILE)),
    putProfile: vi.fn(async (body: ProfileDto) => profileResponse(body)),
    weights: vi.fn(async (): Promise<WeightSummaryResponse> => EMPTY_WEIGHTS),
    usage: vi.fn(async () => USAGE),
    health: vi.fn(async () => ({ status: 'ok' as const, version: '1.2.3' })),
    exportUrl: vi.fn((format: string) => `/api/export?format=${format}`),
    authStatus: vi.fn(async (): Promise<AuthStatusResponse> => signedIn(MEMBER)),
    logout: vi.fn(),
    changePassword: vi.fn(),
    hiddenFoods: vi.fn(async () => ({ names: ['khoury strawberry yogurt'] })),
    unhideFood: vi.fn(async () => ({ names: [] as string[] })),
    adminAiProvider: vi.fn(async (): Promise<AiProviderResponse> => NO_PROVIDER),
    adminSaveAiProvider: vi.fn(async (): Promise<AiProviderResponse> => ({
      ...NO_PROVIDER,
      source: 'app',
      active: true,
      settings: {
        provider: 'anthropic',
        baseUrl: null,
        apiStyle: 'chat',
        model: 'claude-sonnet-5-5',
        preciseModel: 'claude-opus-5-5',
        hasApiKey: true,
        apiKeyLast4: '0000',
        voiceEnabled: true,
        transcribeBaseUrl: null,
        transcribeModel: null,
        hasTranscribeApiKey: false,
        transcribeApiKeyLast4: null,
        updatedAt: '2026-10-22T10:00:00.000Z',
      },
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

function badRequest(...message: string[]): HttpErrorResponse {
  return new HttpErrorResponse({ status: 400, error: { statusCode: 400, message } });
}

function saveBar(root: HTMLElement): Element | null {
  return root.querySelector('[aria-label="Unsaved changes"]');
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) {
    throw new Error(`No button "${text}"`);
  }
  return button;
}

describe('SettingsPage', () => {
  let api: ReturnType<typeof createApi>;

  beforeEach(() => {
    localStorage.clear();
    api = createApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  afterEach(() => {
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
    localStorage.clear();
  });

  async function setup() {
    const fixture = TestBed.createComponent(SettingsPage);
    await fixture.whenStable();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, input: (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)! };
  }

  it('lists hidden suggestions in their own section with a jump link', async () => {
    const { el } = await setup();
    const nav = el.querySelector('nav[aria-label="Settings sections"]');
    const labels = Array.from(nav?.querySelectorAll('button') ?? []).map((b) =>
      b.textContent?.trim(),
    );
    expect(labels).toContain('Hidden');
    expect(labels.indexOf('Hidden')).toBe(labels.indexOf('Data') - 1);
    const section = el.querySelector('#settings-hidden-foods');
    expect(section?.textContent).toContain('Hidden suggestions');
    expect(section?.textContent).toContain('Khoury strawberry yogurt');
    expect(api.hiddenFoods).toHaveBeenCalledTimes(1);
  });

  it('loads the profile into the form without showing the save bar', async () => {
    const { el, input } = await setup();
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(input('profile-weight').value).toBe('80');
    expect(input('profile-height').value).toBe('180');
    expect(el.querySelector<HTMLSelectElement>('#profile-activity')!.value).toBe('moderate');
    expect(el.textContent).toContain('Demo mode: results are simulated');
    expect(el.textContent).toContain('2,759');
    expect(el.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
  });

  it('updates the live preview and shows the save bar while editing', async () => {
    const { fixture, el, input } = await setup();
    typeInto(input('profile-weight'), '90');
    await fixture.whenStable();
    const tdee = computeTargets({ ...PROFILE, weightKg: 90 }).tdee!;
    expect(el.textContent).toContain(tdee.toLocaleString('en-US'));
    const bar = el.querySelector('[aria-label="Unsaved changes"]');
    expect(bar?.textContent).toContain('Weight');

    buttonByText(el, 'Discard').click();
    await fixture.whenStable();
    expect(input('profile-weight').value).toBe('80');
    expect(el.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
  });

  it('tells an app update that there are unsaved settings', async () => {
    const { fixture, el, input } = await setup();
    const unsaved = TestBed.inject(UnsavedWorkService);
    expect(unsaved.hasUnsavedWork()).toBe(false);
    typeInto(input('profile-weight'), '90');
    await fixture.whenStable();
    expect(unsaved.hasUnsavedWork()).toBe(true);
    buttonByText(el, 'Discard').click();
    await fixture.whenStable();
    expect(unsaved.hasUnsavedWork()).toBe(false);
    typeInto(input('profile-weight'), '91');
    await fixture.whenStable();
    fixture.destroy();
    expect(unsaved.hasUnsavedWork()).toBe(false);
  });

  it('lets targets be overridden and reset to auto', async () => {
    const { fixture, el, input } = await setup();
    const calories = input('target-calories');
    expect(calories.placeholder).toBe('2760');
    typeInto(calories, '2500');
    await fixture.whenStable();
    expect(el.textContent).toContain('custom');
    expect(input('target-carbs').placeholder).toBe(
      String(computeTargets({ ...PROFILE, targetOverrides: { calories: 2500 } }).base.carbs),
    );

    el.querySelector<HTMLButtonElement>('button[aria-label="Use the automatic calories"]')!.click();
    await fixture.whenStable();
    expect(calories.value).toBe('');
    expect(el.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
  });

  it('blocks saving invalid values and shows the error inline', async () => {
    const { fixture, el, input } = await setup();
    typeInto(input('target-calories'), '50');
    await fixture.whenStable();
    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    expect(api.putProfile).not.toHaveBeenCalled();
    expect(el.querySelector('#target-calories-error')?.textContent).toContain(
      'Calories must be between 800 and 8,000 kcal.',
    );
  });

  it('saves the full profile and clears the dirty state', async () => {
    const { fixture, el, input } = await setup();
    const toast = TestBed.inject(ToastService);
    typeInto(input('profile-weight'), '82,5');
    typeInto(input('target-calories'), '2500');
    typeInto(input('ai-location'), '  Beirut, Lebanon ');
    await fixture.whenStable();
    const luna = Array.from(el.querySelectorAll<HTMLInputElement>('app-model-picker input')).find(
      (radio) => radio.value === 'gpt-6-luna',
    )!;
    luna.click();
    await fixture.whenStable();

    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(api.putProfile).toHaveBeenCalledWith({
      ...PROFILE,
      weightKg: 82.5,
      targetOverrides: { calories: 2500 },
      location: 'Beirut, Lebanon',
      aiModel: 'gpt-6-luna',
    });
    expect(el.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    expect(toast.toasts().some((t) => t.message === SAVED_MESSAGE)).toBe(true);
  });

  describe('day and fluids', () => {
    function daySelect(el: HTMLElement): HTMLSelectElement {
      return el.querySelector<HTMLSelectElement>('#settings-day-start')!;
    }

    function pickDayStart(el: HTMLElement, hour: number): void {
      const select = daySelect(el);
      select.value = String(hour);
      select.dispatchEvent(new Event('change'));
    }

    it('shows when the day starts and the automatic daily fluids', async () => {
      const { el, input } = await setup();
      const nav = el.querySelector('nav[aria-label="Settings sections"]');
      const labels = Array.from(nav?.querySelectorAll('button') ?? []).map((b) =>
        b.textContent?.trim(),
      );
      expect(labels.indexOf('Day')).toBe(labels.indexOf('Targets') + 1);

      const select = daySelect(el);
      expect(Array.from(select.options).map((option) => option.textContent?.trim())).toEqual([
        'Midnight',
        '1 am',
        '2 am',
        '3 am',
        '4 am',
        '5 am',
        '6 am',
      ]);
      expect(select.value).toBe('3');
      expect(el.querySelector('#settings-day-start-hint')?.textContent).toContain(
        'Food you log before 3 am counts toward the day before.',
      );
      expect(input('settings-fluid-target').placeholder).toBe('2.8');
      expect(el.querySelector('#settings-fluid-target-hint')?.textContent).toContain(
        'Auto 2.8 L (from your weight), 3.3 L on training days',
      );
      expect(saveBar(el)).toBeNull();
    });

    it('saves a new day start and moves the logical day right away', async () => {
      const { fixture, el } = await setup();
      pickDayStart(el, 0);
      await fixture.whenStable();
      expect(el.querySelector('#settings-day-start-hint')?.textContent).toContain(
        'Each day starts at midnight.',
      );
      expect(saveBar(el)?.textContent).toContain('Day starts at');
      expect(dayStartHour()).toBe(3);

      buttonByText(el, 'Save').click();
      await fixture.whenStable();
      await fixture.whenStable();
      expect(api.putProfile).toHaveBeenCalledWith({ ...PROFILE, dayStartHour: 0 });
      expect(dayStartHour()).toBe(0);
      expect(saveBar(el)).toBeNull();
    });

    it('saves custom daily fluids in litres and goes back to auto', async () => {
      const { fixture, el, input } = await setup();
      typeInto(input('settings-fluid-target'), '3,5');
      await fixture.whenStable();
      expect(saveBar(el)?.textContent).toContain('Daily fluids');
      expect(
        el.querySelector('#settings-fluid-target-hint')?.textContent?.replace(/\s+/g, ' ').trim(),
      ).toBe('Same every day · auto 2.8 L · custom');

      buttonByText(el, 'Save').click();
      await fixture.whenStable();
      await fixture.whenStable();
      expect(api.putProfile).toHaveBeenLastCalledWith({ ...PROFILE, fluidTargetMl: 3500 });
      expect(input('settings-fluid-target').value).toBe('3.5');

      el.querySelector<HTMLButtonElement>(
        'button[aria-label="Use the automatic daily fluids"]',
      )!.click();
      await fixture.whenStable();
      expect(input('settings-fluid-target').value).toBe('');
      buttonByText(el, 'Save').click();
      await fixture.whenStable();
      await fixture.whenStable();
      expect(api.putProfile).toHaveBeenLastCalledWith({ ...PROFILE, fluidTargetMl: null });
    });

    it('blocks daily fluids outside 0.5 to 8 litres', async () => {
      const { fixture, el, input } = await setup();
      typeInto(input('settings-fluid-target'), '9');
      await fixture.whenStable();
      buttonByText(el, 'Save').click();
      await fixture.whenStable();
      expect(api.putProfile).not.toHaveBeenCalled();
      expect(el.querySelector('#settings-fluid-target-error')?.textContent).toContain(
        'Daily fluids must be between 0.5 and 8 L.',
      );
    });

    it('shows the saved custom target and treats a missing day start as the default', async () => {
      const saved: ProfileDto = { ...PROFILE, fluidTargetMl: 3200 };
      delete saved.dayStartHour;
      api.getProfile.mockResolvedValue(profileResponse(saved));
      const { el, input } = await setup();
      expect(input('settings-fluid-target').value).toBe('3.2');
      expect(daySelect(el).value).toBe('3');
      expect(saveBar(el)).toBeNull();
    });
  });

  it('maps server validation errors to fields', async () => {
    api.putProfile.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 400,
        error: { statusCode: 400, message: ['heightCm must not be greater than 240'] },
      }),
    );
    const { fixture, el, input } = await setup();
    typeInto(input('profile-height'), '245');
    await fixture.whenStable();
    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('#profile-height-error')?.textContent).toContain(
      'Height must not be greater than 240.',
    );
    expect(el.querySelector('[aria-label="Unsaved changes"]')).not.toBeNull();
  });

  it('shows the inline error when the server rejects the chosen model', async () => {
    api.putProfile.mockRejectedValueOnce(
      badRequest('aiModel must be null or one of: gpt-5.6-sol, gpt-6-sol'),
    );
    const { fixture, el } = await setup();
    const luna = Array.from(el.querySelectorAll<HTMLInputElement>('app-model-picker input')).find(
      (radio) => radio.value === 'gpt-6-luna',
    )!;
    luna.click();
    await fixture.whenStable();
    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('#ai-model-error')?.textContent).toContain(
      'AI model must be null or one of: gpt-5.6-sol, gpt-6-sol.',
    );
    expect(
      el.querySelector('app-model-picker [role="radiogroup"]')?.getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('toasts server errors for fields without an inline message and lets you retry', async () => {
    api.putProfile.mockRejectedValueOnce(
      badRequest('activityLevel must be one of the following values: sedentary, light'),
    );
    const { fixture, el, input } = await setup();
    const toast = TestBed.inject(ToastService);
    typeInto(input('profile-weight'), '81');
    await fixture.whenStable();
    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(toast.toasts().map((t) => t.message)).toContain(
      'Activity level must be one of the following values: sedentary, light.',
    );

    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.putProfile).toHaveBeenCalledTimes(2);
    expect(saveBar(el)).toBeNull();
  });

  it('keeps unsaved edits when you leave the page and restores them when you come back', async () => {
    const first = await setup();
    typeInto(first.input('profile-weight'), '90');
    await first.fixture.whenStable();
    first.fixture.destroy();
    const toast = TestBed.inject(ToastService);
    expect(toast.toasts().find((t) => t.message === UNSAVED_KEPT_MESSAGE)?.action?.label).toBe(
      'Review',
    );

    const second = await setup();
    expect(second.input('profile-weight').value).toBe('90');
    expect(saveBar(second.el)?.textContent).toContain('Weight');

    buttonByText(second.el, 'Discard').click();
    await second.fixture.whenStable();
    second.fixture.destroy();
    const third = await setup();
    expect(third.input('profile-weight').value).toBe('80');
  });

  async function changeProfileElsewhere(profile: ProfileDto): Promise<void> {
    api.getProfile.mockResolvedValue(profileResponse(profile));
    TestBed.inject(DataEventsService).notify('profile');
    TestBed.tick();
    await TestBed.inject(ProfileStore).load();
  }

  it('keeps unsaved edits when the saved profile changed elsewhere', async () => {
    const first = await setup();
    typeInto(first.input('profile-height'), '181');
    await first.fixture.whenStable();
    first.fixture.destroy();
    await changeProfileElsewhere({ ...PROFILE, weightKg: 78.5 });

    const second = await setup();
    expect(second.input('profile-height').value).toBe('181');
    expect(second.input('profile-weight').value).toBe('78.5');
    expect(saveBar(second.el)?.textContent).toContain('Height');
    expect(saveBar(second.el)?.textContent).not.toContain('Weight');

    buttonByText(second.el, 'Save').click();
    await second.fixture.whenStable();
    await second.fixture.whenStable();
    expect(api.putProfile).toHaveBeenCalledWith({ ...PROFILE, heightCm: 181, weightKg: 78.5 });
  });

  it('keeps the unsaved value when the same field changed elsewhere', async () => {
    const first = await setup();
    typeInto(first.input('profile-weight'), '90');
    await first.fixture.whenStable();
    first.fixture.destroy();
    await changeProfileElsewhere({ ...PROFILE, weightKg: 78.5, age: 31 });

    const second = await setup();
    expect(second.input('profile-weight').value).toBe('90');
    expect(second.input('profile-age').value).toBe('31');
    expect(saveBar(second.el)?.textContent).toContain('Weight');
    expect(saveBar(second.el)?.textContent).not.toContain('Age');
  });

  it('forgets unsaved edits after logging out', async () => {
    const first = await setup();
    typeInto(first.input('profile-weight'), '90');
    await first.fixture.whenStable();
    TestBed.inject(AuthService).markLoggedOut();
    first.fixture.destroy();
    const toast = TestBed.inject(ToastService);
    expect(toast.toasts().some((t) => t.message === UNSAVED_KEPT_MESSAGE)).toBe(false);

    const second = await setup();
    expect(second.input('profile-weight').value).toBe('80');
  });

  it('sends no requests when the session ends while the page is open', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.load();
    const { fixture } = await setup();
    const before = [api.getProfile, api.weights, api.usage].map((fn) => fn.mock.calls.length);

    auth.markLoggedOut();
    await fixture.whenStable();
    await fixture.whenStable();

    expect([api.getProfile, api.weights, api.usage].map((fn) => fn.mock.calls.length)).toEqual(
      before,
    );
  });

  it('applies the theme immediately and saves it with the profile', async () => {
    const { fixture, el } = await setup();
    const theme = TestBed.inject(ThemeService);
    const light = Array.from(
      el.querySelectorAll<HTMLInputElement>('app-appearance-section input[type="radio"]'),
    ).find((radio) => radio.value === 'light')!;
    light.click();
    await fixture.whenStable();
    expect(theme.preference()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(el.querySelector('[aria-label="Unsaved changes"]')?.textContent).toContain('Theme');

    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.putProfile).toHaveBeenCalledWith({ ...PROFILE, theme: 'light' });
  });

  it('shows usage, budget and failed requests', async () => {
    const { el } = await setup();
    const usage = el.querySelector('#settings-usage')!;
    expect(usage.textContent).toContain('$1.25');
    expect(usage.textContent).toContain('2 failed');
    expect(usage.textContent).toContain('$0.042');
    expect(usage.textContent).toContain('Failed: rate limit');
    expect(usage.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('13');
  });

  it('shows your monthly AI budget against this month’s usage with one usage request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    try {
      const { el } = await setup();
      const ai = el.querySelector('#settings-ai')!;
      expect(ai.textContent).toContain('Your monthly AI budget');
      expect(ai.textContent?.replace(/\s+/g, ' ')).toContain('$1.25 / $10.00');
      const bar = ai.querySelector('[role="progressbar"]')!;
      expect(bar.getAttribute('aria-valuenow')).toBe('13');
      expect(bar.getAttribute('aria-valuetext')).toBe('$1.25 of $10.00');
      expect(ai.textContent).toContain('$8.75 left');
      expect(api.usage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('says when your account has no monthly AI limit', async () => {
    const unlimited = profileResponse(PROFILE);
    api.getProfile.mockResolvedValue({
      ...unlimited,
      ai: { ...unlimited.ai, monthlyBudgetUsd: null },
    });
    const { el } = await setup();
    const ai = el.querySelector('#settings-ai')!;
    expect(ai.textContent).toContain('No limit');
    expect(ai.textContent).toContain('$1.25 used this month.');
    expect(ai.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('still loads older months in the usage section', async () => {
    const { fixture, el } = await setup();
    const select = el.querySelector<HTMLSelectElement>('#usage-month')!;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.usage).toHaveBeenCalledTimes(2);
    expect(api.usage).toHaveBeenLastCalledWith(select.options[1].value);
    select.value = select.options[0].value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(api.usage).toHaveBeenCalledTimes(2);
    expect(el.querySelector('#settings-usage')?.textContent).toContain('2 failed');
  });

  it('waits for a profile reload in flight before saving the full profile', async () => {
    const { fixture, el, input } = await setup();
    typeInto(input('profile-height'), '181');
    await fixture.whenStable();
    const reload = deferred<ProfileResponse>();
    api.getProfile.mockReturnValueOnce(reload.promise);
    TestBed.inject(DataEventsService).notify('weights', 'profile');
    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    expect(api.putProfile).not.toHaveBeenCalled();

    reload.resolve(profileResponse({ ...PROFILE, weightKg: 76 }));
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.putProfile).toHaveBeenCalledTimes(1);
    expect(api.putProfile).toHaveBeenCalledWith({ ...PROFILE, weightKg: 76, heightCm: 181 });
    expect(saveBar(el)).toBeNull();
  });

  it('reloads for the new account when a different user becomes signed in', async () => {
    const auth = TestBed.inject(AuthService);
    await auth.load();
    const { fixture, el, input } = await setup();
    typeInto(input('profile-weight'), '90');
    await fixture.whenStable();
    expect(saveBar(el)).not.toBeNull();

    api.getProfile.mockResolvedValue(profileResponse({ ...PROFILE, weightKg: 55, age: 41 }));
    api.authStatus.mockResolvedValue(
      signedIn({ id: 'u2', email: 'other@example.com', name: null, role: 'member' }),
    );
    await auth.load();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(input('profile-weight').value).toBe('55');
    expect(input('profile-age').value).toBe('41');
    expect(saveBar(el)).toBeNull();
    expect(api.usage).toHaveBeenCalledTimes(2);
    expect(api.weights).toHaveBeenCalledTimes(2);
  });

  it('keeps the save bar just above the on-screen keyboard', async () => {
    const keyboardOpen = signal(false);
    TestBed.overrideProvider(KeyboardService, { useValue: { open: keyboardOpen } });
    const { fixture, el, input } = await setup();
    typeInto(input('profile-weight'), '90');
    await fixture.whenStable();
    expect(saveBar(el)?.getAttribute('style')).toContain('5.75rem');
    keyboardOpen.set(true);
    await fixture.whenStable();
    expect(saveBar(el)?.getAttribute('style')).toContain('bottom: 0.75rem');
  });

  it('changes the password with validation and explains server rejections', async () => {
    api.changePassword
      .mockRejectedValueOnce(badRequest('Current password is incorrect'))
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 401 }))
      .mockResolvedValueOnce(undefined);
    const { fixture, el, input } = await setup();
    const toast = TestBed.inject(ToastService);
    buttonByText(el, 'Change password').click();
    await fixture.whenStable();
    typeInto(input('account-current-password'), 'old-password');
    typeInto(input('account-new-password'), 'new-password-1');
    typeInto(input('account-confirm-password'), 'new-password-2');
    await fixture.whenStable();
    buttonByText(el, 'Update').click();
    await fixture.whenStable();
    expect(api.changePassword).not.toHaveBeenCalled();
    expect(el.querySelector('#account-confirm-password-error')?.textContent).toContain(
      'Passwords do not match.',
    );

    typeInto(input('account-confirm-password'), 'new-password-1');
    await fixture.whenStable();
    buttonByText(el, 'Update').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'new-password-1',
    });
    expect(el.querySelector('#account-current-password-error')?.textContent).toContain(
      WRONG_PASSWORD_MESSAGE,
    );

    typeInto(input('account-current-password'), 'old-password!');
    await fixture.whenStable();
    buttonByText(el, 'Update').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('#account-password-form [role="alert"]')?.textContent).toContain(
      SESSION_EXPIRED_MESSAGE,
    );

    buttonByText(el, 'Update').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(toast.toasts().some((t) => t.message === PASSWORD_CHANGED_MESSAGE)).toBe(true);
    expect(el.querySelector('#account-password-form')).toBeNull();
    expect(api.sessions).toHaveBeenCalledTimes(2);
  });

  it('edits body fat and the daily calorie burn with a way back to the formula', async () => {
    const { fixture, el, input } = await setup();
    const formula = computeTargets(PROFILE).tdee!;
    expect(input('profile-tdee').placeholder).toBe(String(formula));
    expect(el.querySelector('#profile-tdee-hint')?.textContent).toContain('Mifflin-St Jeor');

    typeInto(input('profile-body-fat'), '15');
    await fixture.whenStable();
    expect(el.querySelector('#profile-tdee-hint')?.textContent).toContain('Katch-McArdle');

    typeInto(input('profile-tdee'), '2600');
    await fixture.whenStable();
    expect(el.querySelector('#profile-tdee-hint')?.textContent).toContain(
      `The formula estimate is ${computeTargets({ ...PROFILE, bodyFatPct: 15 }).tdee!.toLocaleString('en-US')} kcal.`,
    );
    expect(saveBar(el)?.textContent).toContain('Daily calorie burn');

    buttonByText(el, 'Use formula').click();
    await fixture.whenStable();
    expect(input('profile-tdee').value).toBe('');

    typeInto(input('profile-tdee'), '100');
    await fixture.whenStable();
    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    expect(api.putProfile).not.toHaveBeenCalled();
    expect(el.querySelector('#profile-tdee-error')?.textContent).toContain(
      'Daily calorie burn must be between 800 and 8,000 kcal.',
    );
  });

  it('saves the new body fields and notifies other screens', async () => {
    const { fixture, el, input } = await setup();
    const events = TestBed.inject(DataEventsService);
    typeInto(input('profile-body-fat'), '18,5');
    typeInto(input('profile-tdee'), '2650');
    await fixture.whenStable();
    buttonByText(el, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.putProfile).toHaveBeenCalledWith({
      ...PROFILE,
      bodyFatPct: 18.5,
      tdeeOverride: 2650,
    });
    expect(events.profile()).toBe(1);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(saveBar(el)).toBeNull();
  });

  it('shows body metrics that follow the form', async () => {
    const { fixture, el, input } = await setup();
    const body = el.querySelector('#settings-body')!;
    expect(body.textContent).toContain('24.7');
    expect(body.textContent).toContain('Healthy range');
    expect(body.textContent).toContain('Add your body fat %');

    typeInto(input('profile-body-fat'), '15');
    await fixture.whenStable();
    expect(body.textContent).toContain('68.0 kg');
    expect(body.textContent).toContain('Normalized FFMI 21.0');
    expect(body.textContent).toContain('Above average');
  });

  it('shows the latest weigh-in with its trend and links to the weight stats', async () => {
    api.weights.mockResolvedValue({
      ...EMPTY_WEIGHTS,
      logs: [{ date: '2026-09-27', weightKg: 79.4, bodyFatPct: null }],
      trend: [
        { date: '2026-09-27', weightKg: 79.4, trendKg: 79.82 },
        { date: '2026-09-28', weightKg: null, trendKg: null },
      ],
      latest: { date: '2026-09-27', weightKg: 79.4, bodyFatPct: null },
      weeklyChangeKg: -0.42,
    });
    const { el } = await setup();
    const body = el.querySelector('#settings-body')!;
    expect(body.textContent).toContain('79.4 kg');
    expect(body.textContent).toContain('79.8 kg');
    expect(body.textContent).toContain('−0.4 kg');
    const link = body.querySelector<HTMLAnchorElement>('a[href^="/stats"]')!;
    expect(link.getAttribute('href')).toBe('/stats?tab=weight');
  });

  it('keeps the weigh-ins on screen while they refresh', async () => {
    api.weights.mockResolvedValueOnce({
      ...EMPTY_WEIGHTS,
      logs: [{ date: '2026-09-27', weightKg: 79.4, bodyFatPct: null }],
      latest: { date: '2026-09-27', weightKg: 79.4, bodyFatPct: null },
    });
    const { fixture, el } = await setup();
    api.weights.mockReturnValueOnce(new Promise<WeightSummaryResponse>(() => undefined));
    TestBed.inject(DataEventsService).notify('entries');
    TestBed.tick();
    await Promise.resolve();
    fixture.detectChanges();
    expect(api.weights).toHaveBeenCalledTimes(2);
    const body = el.querySelector('#settings-body')!;
    expect(body.textContent).toContain('79.4 kg');
    expect(body.textContent).not.toContain('Loading weigh-ins');
  });

  it('refreshes weigh-ins when weights change elsewhere', async () => {
    const { fixture } = await setup();
    expect(api.weights).toHaveBeenCalledTimes(1);
    TestBed.inject(DataEventsService).notify('weights');
    await fixture.whenStable();
    expect(api.weights).toHaveBeenCalledTimes(2);
  });

  it('offers the measured burn from the weight log', async () => {
    api.weights.mockResolvedValue({
      ...EMPTY_WEIGHTS,
      adaptiveTdee: {
        kcal: 2650,
        windowDays: 28,
        loggedDays: 26,
        weighIns: 14,
        avgIntakeKcal: 2400,
        weightChangeKg: -0.9,
        confidence: 'medium',
      },
    });
    const { fixture, el, input } = await setup();
    expect(el.textContent).toContain('Measured burn ≈ 2,650 kcal');
    expect(el.textContent).toContain('26 logged days and 14 weigh-ins');
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Use the measured burn of 2,650 kcal"]',
    )!.click();
    await fixture.whenStable();
    expect(input('profile-tdee').value).toBe('2650');
    expect(el.textContent).toContain('In use');
    expect(saveBar(el)?.textContent).toContain('Daily calorie burn');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Use the formula for your daily calorie burn',
    );
  });

  it('keeps the page usable when weigh-ins cannot be loaded', async () => {
    api.weights.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    const { fixture, el } = await setup();
    expect(el.textContent).toContain('Weigh-ins are unavailable right now.');
    buttonByText(el, 'Retry').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.textContent).toContain('No weigh-ins yet');
  });

  it('links to the setup wizard', async () => {
    const { el } = await setup();
    const link = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Redo setup wizard'),
    );
    expect(link?.getAttribute('href')).toBe('/onboarding');
  });

  it('shows the cached profile instantly on the next visit', async () => {
    const first = await setup();
    first.fixture.destroy();
    const second = TestBed.createComponent(SettingsPage);
    second.detectChanges();
    const el = second.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLInputElement>('#profile-weight')?.value).toBe('80');
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });

  it('picks up profile changes made elsewhere while keeping unsaved edits', async () => {
    const { fixture, el, input } = await setup();
    typeInto(input('profile-height'), '181');
    await fixture.whenStable();
    api.getProfile.mockResolvedValueOnce(profileResponse({ ...PROFILE, weightKg: 78.5 }));
    TestBed.inject(DataEventsService).notify('profile');
    await fixture.whenStable();
    await fixture.whenStable();
    expect(input('profile-weight').value).toBe('78.5');
    expect(input('profile-height').value).toBe('181');
    expect(saveBar(el)?.textContent).toContain('Height');
    expect(saveBar(el)?.textContent).not.toContain('Weight');
  });

  it('shows a retry state when the profile cannot be loaded', async () => {
    api.getProfile.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    const { fixture, el } = await setup();
    expect(el.textContent).toContain('Settings unavailable');
    buttonByText(el, 'Try again').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(el.querySelector('#profile-weight')).not.toBeNull();
  });

  it('lists signed-in devices with this device first', async () => {
    const { el } = await setup();
    const devices = el.querySelector('#settings-devices')!;
    const rows = Array.from(devices.querySelectorAll('li'));
    expect(rows.map((row) => row.querySelector('.font-semibold')?.textContent?.trim())).toEqual([
      'Safari on iPhone',
      'Chrome on Mac',
      'Chrome on Android phone',
    ]);
    expect(rows[0].textContent).toContain('This device');
    expect(rows[0].textContent).toContain('Active now');
    expect(rows[1].textContent).toContain('Active 2 h ago');
    expect(rows[0].querySelector('button')).toBeNull();
  });

  it('signs out a single device after confirming', async () => {
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const { fixture, el } = await setup();
    const toast = TestBed.inject(ToastService);
    el.querySelector<HTMLButtonElement>('button[aria-label="Sign out Chrome on Mac"]')!.click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sign out Chrome on Mac?',
        confirmLabel: 'Sign out',
        tone: 'danger',
      }),
    );
    expect(api.revokeSession).toHaveBeenCalledWith('s-mac');
    expect(el.querySelector('#settings-devices')?.textContent).not.toContain('Chrome on Mac');
    expect(toast.toasts().some((t) => t.message === 'Signed out Chrome on Mac.')).toBe(true);
  });

  it('keeps a device signed in when the sign-out is cancelled', async () => {
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);
    const { fixture, el } = await setup();
    const toast = TestBed.inject(ToastService);
    el.querySelector<HTMLButtonElement>('button[aria-label="Sign out Chrome on Mac"]')!.click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.revokeSession).not.toHaveBeenCalled();
    expect(el.querySelector('#settings-devices')?.textContent).toContain('Chrome on Mac');
    expect(toast.toasts().some((t) => t.message === 'Signed out Chrome on Mac.')).toBe(false);
  });

  it('treats a device that was already signed out as gone', async () => {
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    api.revokeSession.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    const { fixture, el } = await setup();
    el.querySelector<HTMLButtonElement>('button[aria-label="Sign out Chrome on Mac"]')!.click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('#settings-devices')?.textContent).not.toContain('Chrome on Mac');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .some((t) => t.message === 'Signed out Chrome on Mac.'),
    ).toBe(true);
  });

  it('puts a device back when signing it out fails', async () => {
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    api.revokeSession.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    const { fixture, el } = await setup();
    el.querySelector<HTMLButtonElement>('button[aria-label="Sign out Chrome on Mac"]')!.click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.revokeSession).toHaveBeenCalledWith('s-mac');
    expect(el.querySelector('#settings-devices')?.textContent).toContain('Chrome on Mac');
  });

  it('signs out every other device after confirming', async () => {
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const { fixture, el } = await setup();
    buttonByText(el, 'Sign out all 2 other devices').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(confirm).toHaveBeenCalled();
    expect(api.revokeSession.mock.calls.map(([id]) => id).sort()).toEqual(['s-android', 's-mac']);
    const devices = el.querySelector('#settings-devices')!;
    expect(devices.querySelectorAll('li').length).toBe(1);
    expect(devices.textContent).toContain('This is the only device signed in');
  });

  it('edits the display name', async () => {
    await TestBed.inject(AuthService).load();
    const { fixture, el, input } = await setup();
    const account = el.querySelector('#settings-account')!;
    expect(account.textContent).toContain('Not set');
    expect(account.textContent).toContain('me@example.com');
    account.querySelector<HTMLButtonElement>('button[aria-label="Add your name"]')!.click();
    await fixture.whenStable();
    const name = input('account-name');
    name.value = '  Chris  ';
    name.dispatchEvent(new Event('input'));
    buttonByText(account as HTMLElement, 'Save').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.updateAccount).toHaveBeenCalledWith({ name: 'Chris' });
    expect(account.textContent).toContain('Chris');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .some((t) => t.message === NAME_SAVED_MESSAGE),
    ).toBe(true);
  });

  it('shows the admin row with pending requests to admins only', async () => {
    const member = await setup();
    expect(member.el.querySelector('app-admin-entry a')).toBeNull();
    expect(api.adminOverview).not.toHaveBeenCalled();
    member.fixture.destroy();

    api.authStatus.mockResolvedValue(signedIn({ ...MEMBER, role: 'admin' }));
    await TestBed.inject(AuthService).load();
    const admin = await setup();
    const row = admin.el.querySelector<HTMLAnchorElement>('app-admin-entry a')!;
    expect(row.getAttribute('href')).toBe('/admin?tab=requests');
    expect(row.textContent).toContain('2 people are waiting for access');
    expect(row.textContent).toContain('2');
  });

  it('shows the AI provider card to admins only', async () => {
    api.getProfile.mockResolvedValue(withAiProvider('unconfigured'));
    await TestBed.inject(AuthService).load();
    const member = await setup();
    const memberAi = member.el.querySelector('#settings-ai')!;
    expect(memberAi.querySelector('[data-testid="ai-provider-card"]')).toBeNull();
    expect(memberAi.textContent).toContain("AI estimates aren't set up on this server.");
    expect(api.adminAiProvider).not.toHaveBeenCalled();
    member.fixture.destroy();

    api.authStatus.mockResolvedValue(signedIn({ ...MEMBER, role: 'admin' }));
    await TestBed.inject(AuthService).load();
    const admin = await setup();
    await admin.fixture.whenStable();
    const adminAi = admin.el.querySelector('#settings-ai')!;
    expect(adminAi.querySelector('[data-testid="ai-provider-card"]')).not.toBeNull();
    expect(adminAi.textContent).toContain('choose a provider under AI provider below');
    expect(api.adminAiProvider).toHaveBeenCalledTimes(1);
  });

  it('turns AI on for the app right after an admin saves a provider', async () => {
    api.getProfile.mockResolvedValue(withAiProvider('unconfigured'));
    api.authStatus.mockResolvedValue(signedIn({ ...MEMBER, role: 'admin' }));
    await TestBed.inject(AuthService).load();
    const { fixture, el, input } = await setup();
    await fixture.whenStable();
    const availability = TestBed.inject(AiAvailability);
    expect(availability.enabled()).toBe(false);

    const kind = el.querySelector<HTMLSelectElement>('#ai-provider-kind')!;
    kind.value = 'anthropic';
    kind.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    input('ai-provider-key').value = 'sk-ant-test-0000';
    input('ai-provider-key').dispatchEvent(new Event('input'));
    api.getProfile.mockResolvedValue(withAiProvider('anthropic'));
    buttonByText(el.querySelector('[data-testid="ai-provider-card"]')!, 'Save').click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(api.adminSaveAiProvider).toHaveBeenCalledTimes(1);
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(availability.enabled()).toBe(true);
    expect(el.querySelector('#settings-ai')?.textContent).toContain('Connected to Claude');
  });

  it('shows the admin row after a promotion without reloading the app', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    await TestBed.inject(AuthService).load();
    const before = await setup();
    expect(before.el.querySelector('app-admin-entry a')).toBeNull();
    before.fixture.destroy();

    now.mockReturnValue(start + AUTH_REFRESH_INTERVAL_MS);
    api.authStatus.mockResolvedValue(signedIn({ ...MEMBER, role: 'admin' }));
    const after = await setup();
    await after.fixture.whenStable();
    const row = after.el.querySelector<HTMLAnchorElement>('app-admin-entry a');
    expect(row?.textContent).toContain('2 people are waiting for access');
    expect(TestBed.inject(AuthService).isAdmin()).toBe(true);
    now.mockRestore();
  });
});
