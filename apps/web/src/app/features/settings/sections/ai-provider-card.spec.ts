import { TestBed } from '@angular/core/testing';
import type {
  AiProviderResponse,
  AiProviderSettingsDto,
  TestAiProviderResponse,
  UpdateAiProviderRequest,
} from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import {
  AiProviderCard,
  PROVIDER_REMOVED_MESSAGE,
  PROVIDER_SAVED_MESSAGE,
} from './ai-provider-card';

const CLAUDE: AiProviderSettingsDto = {
  provider: 'anthropic',
  baseUrl: null,
  apiStyle: 'chat',
  model: 'claude-sonnet-5-5',
  preciseModel: 'claude-opus-5-5',
  hasApiKey: true,
  apiKeyLast4: '1a2b',
  voiceEnabled: true,
  transcribeBaseUrl: null,
  transcribeModel: null,
  hasTranscribeApiKey: false,
  transcribeApiKeyLast4: null,
  updatedAt: '2026-10-22T10:00:00.000Z',
};

function response(overrides: Partial<AiProviderResponse> = {}): AiProviderResponse {
  return {
    source: 'none',
    editable: true,
    active: false,
    voice: false,
    keyUnreadable: false,
    settings: null,
    server: null,
    ...overrides,
  };
}

const SAVED = response({ source: 'app', active: true, settings: CLAUDE });

