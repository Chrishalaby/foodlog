import { DOCUMENT, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { ProfileDto, ProfileResponse, UpdateProfileRequest } from '@food/shared';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DataEventsService } from './data-events.service';
import { setDayStartHour } from './day-start';
import { errorMessage } from './errors';
import { onSessionReset } from './session-scope';
import { THEME_STORAGE_KEY, ThemeService } from './theme.service';

export const PROFILE_LOAD_FAILED_MESSAGE = 'Could not load your profile.';

@Injectable({ providedIn: 'root' })
export class ProfileStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly events = inject(DataEventsService);
  private readonly theme = inject(ThemeService);
  private readonly document = inject(DOCUMENT);
  private readonly state = signal<ProfileResponse | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private inflight: Promise<ProfileResponse> | null = null;
  private revision = 0;
  private ownerId: string | null = null;
  private loadedAt = 0;
  private seenProfileVersion = this.profileVersion();
  private themeSynced = false;

  readonly response = this.state.asReadonly();
  readonly profile = computed<ProfileDto | null>(() => this.state()?.profile ?? null);
  readonly targets = computed(() => this.state()?.targets ?? null);
  readonly body = computed(() => this.state()?.body ?? null);
  readonly ai = computed(() => this.state()?.ai ?? null);
  readonly loaded = computed(() => this.state() !== null);
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly needsOnboarding = computed(() => this.state()?.profile.onboarded === false);

  constructor() {
    effect(() => {
      const version = this.events.profile();
      untracked(() => this.onProfileEvent(version));
    });
    onSessionReset(() => this.clear());
  }

  load(): Promise<ProfileResponse> {
    if (!this.inflight) {
      const request = this.fetch();
      this.inflight = request;
      request.then(
        () => this.settle(request),
        () => this.settle(request),
      );
    }
    return this.inflight;
  }

  async ensureLoaded(): Promise<ProfileResponse | null> {
    const cached = this.state();
    if (cached && this.ownerId === this.currentUserId()) {
      return cached;
    }
    if (cached) {
      this.clear();
    }
    try {
      return await this.load();
    } catch {
      return null;
    }
  }

  async fresh(): Promise<ProfileResponse> {
    this.onProfileEvent(this.profileVersion());
    let failed = false;
    let request = this.inflight;
    while (request) {
      try {
        await request;
        failed = false;
      } catch {
        failed = true;
      }
      request = this.inflight === request ? null : this.inflight;
    }
    const cached = this.state();
    if (!failed && cached && this.ownerId === this.currentUserId()) {
      return cached;
    }
    if (cached && this.ownerId !== this.currentUserId()) {
      this.clear();
    }
    return this.load();
  }

  isFresh(maxAgeMs: number): boolean {
    return this.state() !== null && Date.now() - this.loadedAt <= maxAgeMs;
  }

  async save(body: UpdateProfileRequest): Promise<ProfileResponse> {
    const ownerId = this.currentUserId();
    const response = await this.api.putProfile(body);
    if (ownerId === this.currentUserId()) {
      this.revision++;
      this.apply(response, ownerId);
    }
    const upToDate = this.seenProfileVersion === this.profileVersion();
    this.events.notify('profile');
    if (upToDate) {
      this.seenProfileVersion = this.profileVersion();
    }
    return response;
  }

  clear(): void {
    this.revision++;
    this.inflight = null;
    this.ownerId = null;
    this.loadedAt = 0;
    this.state.set(null);
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  private async fetch(): Promise<ProfileResponse> {
    const revision = this.revision;
    const ownerId = this.currentUserId();
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      const response = await this.api.getProfile();
      if (revision !== this.revision) {
        return this.state() ?? response;
      }
      this.apply(response, ownerId);
      this.syncThemeOnce(response.profile);
      return response;
    } catch (err) {
      if (revision === this.revision) {
        this.errorState.set(errorMessage(err, PROFILE_LOAD_FAILED_MESSAGE));
      }
      throw err;
    }
  }

  private settle(request: Promise<ProfileResponse>): void {
    if (this.inflight === request) {
      this.inflight = null;
      this.loadingState.set(false);
    }
  }

  private apply(response: ProfileResponse, ownerId: string | null): void {
    this.ownerId = ownerId;
    this.loadedAt = Date.now();
    this.errorState.set(null);
    setDayStartHour(response.profile.dayStartHour);
    this.state.set(response);
  }

  private onProfileEvent(version: number): void {
    if (version === this.seenProfileVersion) {
      return;
    }
    this.seenProfileVersion = version;
    if (!this.state() && !this.inflight) {
      return;
    }
    this.revision++;
    this.inflight = null;
    this.load().catch(() => undefined);
  }

  private profileVersion(): number {
    return untracked(() => this.events.profile());
  }

  private currentUserId(): string | null {
    return untracked(() => this.auth.user()?.id ?? null);
  }

  private syncThemeOnce(profile: ProfileDto): void {
    if (this.themeSynced) {
      return;
    }
    this.themeSynced = true;
    if (!this.hasDeviceTheme()) {
      this.theme.setPreference(profile.theme);
    }
  }

  private hasDeviceTheme(): boolean {
    try {
      return this.document.defaultView?.localStorage.getItem(THEME_STORAGE_KEY) != null;
    } catch {
      return false;
    }
  }
}
