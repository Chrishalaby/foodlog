import { zeroNutrients } from '@food/shared';
import { MEAL_IDEAS_INSTRUCTIONS } from '../../meal-ideas/meal-ideas-prompt.js';
import { DEVELOPER_INSTRUCTIONS } from '../prompt.js';
import type {
  AiAnalyzeRequest,
  AiMealIdeasRequest,
  AiMenuRequest,
} from './ai-provider.js';
import { AiProviderError } from './ai-provider-error.js';
import { AnthropicProvider } from './anthropic.provider.js';
import {
  type AnthropicProviderOptions,
  buildAnthropicRequest,
  claudeEffort,
  claudeOutputSchema,
  normalizeAnthropicUsage,
} from './anthropic-structured.js';
import { MockProvider } from './mock.provider.js';
import { foodAnalysisCall, type OpenAiFetch } from './openai.provider.js';

type JsonObject = Record<string, any>;

const API_KEY = 'sk-ant-test-0000000000001a2b';

const REQUEST: AiAnalyzeRequest = {
  model: 'claude-sonnet-5-5',
  images: [{ dataUrl: 'data:image/jpeg;base64,/9j/4AAQ', detail: 'high' }],
  prompt: {
    mode: 'food_photo',
    imageRoles: ['food'],
    description: '150 g chicken',
    localTime: '2026-09-28T13:00',
    mealType: null,
    location: null,
    answeredQuestions: [],
    followUp: null,
  },
};

const MENU_REQUEST: AiMenuRequest = {
  model: 'claude-sonnet-5-5',
  images: [{ dataUrl: 'data:image/png;base64,iVBORw0K', detail: 'high' }],
  prompt: { description: null, imageCount: 1, location: null },
};

const IDEAS_REQUEST: AiMealIdeasRequest = {
  model: 'claude-sonnet-5-5',
  prompt: {
    count: 2,
    localTime: '2026-10-11T19:30',
    goal: 'maintain',
    trainingDay: false,
    location: null,
    targets: {
      calories: 2200,
      protein: 150,
      carbs: 250,
      fat: 70,
      satFatMax: 24,
      fiberMin: 30,
      sugarMax: 90,
      sodiumMax: 2300,
    },
    eaten: zeroNutrients(),
    logged: [],
    foods: [],
    exclude: [],
    note: null,
  },
};

const USAGE = {
  input_tokens: 1800,
  cache_read_input_tokens: 600,
  cache_creation_input_tokens: 400,
  output_tokens: 900,
  output_tokens_details: { thinking_tokens: 300 },
  service_tier: 'standard',
};

const mock = new MockProvider({ latencyMs: 0 });

function messageBody(text: string, overrides: JsonObject = {}): JsonObject {
  return {
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text, citations: null },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: USAGE,
    ...overrides,
  };
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'request-id': 'req_claude_1',
      ...headers,
    },
  });
}

function errorBody(type: string, message: string): JsonObject {
  return { type: 'error', error: { type, message }, request_id: 'req_err' };
}

interface Captured {
  url: string;
  headers: Headers;
  body: JsonObject;
}

function providerWith(
  respond: (body: JsonObject) => Response | Promise<Response>,
  options: Partial<AnthropicProviderOptions> = {},
): { provider: AnthropicProvider; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetch: OpenAiFetch = async (input, init) => {
    const raw = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(raw) as JsonObject;
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body,
    });
    return respond(body);
  };
  const provider = new AnthropicProvider({
    apiKey: API_KEY,
    timeoutMs: 5_000,
    reasoningEffort: 'low',
    fetch,
    ...options,
  });
  return { provider, calls };
}

