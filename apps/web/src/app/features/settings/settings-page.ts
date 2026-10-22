import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DOCUMENT,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  resource,
  signal,
  untracked,
} from '@angular/core';
import {
  type FieldTree,
  type TreeValidationResult,
  type ValidationError,
  form,
  submit,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import {
  type AiConfigDto,
  type ProfileDto,
  type ProfileResponse,
  TARGET_KEYS,
  type TargetsDto,
  type ThemePreference,
  type WeightSummaryResponse,
  addDays,
  computeBodyMetrics,
  computeTargets,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { KeyboardService } from '../../core/keyboard.service';
import { NetworkService } from '../../core/network.service';
import { ProfileStore } from '../../core/profile.store';
import { onSessionReset } from '../../core/session-scope';
import { ThemeService } from '../../core/theme.service';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { registerUnsavedWork } from '../../core/unsaved-work.service';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { InstallPromptService } from './install-prompt.service';
import {
  DEFAULT_PROFILE,
  PROFILE_FIELD_LABELS,
  type ProfileFormModel,
  autoTargetValues,
  changedProfileFields,
  previewInput,
  rebaseProfile,
  sameProfile,
  toFormModel,
  toProfileDto,
} from './profile-model';
import {
  INLINE_ERROR_PATHS,
  type ProfileErrorPath,
  apiMessages,
  mapProfileServerErrors,
  profileSchema,
} from './profile-schema';
import { SettingsDraftStore } from './settings-draft.store';
import { AboutSection } from './sections/about-section';
import { AccountSection } from './sections/account-section';
import { AdminEntry } from './sections/admin-entry';
import { AiSection } from './sections/ai-section';
import { AppearanceSection } from './sections/appearance-section';
import { BodySection, type WeightsState } from './sections/body-section';
import { DataSection } from './sections/data-section';
import { DaySection } from './sections/day-section';
import { DevicesSection } from './sections/devices-section';
import { HiddenFoodsSection } from './sections/hidden-foods-section';
import { InstallSection } from './sections/install-section';
import { MyFoodsEntry } from './sections/my-foods-entry';
import { NotesEntry } from './sections/notes-entry';
import { ProfileSection } from './sections/profile-section';
import { TargetsSection } from './sections/targets-section';
import { UsageSection } from './sections/usage-section';
import { utcMonthOf } from './usage-math';

export type LoadState = 'loading' | 'ready' | 'error';

export const SAVED_MESSAGE = 'Settings saved.';
export const INVALID_MESSAGE = 'Check the highlighted fields.';
export const SAVE_FAILED_MESSAGE = 'Could not save your settings.';
export const LOAD_FAILED_MESSAGE = 'Could not load your settings.';
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Sign in again to save.';
export const UNSAVED_KEPT_MESSAGE = 'Your settings changes are not saved yet.';
export const SETTINGS_PATH = '/settings';
export const PROFILE_FRESH_MS = 30_000;
export const WEIGHT_WINDOW_DAYS = 30;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

interface JumpLink {
  id: string;
  label: string;
}

const PROFILE_LINKS: readonly JumpLink[] = [
  { id: 'settings-profile', label: 'Profile' },
  { id: 'settings-body', label: 'Body' },
  { id: 'settings-targets', label: 'Targets' },
  { id: 'settings-day', label: 'Day' },
  { id: 'settings-ai', label: 'AI' },
];

const OTHER_LINKS: readonly JumpLink[] = [
  { id: 'settings-usage', label: 'Usage' },
  { id: 'settings-appearance', label: 'Appearance' },
  { id: 'settings-hidden-foods', label: 'Hidden' },
  { id: 'settings-data', label: 'Data' },
  { id: 'settings-install', label: 'Install' },
  { id: 'settings-account', label: 'Account' },
  { id: 'settings-devices', label: 'Devices' },
  { id: 'settings-about', label: 'About' },
];

@Component({
  selector: 'app-settings-page',
  imports: [
    PageHeader,
    Icon,
    Skeleton,
    Spinner,
    ProfileSection,
    BodySection,
    TargetsSection,
    DaySection,
    AiSection,
    UsageSection,
    AppearanceSection,
    HiddenFoodsSection,
    DataSection,
    InstallSection,
    AccountSection,
    DevicesSection,
    AdminEntry,
    AboutSection,
    MyFoodsEntry,
    NotesEntry,
  ],
  templateUrl: './settings-page.html',
  host: {
    class: 'block',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class SettingsPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly document = inject(DOCUMENT);
  private readonly install = inject(InstallPromptService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly drafts = inject(SettingsDraftStore);
  private readonly store = inject(ProfileStore);
  private readonly events = inject(DataEventsService);
  private readonly keyboardOpen = inject(KeyboardService).open;
  private serverProfile: ProfileDto | null = null;
  private lastResponse: ProfileResponse | null = null;

  protected readonly online = inject(NetworkService).online;
  protected readonly loadState = signal<LoadState>('loading');
  protected readonly loadError = signal<string | null>(null);
  protected readonly baseline = signal<ProfileDto | null>(null);
  protected readonly serverTargets = signal<TargetsDto | null>(null);
  protected readonly aiConfig = signal<AiConfigDto | null>(null);
  protected readonly model = signal<ProfileFormModel>(toFormModel(DEFAULT_PROFILE));
  protected readonly profileForm = form(this.model, profileSchema, {
    submission: {
      action: async () => this.save(),
      onInvalid: () => this.focusFirstError(INVALID_MESSAGE),
    },
  });

  protected readonly current = computed(() => toProfileDto(this.model()));
  protected readonly changedFields = computed(() => {
    const baseline = this.baseline();
    return baseline ? changedProfileFields(baseline, this.current()) : [];
  });
  protected readonly dirty = computed(() => this.changedFields().length > 0);
  protected readonly saving = computed(() => this.profileForm().submitting());
  protected readonly changeSummary = computed(() =>
    this.changedFields()
      .map((key) => PROFILE_FIELD_LABELS[key])
      .join(', '),
  );

  protected readonly previewInput = computed(() => previewInput(this.model()));
  protected readonly preview = computed(() => computeTargets(this.previewInput()));
  protected readonly autoTargets = computed(() => autoTargetValues(this.previewInput()));
  protected readonly bodyMetrics = computed(() => computeBodyMetrics(this.previewInput()));
  protected readonly weights = resource({
    params: () => ({ weights: this.events.weights(), entries: this.events.entries() }),
    loader: () => {
      const to = todayLocalDate();
      return this.api.weights(addDays(to, -(WEIGHT_WINDOW_DAYS - 1)), to);
    },
  });
  protected readonly weightSummary = linkedSignal<
    WeightSummaryResponse | null,
    WeightSummaryResponse | null
  >({
    source: () => (this.weights.hasValue() ? (this.weights.value() ?? null) : null),
    computation: (latest, previous) => latest ?? previous?.value ?? null,
  });
  protected readonly weightsState = computed<WeightsState>(() => {
    if (this.weightSummary()) {
      return 'ready';
    }
    return this.weights.status() === 'error' ? 'error' : 'loading';
  });
  protected readonly adaptiveTdee = computed(() => this.weightSummary()?.adaptiveTdee ?? null);
  protected readonly targetWarnings = computed(() => {
    const server = this.serverTargets();
    return this.dirty() || !server ? this.preview().warnings : server.warnings;
  });
  protected readonly modelLabels = computed<ReadonlyMap<string, string>>(
    () => new Map((this.aiConfig()?.availableModels ?? []).map((m) => [m.id, m.label])),
  );
  protected readonly themeValue = computed<ThemePreference>(() =>
    this.loadState() === 'ready' ? this.model().theme : this.theme.preference(),
  );
  protected readonly jumpLinks = computed(() => {
    const others = OTHER_LINKS.filter(
      (link) => link.id !== 'settings-install' || !this.install.standalone(),
    );
    return this.loadState() === 'ready' ? [...PROFILE_LINKS, ...others] : others;
  });
  protected readonly currentUsage = resource({
    params: () => ({ month: utcMonthOf(new Date()) }),
    loader: ({ params }) => this.api.usage(params.month),
  });
  protected readonly monthToDateUsd = computed(() =>
    this.currentUsage.hasValue() ? (this.currentUsage.value()?.monthToDateUsd ?? null) : null,
  );
  protected readonly saveBarBottom = computed(() => {
    if (this.keyboardOpen()) {
      return this.online() ? '0.75rem' : '3.25rem';
    }
    return this.online()
      ? 'calc(env(safe-area-inset-bottom) + 5.75rem)'
      : 'calc(env(safe-area-inset-bottom) + 8.25rem)';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.keepUnsavedDraft());
    registerUnsavedWork(() => this.dirty());
    onSessionReset(() => queueMicrotask(() => this.reloadForNewSession()));
    const cached = this.store.response();
    if (cached) {
      this.receive(cached);
    }
    effect(() => {
      const response = this.store.response();
      if (response) {
        untracked(() => this.receive(response));
      }
    });
    if (!this.store.isFresh(PROFILE_FRESH_MS)) {
      void this.load();
    }
  }

  protected async load(): Promise<void> {
    if (!this.store.response()) {
      this.loadState.set('loading');
    }
    this.loadError.set(null);
    try {
      this.receive(await this.store.load());
    } catch (err) {
      if (this.loadState() !== 'ready') {
        this.loadError.set(errorMessage(err, LOAD_FAILED_MESSAGE));
        this.loadState.set('error');
      }
    }
  }

  protected retryWeights(): void {
    this.weights.reload();
  }

  protected saveChanges(): void {
    void submit(this.profileForm);
  }

  protected discard(): void {
    const baseline = this.baseline();
    if (!baseline) {
      return;
    }
    this.resetDraft(baseline);
    this.theme.setPreference(baseline.theme);
  }

  protected onThemeChange(preference: ThemePreference): void {
    this.theme.setPreference(preference);
    if (this.loadState() === 'ready') {
      this.model.update((model) => ({ ...model, theme: preference }));
    }
  }

  protected scrollToSection(id: string): void {
    const target = this.document.getElementById(id);
    if (!target) {
      return;
    }
    target.scrollIntoView({
      behavior: this.prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
    target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) {
      event.preventDefault();
    }
  }

  private receive(response: ProfileResponse): void {
    if (response === this.lastResponse) {
      return;
    }
    this.lastResponse = response;
    if (this.loadState() !== 'ready' || !this.serverProfile) {
      this.applyLoaded(response);
      this.loadState.set('ready');
      return;
    }
    this.serverTargets.set(response.targets);
    this.aiConfig.set(response.ai);
    if (sameProfile(this.serverProfile, response.profile)) {
      this.serverProfile = response.profile;
      return;
    }
    this.rebase(response.profile);
  }

  private rebase(profile: ProfileDto): void {
    const previousBaseline = this.baseline();
    const baseline: ProfileDto = { ...profile, theme: this.theme.preference() };
    const draft = this.current();
    const wasDirty = this.dirty();
    this.serverProfile = profile;
    this.baseline.set(baseline);
    if (!wasDirty || !previousBaseline) {
      this.resetDraft(baseline);
      return;
    }
    this.model.set(toFormModel(rebaseProfile(previousBaseline, draft, baseline)));
  }

  private applyLoaded(response: ProfileResponse): void {
    const deviceTheme = this.theme.preference();
    const kept = this.drafts.restore(this.userId(), response.profile);
    const baseline: ProfileDto = kept?.baseline ?? { ...response.profile, theme: deviceTheme };
    this.serverProfile = response.profile;
    this.baseline.set(baseline);
    this.serverTargets.set(response.targets);
    this.aiConfig.set(response.ai);
    this.resetDraft(baseline);
    if (kept) {
      this.model.set({ ...kept.model, theme: deviceTheme });
    }
  }

  private reloadForNewSession(): void {
    if (!this.auth.isAuthenticated()) {
      return;
    }
    this.serverProfile = null;
    this.lastResponse = null;
    this.baseline.set(null);
    this.loadState.set('loading');
    this.weights.reload();
    this.currentUsage.reload();
    void this.load();
  }

  private keepUnsavedDraft(): void {
    if (this.auth.status() === 'anonymous') {
      this.drafts.clear();
      return;
    }
    const baseline = this.baseline();
    const serverProfile = this.serverProfile;
    if (this.loadState() !== 'ready' || !baseline || !serverProfile) {
      return;
    }
    if (!this.dirty()) {
      this.drafts.clear();
      return;
    }
    this.drafts.keep({ userId: this.userId(), serverProfile, baseline, model: this.model() });
    if (!this.saving()) {
      const router = this.router;
      this.toast.info(UNSAVED_KEPT_MESSAGE, {
        action: { label: 'Review', run: () => void router.navigateByUrl(SETTINGS_PATH) },
      });
    }
  }

  private userId(): string | null {
    return this.auth.user()?.id ?? null;
  }

  private prefersReducedMotion(): boolean {
    const view = this.document.defaultView;
    return typeof view?.matchMedia === 'function' && view.matchMedia(REDUCED_MOTION_QUERY).matches;
  }

  private resetDraft(profile: ProfileDto): void {
    this.model.set(toFormModel(profile));
    this.profileForm().reset();
  }

  private async save(): Promise<TreeValidationResult> {
    try {
      this.receive(await this.store.fresh());
      const body = this.current();
      const response = await this.store.save(body);
      this.lastResponse = response;
      const untouched = sameProfile(this.current(), body);
      this.serverProfile = response.profile;
      this.baseline.set(response.profile);
      this.serverTargets.set(response.targets);
      this.aiConfig.set(response.ai);
      if (untouched) {
        this.resetDraft(response.profile);
      }
      this.toast.success(SAVED_MESSAGE);
      return undefined;
    } catch (err) {
      return this.saveErrors(err);
    }
  }

  private saveErrors(err: unknown): TreeValidationResult {
    if (httpStatus(err) === 401) {
      this.toast.error(SESSION_EXPIRED_MESSAGE);
      return undefined;
    }
    if (httpStatus(err) !== 400 || !(err instanceof HttpErrorResponse)) {
      this.toast.error(errorMessage(err, SAVE_FAILED_MESSAGE));
      return undefined;
    }
    const mapped = mapProfileServerErrors(apiMessages(err.error));
    const fieldErrors: ValidationError.WithFieldTree[] = [];
    const general: string[] = [];
    for (const error of mapped) {
      if (error.path && INLINE_ERROR_PATHS.has(error.path)) {
        fieldErrors.push({
          fieldTree: this.fieldAt(error.path),
          kind: 'server',
          message: error.message,
        });
      } else {
        general.push(error.message);
      }
    }
    if (general.length > 0 || fieldErrors.length === 0) {
      this.toast.error(general.length > 0 ? general.join(' ') : SAVE_FAILED_MESSAGE);
    } else {
      this.toast.error(INVALID_MESSAGE);
    }
    queueMicrotask(() => fieldErrors[0]?.fieldTree().focusBoundControl());
    return fieldErrors;
  }

  private fieldAt(path: ProfileErrorPath): FieldTree<unknown> {
    const root = this.profileForm;
    if (path.startsWith('overrides.')) {
      const key = TARGET_KEYS.find((candidate) => path === `overrides.${candidate}`);
      return key ? root.overrides[key] : root.overrides;
    }
    return root[path as Exclude<ProfileErrorPath, `overrides.${string}`>];
  }

  private focusFirstError(message: string): void {
    this.profileForm().errorSummary()[0]?.fieldTree().focusBoundControl();
    this.toast.error(message);
  }
}
