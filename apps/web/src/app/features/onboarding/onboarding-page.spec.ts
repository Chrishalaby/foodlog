import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  type ProfileDto,
  type ProfileResponse,
  type UpsertWeightRequest,
  computeBodyMetrics,
  computeTargets,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { KeyboardService } from '../../core/keyboard.service';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { DEFAULT_PROFILE } from '../settings/profile-model';
import { REQUIRED_MESSAGES } from './onboarding-model';
import {
  OnboardingPage,
  SKIPPED_MESSAGE,
  UPDATED_MESSAGE,
  WELCOME_MESSAGE,
} from './onboarding-page';

@Component({ template: 'page' })
class Page {}

const NEW_PROFILE: ProfileDto = {
  ...DEFAULT_PROFILE,
  onboarded: false,
  location: 'Beirut, Lebanon',
  theme: 'dark',
};

const ONBOARDED: ProfileDto = {
  ...NEW_PROFILE,
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  onboarded: true,
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

function createApi(profile: ProfileDto) {
  let stored = profile;
  return {
    getProfile: vi.fn(async () => response(stored)),
    putProfile: vi.fn(async (body: ProfileDto) => {
      stored = body;
      return response(body);
    }),
    putWeight: vi.fn(async (date: string, body: UpsertWeightRequest) => {
      stored = {
        ...stored,
        weightKg: body.weightKg,
        bodyFatPct: typeof body.bodyFatPct === 'number' ? body.bodyFatPct : stored.bodyFatPct,
      };
      return { date, weightKg: body.weightKg, bodyFatPct: body.bodyFatPct ?? null };
    }),
  };
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

describe('OnboardingPage', () => {
  let api: ReturnType<typeof createApi>;
  let fixture: ComponentFixture<OnboardingPage>;
  let el: HTMLElement;
  const keyboardOpen = signal(false);

  beforeEach(() => keyboardOpen.set(false));

  function configure(profile: ProfileDto): void {
    api = createApi(profile);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'today', component: Page },
          { path: 'settings', component: Page },
          { path: 'onboarding', component: OnboardingPage },
        ]),
        { provide: ApiService, useValue: api },
        { provide: KeyboardService, useValue: { open: keyboardOpen.asReadonly() } },
      ],
    });
  }

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(OnboardingPage);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    await fixture.whenStable();
  }

  function button(text: string): HTMLButtonElement {
    const match = Array.from(el.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    if (!match) {
      throw new Error(`No button "${text}"`);
    }
    return match;
  }

  async function click(text: string): Promise<void> {
    button(text).click();
    await settle();
  }

  function input(id: string): HTMLInputElement {
    return el.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function radio(value: string): HTMLInputElement {
    return el.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!;
  }

  function title(): string {
    return el.querySelector('#onboarding-title')?.textContent?.trim() ?? '';
  }

  async function fillAboutYou(): Promise<void> {
    radio('female').click();
    typeInto(input('ob-age'), '34');
    typeInto(input('ob-height'), '168');
    typeInto(input('ob-weight'), '64,5');
    typeInto(input('ob-body-fat'), '26');
    await settle();
  }

  afterEach(() => localStorage.clear());

  it('welcomes new users and blocks the next step until the basics are filled in', async () => {
    configure(NEW_PROFILE);
    await open();
    expect(title()).toBe('Welcome to FoodLog');
    expect(el.textContent).toContain('about a minute');

    await click('Get started');
    expect(title()).toBe('About you');
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');

    await click('Continue');
    expect(title()).toBe('About you');
    expect(el.textContent).toContain(REQUIRED_MESSAGES.age);
    expect(el.textContent).toContain(REQUIRED_MESSAGES.weightKg);
    expect(document.activeElement).toBe(radio('male'));

    await fillAboutYou();
    typeInto(input('ob-body-fat'), '90');
    await click('Continue');
    expect(el.textContent).toContain('Body fat must be between 3 and 70 %.');

    typeInto(input('ob-body-fat'), '');
    await click('Continue');
    expect(title()).toBe('How active are you?');
  });

  it('steps the age with the plus and minus buttons', async () => {
    configure(NEW_PROFILE);
    await open();
    await click('Get started');
    el.querySelector<HTMLButtonElement>('button[aria-label="Increase age"]')!.click();
    await settle();
    expect(input('ob-age').value).toBe('30');
    el.querySelector<HTMLButtonElement>('button[aria-label="Increase age"]')!.click();
    await settle();
    expect(input('ob-age').value).toBe('31');
    typeInto(input('ob-age'), '100');
    await settle();
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="Increase age"]')!.disabled).toBe(
      true,
    );
  });

  it('shows live numbers and saves everything when finishing', async () => {
    configure(NEW_PROFILE);
    await open();
    const events = TestBed.inject(DataEventsService);
    const toast = TestBed.inject(ToastService);
    await click('Get started');
    await fillAboutYou();
    await click('Continue');

    radio('very').click();
    await settle();
    expect(el.textContent).toContain('estimated daily calorie burn');
    await click('Continue');

    expect(title()).toBe('What is your goal?');
    radio('cut').click();
    await settle();
    await click('Continue');

    expect(title()).toBe('Your numbers');
    const expected = computeTargets({
      ...NEW_PROFILE,
      weightKg: 64.5,
      heightCm: 168,
      age: 34,
      sex: 'female',
      bodyFatPct: 26,
      activityLevel: 'very',
      goal: 'cut',
    });
    expect(el.textContent).toContain('Katch-McArdle');
    expect(el.textContent).toContain(expected.base.calories.toLocaleString('en-US'));
    expect(el.textContent).toContain('Healthy range');
    expect(el.textContent).toContain('FFMI');

    await click('I know my real burn');
    expect(document.activeElement).toBe(input('ob-tdee'));
    typeInto(input('ob-tdee'), '2400');
    typeInto(input('ob-target-protein'), '140');
    await settle();
    expect(el.textContent).toContain('Your value');
    expect(el.textContent).toContain('Custom');

    await click('Start logging');
    expect(api.putWeight).toHaveBeenCalledWith(todayLocalDate(), {
      weightKg: 64.5,
      bodyFatPct: 26,
    });
    expect(api.putProfile).toHaveBeenCalledWith({
      ...NEW_PROFILE,
      weightKg: 64.5,
      heightCm: 168,
      age: 34,
      sex: 'female',
      bodyFatPct: 26,
      tdeeOverride: 2400,
      activityLevel: 'very',
      goal: 'cut',
      trainingDaysPerWeek: 0,
      targetOverrides: { protein: 140 },
      onboarded: true,
    });
    expect(events.weights()).toBe(1);
    expect(events.profile()).toBe(2);
    expect(TestBed.inject(Router).url).toBe('/today');
    expect(toast.toasts().map((t) => t.message)).toContain(WELCOME_MESSAGE);
  });

  it('logs the weigh-in under the day the user is still awake in after midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 0, 56));
    try {
      configure(NEW_PROFILE);
      await open();
      await click('Get started');
      await fillAboutYou();
      await click('Continue');
      await click('Continue');
      await click('Continue');
      await click('Start logging');
      expect(api.putWeight).toHaveBeenCalledWith('2026-10-01', {
        weightKg: 64.5,
        bodyFatPct: 26,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('goes back to earlier steps and keeps the answers', async () => {
    configure(NEW_PROFILE);
    await open();
    await click('Get started');
    await fillAboutYou();
    await click('Continue');
    await click('Back');
    expect(title()).toBe('About you');
    expect(input('ob-weight').value).toBe('64.5');
    await click('Back');
    expect(title()).toBe('Welcome to FoodLog');
  });

  it('can be skipped at any step without saving the answers', async () => {
    configure(NEW_PROFILE);
    await open();
    const toast = TestBed.inject(ToastService);
    await click('Get started');
    await fillAboutYou();
    await click('Skip');
    expect(api.putProfile).toHaveBeenCalledWith({ ...NEW_PROFILE, onboarded: true });
    expect(api.putWeight).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/today');
    expect(toast.toasts().map((t) => t.message)).toContain(SKIPPED_MESSAGE);
  });

  it('stays on the last step when saving fails', async () => {
    configure(ONBOARDED);
    api.putProfile.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await open();
    const toast = TestBed.inject(ToastService);
    await click('Continue');
    await click('Continue');
    await click('Continue');
    await click('Save changes');
    expect(title()).toBe('Your numbers');
    expect(toast.toasts().some((t) => t.kind === 'error')).toBe(true);
    expect(button('Save changes').disabled).toBe(false);
  });

  it('lets onboarded users redo the wizard with their current values', async () => {
    configure(ONBOARDED);
    await open();
    const toast = TestBed.inject(ToastService);
    expect(title()).toBe('About you');
    expect(el.textContent).not.toContain('Back');
    expect(input('ob-weight').value).toBe('80');
    expect(radio('male').checked).toBe(true);
    await click('Continue');
    await click('Continue');
    await click('Continue');
    await click('Save changes');
    expect(api.putWeight).not.toHaveBeenCalled();
    expect(api.putProfile).toHaveBeenCalledWith({ ...ONBOARDED, onboarded: true });
    expect(TestBed.inject(Router).url).toBe('/settings');
    expect(toast.toasts().map((t) => t.message)).toContain(UPDATED_MESSAGE);
  });

  it('closes a redo without saving', async () => {
    configure(ONBOARDED);
    await open();
    await click('Close');
    expect(api.putProfile).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/settings');
  });

  it('returns to the previous screen when a redo was opened from settings', async () => {
    configure(ONBOARDED);
    const harness = await RouterTestingHarness.create('/settings');
    await harness.navigateByUrl('/onboarding');
    const back = vi.spyOn(TestBed.inject(Location), 'back').mockImplementation(() => undefined);
    const host = harness.routeNativeElement!;
    await harness.fixture.whenStable();
    const close = Array.from(host.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Close',
    )!;
    close.click();
    await harness.fixture.whenStable();
    expect(back).toHaveBeenCalledTimes(1);
    expect(api.putProfile).not.toHaveBeenCalled();
  });

  it('keeps the logged weight when setup is skipped after a failed save', async () => {
    configure(NEW_PROFILE);
    api.putProfile.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await open();
    await click('Get started');
    await fillAboutYou();
    await click('Continue');
    await click('Continue');
    await click('Continue');
    await click('Start logging');
    expect(api.putWeight).toHaveBeenCalledTimes(1);
    expect(title()).toBe('Your numbers');
    await click('Skip');
    expect(api.putProfile).toHaveBeenLastCalledWith({
      ...NEW_PROFILE,
      weightKg: 64.5,
      bodyFatPct: 26,
      onboarded: true,
    });
    expect(TestBed.inject(Router).url).toBe('/today');
  });

  it('saves on top of profile changes made elsewhere while the wizard was open', async () => {
    configure(NEW_PROFILE);
    await open();
    await click('Get started');
    await fillAboutYou();
    await click('Continue');
    await click('Continue');
    await click('Continue');
    const changed: ProfileDto = { ...NEW_PROFILE, aiModel: 'gpt-6-luna', theme: 'light' };
    api.getProfile.mockResolvedValue(response(changed));
    TestBed.inject(DataEventsService).notify('profile');
    await click('Start logging');
    expect(api.putProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        aiModel: 'gpt-6-luna',
        theme: 'light',
        weightKg: 64.5,
        onboarded: true,
      }),
    );
  });

  it('returns focus to the burn button after going back to the formula', async () => {
    configure(ONBOARDED);
    await open();
    await click('Continue');
    await click('Continue');
    await click('Continue');
    await click('I know my real burn');
    typeInto(input('ob-tdee'), '2500');
    await click('Use formula');
    expect(input('ob-tdee')).toBeNull();
    expect(document.activeElement?.textContent?.trim()).toBe('I know my real burn');
  });

  it('offers a retry when the profile cannot be loaded', async () => {
    configure(NEW_PROFILE);
    api.getProfile.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await open();
    expect(el.textContent).toContain('We could not load your profile');
    await click('Try again');
    expect(title()).toBe('Welcome to FoodLog');
  });

  it('jumps back to add body fat from the numbers step', async () => {
    configure({ ...ONBOARDED, bodyFatPct: null });
    await open();
    await click('Continue');
    await click('Continue');
    await click('Continue');
    await click('Add body fat %');
    expect(title()).toBe('About you');
    expect(document.activeElement).toBe(input('ob-body-fat'));
  });

  it('lets the footer scroll with the page while the keyboard is open', async () => {
    configure(NEW_PROFILE);
    await open();
    await click('Get started');
    const footer = (): HTMLElement =>
      el.querySelector<HTMLElement>('[data-testid="onboarding-footer"]')!;
    expect(footer().classList).toContain('sticky');
    expect(footer().classList).toContain('bottom-0');

    input('ob-body-fat').focus();
    keyboardOpen.set(true);
    await settle();
    expect(footer()).not.toBeNull();
    expect(footer().classList).not.toContain('sticky');
    expect(footer().classList).not.toContain('bottom-0');
    expect(footer().textContent).toContain('Continue');
    expect(footer().textContent).toContain('Back');

    keyboardOpen.set(false);
    await settle();
    expect(footer().classList).toContain('sticky');
    expect(footer().classList).toContain('bottom-0');
  });
});
