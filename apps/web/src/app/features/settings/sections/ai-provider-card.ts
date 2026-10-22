import { Component, computed, inject, signal } from '@angular/core';
import {
  AI_API_STYLES,
  AI_PROVIDER_KINDS,
  AI_PROVIDER_LIMITS,
  AI_PROVIDER_PRESETS,
  type AiApiStyle,
  type AiProviderKind,
  type AiProviderResponse,
  type TestAiProviderResponse,
} from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { errorMessage } from '../../../core/errors';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import { Icon } from '../../../shared/ui/icon';
import { Spinner } from '../../../shared/ui/spinner';
import { ToggleRow } from '../../../shared/ui/toggle-row';
import {
  API_STYLE_LABELS,
  type DraftProblems,
  type ProviderDraft,
  TRANSCRIPTION_HINTS,
  draftFromSettings,
  draftProblems,
  hasSavedKey,
  hasSavedTranscribeKey,
  maskedKey,
  showsKeyInput,
  switchProvider,
  toUpdateRequest,
} from './ai-provider-model';

export const PROVIDER_SAVED_MESSAGE = 'AI provider saved.';
export const PROVIDER_REMOVED_MESSAGE = 'AI provider removed. AI estimates are off.';
export const PROVIDER_LOAD_FAILED_MESSAGE = 'Could not load the AI provider settings.';
export const PROVIDER_SAVE_FAILED_MESSAGE = 'Could not save the AI provider.';
export const PROVIDER_TEST_FAILED_MESSAGE = 'Could not run the connection test.';
export const PROVIDER_CHECK_FIELDS_MESSAGE = 'Check the highlighted fields.';

type LoadState = 'loading' | 'ready' | 'error';

type TextField =
  | 'baseUrl'
  | 'model'
  | 'preciseModel'
  | 'apiKey'
  | 'transcribeBaseUrl'
  | 'transcribeModel'
  | 'transcribeApiKey';

@Component({
  selector: 'app-ai-provider-card',
  imports: [Icon, Spinner, ToggleRow],
  host: { class: 'block' },
  templateUrl: './ai-provider-card.html',
})
export class AiProviderCard {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly events = inject(DataEventsService);

  protected readonly presets = AI_PROVIDER_KINDS.map((kind) => AI_PROVIDER_PRESETS[kind]);
  protected readonly apiStyles = AI_API_STYLES;
  protected readonly styleLabels = API_STYLE_LABELS;
  protected readonly limits = AI_PROVIDER_LIMITS;
  protected readonly state = signal<LoadState>('loading');
  protected readonly loadError = signal<string | null>(null);
  protected readonly response = signal<AiProviderResponse | null>(null);
  protected readonly draft = signal<ProviderDraft>(draftFromSettings(null));
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly testing = signal(false);
  protected readonly removing = signal(false);
  protected readonly testResult = signal<TestAiProviderResponse | null>(null);

