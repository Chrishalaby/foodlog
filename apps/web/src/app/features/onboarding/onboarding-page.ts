import { Location } from '@angular/common';
import {
  Component,
  DOCUMENT,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { form } from '@angular/forms/signals';
import { Router } from '@angular/router';
import type { ProfileDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage } from '../../core/errors';
import { HOME_PATH } from '../../core/guards';
import { KeyboardService } from '../../core/keyboard.service';
import { ProfileStore } from '../../core/profile.store';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';
import { Logo } from '../../shared/ui/logo';
import { Spinner } from '../../shared/ui/spinner';
import { DEFAULT_PROFILE, toFormModel } from '../settings/profile-model';
import {
  type OnboardingStep,
  PROGRESS_STEPS,
  STEP_COPY,
  firstInvalidStep,
  invalidStepFields,
  nextStep,
  onboardingProfile,
  onboardingSchema,
  previousStep,
  skippedProfile,
  stepFieldTrees,
  weighInFor,
  withWeighIn,
} from './onboarding-model';
import { AboutStep } from './steps/about-step';
import { ActivityStep } from './steps/activity-step';
import { GoalStep } from './steps/goal-step';
import { NumbersStep } from './steps/numbers-step';
import { WelcomeStep } from './steps/welcome-step';

export const SETTINGS_PATH = '/settings';
export const WELCOME_MESSAGE = 'You’re all set! Snap your next meal with the camera button.';
export const UPDATED_MESSAGE = 'Your profile and targets are updated.';
export const SKIPPED_MESSAGE = 'No problem. You can finish your profile anytime in Settings.';
export const FINISH_FAILED_MESSAGE = 'Could not save your profile. Please try again.';
export const SKIP_FAILED_MESSAGE = 'Could not skip setup. Please try again.';

type Direction = 'forward' | 'back';
type Busy = 'finish' | 'skip' | null;

@Component({
  selector: 'app-onboarding-page',
  imports: [Icon, Logo, Spinner, WelcomeStep, AboutStep, ActivityStep, GoalStep, NumbersStep],
  templateUrl: './onboarding-page.html',
  styleUrl: './onboarding-page.css',
  host: { class: 'block' },
})
export class OnboardingPage {
  private readonly store = inject(ProfileStore);
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly location = inject(Location);
  private baseline: ProfileDto | null = null;

  protected readonly model = signal(toFormModel(DEFAULT_PROFILE));
  protected readonly wizard = form(this.model, onboardingSchema);
  protected readonly step = signal<OnboardingStep>('welcome');
  protected readonly direction = signal<Direction>('forward');
  protected readonly busy = signal<Busy>(null);
  protected readonly ready = signal(false);
  protected readonly redo = signal(false);
  protected readonly keyboardOpen = inject(KeyboardService).open;

  protected readonly progressSteps = PROGRESS_STEPS;
  protected readonly loadError = computed(() => (this.ready() ? null : this.store.error()));
  protected readonly copy = computed(() => STEP_COPY[this.step()]);
  protected readonly stepKeys = computed(() => [this.step()]);
  protected readonly progress = computed(() => PROGRESS_STEPS.indexOf(this.step()) + 1);
  protected readonly isLast = computed(() => nextStep(this.step()) === null);
  protected readonly firstStep = computed<OnboardingStep>(() =>
    this.redo() ? 'about' : 'welcome',
  );
  protected readonly canGoBack = computed(() => this.step() !== this.firstStep());
  protected readonly primaryLabel = computed(() => {
    const step = this.step();
    if (step === 'welcome') {
      return 'Get started';
    }
    if (step === 'numbers') {
      return this.redo() ? 'Save changes' : 'Start logging';
    }
    return 'Continue';
  });
  protected readonly skipLabel = computed(() => (this.redo() ? 'Close' : 'Skip'));
  protected readonly skipAriaLabel = computed(() => (this.redo() ? 'Close setup' : 'Skip setup'));

  constructor() {
    effect(() => {
      const profile = this.store.profile();
      if (profile && !untracked(this.ready)) {
        untracked(() => this.start(profile));
      }
    });
    void this.store.ensureLoaded();
  }

  protected retry(): void {
    this.store.load().catch(() => undefined);
  }

  protected continueWithoutSetup(): void {
    void this.router.navigateByUrl(HOME_PATH, { replaceUrl: true });
  }

  protected primary(): void {
    if (this.busy()) {
      return;
    }
    if (this.isLast()) {
      void this.finish();
      return;
    }
    const invalid = invalidStepFields(this.wizard, this.step());
    if (invalid.length > 0) {
      this.revealErrors(this.step());
      invalid[0]().focusBoundControl();
      return;
    }
    const next = nextStep(this.step());
    if (next) {
      this.goTo(next, 'forward');
    }
  }

  protected back(): void {
    const previous = previousStep(this.step());
    if (previous && this.canGoBack() && !this.busy()) {
      this.goTo(previous, 'back');
    }
  }

  protected editAbout(): void {
    this.goTo('about', 'back');
    afterNextRender(() => this.document.getElementById('ob-body-fat')?.focus(), {
      injector: this.injector,
    });
  }

  protected async skip(): Promise<void> {
    const known = this.baseline ?? this.store.profile();
    if (this.busy()) {
      return;
    }
    if (!known || known.onboarded === true) {
      await this.leave(known?.onboarded === true);
      return;
    }
    this.busy.set('skip');
    try {
      const current = (await this.store.fresh()).profile;
      if (current.onboarded === true) {
        await this.leave(false);
        return;
      }
      await this.store.save(skippedProfile(current));
      await this.leave(false);
      this.toast.info(SKIPPED_MESSAGE);
    } catch (err) {
      this.toast.error(errorMessage(err, SKIP_FAILED_MESSAGE));
    } finally {
      this.busy.set(null);
    }
  }

  private start(profile: ProfileDto): void {
    this.baseline = profile;
    this.redo.set(profile.onboarded === true);
    this.step.set(this.firstStep());
    this.model.set(toFormModel(profile));
    this.wizard().reset();
    this.ready.set(true);
  }

  private async finish(): Promise<void> {
    const invalidStep = firstInvalidStep(this.wizard);
    if (invalidStep) {
      this.revealErrors(invalidStep);
      if (invalidStep !== this.step()) {
        this.goTo(invalidStep, 'back');
      }
      afterNextRender(
        () => invalidStepFields(this.wizard, invalidStep)[0]?.().focusBoundControl(),
        { injector: this.injector },
      );
      return;
    }
    this.busy.set('finish');
    try {
      const current = await this.latestProfile();
      const next = onboardingProfile(current, this.model());
      await this.logWeight(current, next);
      await this.store.save(next);
      await this.leave(this.redo());
      this.toast.success(this.redo() ? UPDATED_MESSAGE : WELCOME_MESSAGE);
    } catch (err) {
      this.toast.error(errorMessage(err, FINISH_FAILED_MESSAGE));
    } finally {
      this.busy.set(null);
    }
  }

  private async latestProfile(): Promise<ProfileDto> {
    const latest = (await this.store.fresh()).profile;
    this.baseline = latest;
    return latest;
  }

  private async logWeight(current: ProfileDto, next: ProfileDto): Promise<void> {
    const weighIn = weighInFor(current, next);
    if (!weighIn) {
      return;
    }
    try {
      await this.api.putWeight(todayLocalDate(), weighIn);
    } catch {
      return;
    }
    this.baseline = withWeighIn(current, weighIn);
    this.events.notify('weights', 'profile');
  }

  private async leave(toSettings: boolean): Promise<void> {
    if (toSettings && this.router.lastSuccessfulNavigation()?.previousNavigation) {
      this.location.back();
      return;
    }
    await this.router.navigateByUrl(toSettings ? SETTINGS_PATH : HOME_PATH, { replaceUrl: true });
  }

  private revealErrors(step: OnboardingStep): void {
    for (const field of stepFieldTrees(this.wizard, step)) {
      field().markAsTouched();
    }
  }

  private goTo(step: OnboardingStep, direction: Direction): void {
    this.direction.set(direction);
    this.step.set(step);
    const scroller = this.document.scrollingElement;
    if (scroller) {
      scroller.scrollTop = 0;
    }
    afterNextRender(
      () => this.document.getElementById('onboarding-title')?.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  }
}