function createApi() {
  return {
    adminAiProvider: vi.fn(async (): Promise<AiProviderResponse> => response()),
    adminSaveAiProvider: vi.fn(
      async (_body: UpdateAiProviderRequest): Promise<AiProviderResponse> => SAVED,
    ),
    adminRemoveAiProvider: vi.fn(async (): Promise<AiProviderResponse> => response()),
    adminTestAiProvider: vi.fn(
      async (_body: UpdateAiProviderRequest): Promise<TestAiProviderResponse> => ({
        ok: true,
        model: 'claude-sonnet-5-5',
        latencyMs: 1234,
        message: 'Connected. claude-sonnet-5-5 answered.',
      }),
    ),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!found) {
    throw new Error(`No button "${text}"`);
  }
  return found;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('AiProviderCard', () => {
  let api: ReturnType<typeof createApi>;

  beforeEach(() => {
    api = createApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  async function render() {
    const fixture = TestBed.createComponent(AiProviderCard);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      await flush();
      await fixture.whenStable();
    };
    return {
      fixture,
      el,
      settle,
      input: (id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!,
      select: (id: string) => el.querySelector<HTMLSelectElement>(`#${id}`)!,
    };
  }

  it('sets up Claude from scratch and tells the app to refresh its AI status', async () => {
    const notify = vi.spyOn(TestBed.inject(DataEventsService), 'notify');
    const { el, settle, input, select } = await render();

    expect(api.adminAiProvider).toHaveBeenCalledTimes(1);
    expect(select('ai-provider-kind').value).toBe('openai');
    choose(select('ai-provider-kind'), 'anthropic');
    await settle();
    expect(input('ai-provider-model').value).toBe('claude-sonnet-5-5');
    expect(input('ai-provider-precise').value).toBe('claude-opus-5-5');
    expect(el.querySelector('#ai-provider-url')).toBeNull();
    expect(input('ai-provider-key').type).toBe('password');
    type(input('ai-provider-key'), 'sk-ant-new-key-0000');
    button(el, 'Save').click();
    await settle();

    expect(api.adminSaveAiProvider).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      preciseModel: 'claude-opus-5-5',
      apiKey: 'sk-ant-new-key-0000',
      voiceEnabled: true,
      transcribeBaseUrl: null,
      transcribeModel: null,
    });
    expect(notify).toHaveBeenCalledWith('profile');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .some((toast) => toast.message === PROVIDER_SAVED_MESSAGE),
    ).toBe(true);
    expect(el.querySelector('[data-testid="saved-key"]')?.textContent).toContain('•••• 1a2b');
    expect(el.querySelector('#ai-provider-key')).toBeNull();
  });

  it('shows a saved key masked and keeps it when saving other changes', async () => {
    api.adminAiProvider.mockResolvedValue(SAVED);
    const { el, settle, input } = await render();

    expect(el.querySelector('[data-testid="saved-key"]')?.textContent?.trim()).toBe('•••• 1a2b');
    expect(el.textContent).not.toContain('sk-ant');
    type(input('ai-provider-model'), 'claude-haiku-5-5');
    button(el, 'Save').click();
    await settle();

    const body = api.adminSaveAiProvider.mock.calls[0]?.[0];
    expect(body).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(body).not.toHaveProperty('apiKey');
  });

  it('replaces a saved key', async () => {
    api.adminAiProvider.mockResolvedValue(SAVED);
    const { el, settle, input } = await render();

    button(el, 'Replace').click();
    await settle();
    expect(input('ai-provider-key').value).toBe('');
    type(input('ai-provider-key'), 'sk-ant-replacement-9999');
    button(el, 'Save').click();
    await settle();

    expect(api.adminSaveAiProvider.mock.calls[0]?.[0].apiKey).toBe('sk-ant-replacement-9999');
  });

  it('removes the provider after confirming', async () => {
    api.adminAiProvider.mockResolvedValue(SAVED);
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const notify = vi.spyOn(TestBed.inject(DataEventsService), 'notify');
    const { el, settle, select } = await render();

    button(el, 'Remove').click();
    await settle();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(api.adminRemoveAiProvider).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('profile');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .some((toast) => toast.message === PROVIDER_REMOVED_MESSAGE),
    ).toBe(true);
    expect(select('ai-provider-kind').value).toBe('openai');
    expect(el.querySelector('[data-testid="saved-key"]')).toBeNull();
  });

  it('keeps the provider when removal is cancelled', async () => {
    api.adminAiProvider.mockResolvedValue(SAVED);
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);
    const { el, settle } = await render();

    button(el, 'Remove').click();
    await settle();

    expect(api.adminRemoveAiProvider).not.toHaveBeenCalled();
  });

  it('tests the connection with the form values and shows the outcome', async () => {
    api.adminAiProvider.mockResolvedValue(SAVED);
    const { el, settle } = await render();

    button(el, 'Test connection').click();
    await settle();

    expect(api.adminTestAiProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-5-5' }),
    );
    expect(api.adminSaveAiProvider).not.toHaveBeenCalled();
    const result = el.querySelector('[data-testid="ai-provider-test-result"]')!;
    expect(result.textContent).toContain('Connected. claude-sonnet-5-5 answered. (1.2 s)');

    api.adminTestAiProvider.mockResolvedValue({
      ok: false,
      model: 'claude-sonnet-5-5',
      latencyMs: null,
      message: 'The API key was rejected. 401 invalid x-api-key',
    });
    button(el, 'Test connection').click();
    await settle();
    expect(el.querySelector('[data-testid="ai-provider-test-result"]')?.textContent).toContain(
      'The API key was rejected.',
    );
  });

  it('points out missing fields instead of calling the server', async () => {
    const { el, settle, select, input } = await render();

    choose(select('ai-provider-kind'), 'custom');
    await settle();
    button(el, 'Save').click();
    await settle();
    button(el, 'Test connection').click();
    await settle();

    expect(api.adminSaveAiProvider).not.toHaveBeenCalled();
    expect(api.adminTestAiProvider).not.toHaveBeenCalled();
    expect(input('ai-provider-url').getAttribute('aria-invalid')).toBe('true');
    expect(el.querySelector('#ai-provider-url-error')?.textContent).toContain(
      'Enter the server address.',
    );
    expect(el.querySelector('#ai-provider-model-error')?.textContent).toContain(
      'Enter a model name.',
    );
  });

  it('shows server settings read-only', async () => {
    api.adminAiProvider.mockResolvedValue(
      response({
        source: 'env',
        editable: false,
        active: true,
        server: {
          provider: 'openai',
          baseUrl: null,
          apiStyle: 'responses',
          model: 'gpt-5.6-sol',
          preciseModel: 'gpt-6-astra',
        },
      }),
    );
    const { el } = await render();

    expect(el.textContent).toContain('Set on the server');
    expect(el.textContent).toContain('gpt-5.6-sol');
    expect(el.querySelector('#ai-provider-kind')).toBeNull();
    expect(Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual([]);
  });

  it('asks for a key again when the saved one cannot be read', async () => {
    api.adminAiProvider.mockResolvedValue(
      response({
        source: 'app',
        keyUnreadable: true,
        settings: { ...CLAUDE, hasApiKey: false, apiKeyLast4: null },
      }),
    );
    const { el } = await render();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Enter it again');
    expect(el.querySelector('#ai-provider-key')).not.toBeNull();
  });
});