async function failure(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiProviderError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('AnthropicProvider', () => {
  it('sends the Messages API request with the key, images first and a JSON schema', async () => {
    const sample = (await mock.analyze(REQUEST)).raw;
    const { provider, calls } = providerWith(() =>
      json(messageBody(JSON.stringify(sample))),
    );

    await provider.analyze(REQUEST);

    const [call] = calls as [Captured];
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers.get('x-api-key')).toBe(API_KEY);
    expect(call.headers.get('authorization')).toBeNull();
    expect(call.headers.get('anthropic-version')).toBeTruthy();
    expect(call.body.model).toBe('claude-sonnet-5-5');
    expect(call.body.max_tokens).toBe(16_000);
    expect(call.body.system).toBe(DEVELOPER_INSTRUCTIONS);
    expect(call.body).not.toHaveProperty('tools');
    expect(call.body).not.toHaveProperty('tool_choice');
    expect(call.body).not.toHaveProperty('temperature');
    expect(call.body).not.toHaveProperty('thinking');
    const [message] = call.body.messages as [JsonObject];
    expect(message.role).toBe('user');
    expect(message.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' },
    });
    expect(message.content[1].type).toBe('text');
    expect(message.content[1].text).toContain('"150 g chicken"');
    expect(call.body.output_config.effort).toBe('low');
    expect(call.body.output_config.format.type).toBe('json_schema');
    expect(call.body.output_config.format.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(call.body.output_config.format.schema).not.toHaveProperty('$schema');
  });

  it('returns the parsed answer with normalized usage, model and request id', async () => {
    const sample = (await mock.analyze(REQUEST)).raw;
    const { provider } = providerWith(() =>
      json(messageBody(JSON.stringify(sample))),
    );

    const result = await provider.analyze(REQUEST);

    expect(result.raw).toEqual(sample);
    expect(result.usage).toEqual({
      inputTokens: 2800,
      cachedInputTokens: 600,
      cacheWriteTokens: 400,
      outputTokens: 900,
      reasoningTokens: 300,
    });
    expect(result.model).toBe('claude-sonnet-5-5');
    expect(result.requestId).toBe('req_claude_1');
    expect(result.serviceTier).toBeNull();
  });

  it('accepts a JSON answer wrapped in a code fence', async () => {
    const sample = (await mock.analyze(REQUEST)).raw;
    const { provider } = providerWith(() =>
      json(messageBody('```json\n' + JSON.stringify(sample) + '\n```')),
    );

    await expect(provider.analyze(REQUEST)).resolves.toMatchObject({
      raw: sample,
    });
  });

  it('splits a described day, reads menus and suggests meals', async () => {
    const split = (await mock.analyzeMeals(REQUEST)).raw;
    const menu = (await mock.extractMenu(MENU_REQUEST)).raw;
    const ideas = (await mock.suggestMeals(IDEAS_REQUEST)).raw;
    const answers = [split, menu, ideas];
    const { provider, calls } = providerWith(() =>
      json(messageBody(JSON.stringify(answers.shift()))),
    );

    await expect(provider.analyzeMeals(REQUEST)).resolves.toMatchObject({
      raw: split,
    });
    await expect(provider.extractMenu(MENU_REQUEST)).resolves.toMatchObject({
      raw: menu,
    });
    await expect(provider.suggestMeals(IDEAS_REQUEST)).resolves.toMatchObject({
      raw: ideas,
    });

    const [splitCall, menuCall, ideasCall] = calls as [
      Captured,
      Captured,
      Captured,
    ];
    expect(splitCall.body.messages[0].content).toHaveLength(1);
    expect(menuCall.body.messages[0].content[0].source.media_type).toBe(
      'image/png',
    );
    expect(ideasCall.body.system).toBe(MEAL_IDEAS_INSTRUCTIONS);
  });

  it('reports a refusal without retrying', async () => {
    const { provider } = providerWith(() =>
      json(
        messageBody('', {
          content: [],
          stop_reason: 'refusal',
          stop_details: {
            type: 'refusal',
            category: null,
            explanation: 'Declined',
          },
        }),
      ),
    );

    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({ kind: 'refusal', retryable: false });
    expect(error.message).toBe('Declined');
    expect(error.details.usage?.inputTokens).toBe(2800);
  });

  it('reports a truncated answer as incomplete', async () => {
    const { provider } = providerWith(() =>
      json(messageBody('{"meal_name":', { stop_reason: 'max_tokens' })),
    );

    await expect(failure(provider.analyze(REQUEST))).resolves.toMatchObject({
      kind: 'incomplete',
      retryable: false,
    });
  });

  it('marks an empty or malformed answer as retryable invalid output', async () => {
    const empty = providerWith(() => json(messageBody('   ')));
    await expect(
      failure(empty.provider.analyze(REQUEST)),
    ).resolves.toMatchObject({ kind: 'invalid_output', retryable: true });

    const wrong = providerWith(() => json(messageBody('{"meal_name": 3}')));
    await expect(
      failure(wrong.provider.analyze(REQUEST)),
    ).resolves.toMatchObject({ kind: 'invalid_output', retryable: true });
  });

  it('maps API errors to failure kinds with readable messages', async () => {
    const auth = providerWith(() =>
      json(errorBody('authentication_error', 'invalid x-api-key'), 401),
    );
    const authError = await failure(auth.provider.analyze(REQUEST));
    expect(authError).toMatchObject({ kind: 'auth', retryable: false });
    expect(authError.message).toBe('401 invalid x-api-key');
    expect(authError.message).not.toContain(API_KEY);

    const limited = providerWith(() =>
      json(errorBody('rate_limit_error', 'slow down'), 429, {
        'retry-after': '2',
      }),
    );
    await expect(
      failure(limited.provider.analyze(REQUEST)),
    ).resolves.toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      details: { status: 429, retryAfterMs: 2000 },
    });

    const overloaded = providerWith(() =>
      json(errorBody('overloaded_error', 'Overloaded'), 529),
    );
    await expect(
      failure(overloaded.provider.analyze(REQUEST)),
    ).resolves.toMatchObject({ kind: 'server_error', retryable: true });

    const missingModel = providerWith(() =>
      json(errorBody('not_found_error', 'model: claude-nope'), 404),
    );
    await expect(
      failure(missingModel.provider.analyze(REQUEST)),
    ).resolves.toMatchObject({ kind: 'bad_request', retryable: false });
  });

  it('reports an unreachable server as a retryable connection failure', async () => {
    const { provider } = providerWith(() => {
      throw new TypeError('fetch failed');
    });

    await expect(failure(provider.analyze(REQUEST))).resolves.toMatchObject({
      kind: 'connection',
      retryable: true,
    });
  });

  it('rejects images Claude cannot read before calling the API', async () => {
    const { provider, calls } = providerWith(() => json(messageBody('{}')));

    await expect(
      failure(
        provider.analyze({
          ...REQUEST,
          images: [{ dataUrl: 'data:image/heic;base64,AAAA', detail: 'low' }],
        }),
      ),
    ).resolves.toMatchObject({ kind: 'bad_request' });
    expect(calls).toHaveLength(0);
  });
});