  protected readonly settings = computed(() => this.response()?.settings ?? null);
  protected readonly editable = computed(() => this.response()?.editable === true);
  protected readonly preset = computed(() => AI_PROVIDER_PRESETS[this.draft().provider]);
  protected readonly savedKey = computed(() => hasSavedKey(this.draft(), this.settings()));
  protected readonly keyInput = computed(() => showsKeyInput(this.draft(), this.settings()));
  protected readonly savedTranscribeKey = computed(() =>
    hasSavedTranscribeKey(this.draft(), this.settings()),
  );
  protected readonly transcribeKeyInput = computed(
    () => !this.savedTranscribeKey() || this.draft().replaceTranscribeKey,
  );
  protected readonly maskedKey = computed(() => maskedKey(this.settings()?.apiKeyLast4 ?? null));
  protected readonly maskedTranscribeKey = computed(() =>
    maskedKey(this.settings()?.transcribeApiKeyLast4 ?? null),
  );
  protected readonly transcriptionHint = computed(
    () => TRANSCRIPTION_HINTS[this.preset().transcription],
  );
  protected readonly problems = computed<DraftProblems>(() =>
    this.submitted() ? draftProblems(this.draft(), this.settings()) : {},
  );
  protected readonly busy = computed(() => this.saving() || this.testing() || this.removing());
  protected readonly serverTitle = computed(() => {
    const server = this.response()?.server;
    if (!server) {
      return '';
    }
    if (server.provider === 'mock') {
      return 'Simulated AI';
    }
    return server.baseUrl ? `OpenAI-compatible server at ${hostOf(server.baseUrl)}` : 'OpenAI';
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    this.loadError.set(null);
    try {
      this.apply(await this.api.adminAiProvider());
      this.state.set('ready');
    } catch (err) {
      this.loadError.set(errorMessage(err, PROVIDER_LOAD_FAILED_MESSAGE));
      this.state.set('error');
    }
  }

  protected onProvider(event: Event): void {
    const provider = (event.target as HTMLSelectElement).value as AiProviderKind;
    this.draft.update((draft) => switchProvider(draft, provider, this.settings()));
    this.submitted.set(false);
    this.testResult.set(null);
  }

  protected onApiStyle(event: Event): void {
    this.patch({ apiStyle: (event.target as HTMLSelectElement).value as AiApiStyle });
  }

  protected onText(field: TextField, event: Event): void {
    this.patch({ [field]: (event.target as HTMLInputElement).value });
  }

  protected setVoice(enabled: boolean): void {
    this.patch({ voiceEnabled: enabled });
  }

  protected replaceKey(replace: boolean): void {
    this.patch({ replaceKey: replace, apiKey: '' });
  }

  protected replaceTranscribeKey(replace: boolean): void {
    this.patch({ replaceTranscribeKey: replace, transcribeApiKey: '' });
  }

  protected removeTranscribeKey(remove: boolean): void {
    this.patch({ removeTranscribeKey: remove, replaceTranscribeKey: false, transcribeApiKey: '' });
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.ready()) {
      return;
    }
    this.saving.set(true);
    try {
      const request = toUpdateRequest(this.draft(), this.settings());
      this.apply(await this.api.adminSaveAiProvider(request));
      this.events.notify('profile');
      this.toast.success(PROVIDER_SAVED_MESSAGE);
    } catch (err) {
      this.toast.error(errorMessage(err, PROVIDER_SAVE_FAILED_MESSAGE));
    } finally {
      this.saving.set(false);
    }
  }

  protected async test(): Promise<void> {
    if (this.busy() || !this.ready()) {
      return;
    }
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const request = toUpdateRequest(this.draft(), this.settings());
      this.testResult.set(await this.api.adminTestAiProvider(request));
    } catch (err) {
      this.testResult.set({
        ok: false,
        model: null,
        latencyMs: null,
        message: errorMessage(err, PROVIDER_TEST_FAILED_MESSAGE),
      });
    } finally {
      this.testing.set(false);
    }
  }

  protected async remove(): Promise<void> {
    if (this.busy()) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: 'Remove the AI provider?',
      message:
        'The saved key is deleted and AI estimates turn off for everyone until you add a provider again.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.removing.set(true);
    try {
      this.apply(await this.api.adminRemoveAiProvider());
      this.events.notify('profile');
      this.toast.success(PROVIDER_REMOVED_MESSAGE);
    } catch (err) {
      this.toast.error(errorMessage(err, PROVIDER_SAVE_FAILED_MESSAGE));
    } finally {
      this.removing.set(false);
    }
  }

  protected latency(result: TestAiProviderResponse): string {
    return result.latencyMs === null ? '' : ` (${(result.latencyMs / 1000).toFixed(1)} s)`;
  }

  private ready(): boolean {
    this.submitted.set(true);
    if (Object.keys(draftProblems(this.draft(), this.settings())).length === 0) {
      return true;
    }
    this.toast.error(PROVIDER_CHECK_FIELDS_MESSAGE);
    return false;
  }

  private patch(changes: Partial<ProviderDraft>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
    this.testResult.set(null);
  }

  private apply(response: AiProviderResponse): void {
    this.response.set(response);
    this.draft.set(draftFromSettings(response.settings));
    this.submitted.set(false);
  }
}

function hostOf(url: string): string {
  return URL.parse(url)?.host ?? url;
}