describe('buildAnthropicRequest', () => {
  it('maps the reasoning setting to effort only for known Claude models', () => {
    expect(claudeEffort('claude-opus-5-5', 'none')).toBe('low');
    expect(claudeEffort('claude-opus-5-5', 'high')).toBe('high');
    expect(claudeEffort('claude-sonnet-4-5', 'low')).toBeNull();
    const body = buildAnthropicRequest(
      foodAnalysisCall({ ...REQUEST, model: 'claude-sonnet-4-5' }),
      { reasoningEffort: 'low', maxOutputTokens: 2048 },
    );
    expect(body.max_tokens).toBe(2048);
    expect(body.output_config).not.toHaveProperty('effort');
  });

  it('drops schema keywords Claude does not support and keeps enums', () => {
    expect(
      claudeOutputSchema({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          minimum: { type: 'number', minimum: 0, maximum: 10 },
          mode: { type: 'string', enum: ['a', 'b'], maxLength: 3 },
          list: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
            },
          },
        },
        required: ['minimum', 'mode', 'list'],
        additionalProperties: false,
      }),
    ).toEqual({
      type: 'object',
      properties: {
        minimum: { type: 'number' },
        mode: { type: 'string', enum: ['a', 'b'] },
        list: {
          type: 'array',
          items: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
      required: ['minimum', 'mode', 'list'],
      additionalProperties: false,
    });
  });

  it('counts cache reads and writes as input tokens', () => {
    expect(
      normalizeAnthropicUsage({
        input_tokens: 10,
        cache_read_input_tokens: null,
        cache_creation_input_tokens: null,
        output_tokens: 5,
        output_tokens_details: null,
      } as never),
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
    });
  });
});
