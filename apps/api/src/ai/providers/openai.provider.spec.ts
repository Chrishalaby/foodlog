import type { FoodAnalysisOutput } from '../food-analysis.schema.js';
import { DEVELOPER_INSTRUCTIONS } from '../prompt.js';
import type { AiAnalyzeRequest } from './ai-provider.js';
import { AiProviderError } from './ai-provider-error.js';
import {
  buildOpenAiRequest,
  type OpenAiFetch,
  OpenAiProvider,
  type OpenAiProviderOptions,
} from './openai.provider.js';

type JsonObject = Record<string, any>;

const SAMPLE: FoodAnalysisOutput = {
  input_type: 'food_photo',
  meal_name: 'Grilled chicken',
  portion: null,
  scale_cues: 'Dinner plate ~27 cm',
  items: [
    {
      name: 'Chicken breast, grilled',
      saved_food: null,
      amount_source: 'visual_estimate',
      count: null,
      unit: null,
      unit_plural: null,
      portion_basis: 'Palm-sized fillet',
      state: 'cooked',
      estimated_quantity_g: 150,
      fluid_ml: null,
      per_100g: {
        calories: 165,
        protein_g: 31,
        carbs_g: 0,
        fat_g: 3.6,
        saturated_fat_g: 1,
        fiber_g: 0,
        sugar_g: 0,
        sodium_mg: 74,
        alcohol_g: 0,
      },
      micros_per_100g: {
        vitamin_a_ug_rae: 9,
        vitamin_c_mg: 0,
        vitamin_d_ug: 0.1,
        vitamin_e_mg: 0.3,
        vitamin_k_ug: 0.3,
        vitamin_b6_mg: 0.6,
        vitamin_b12_ug: 0.34,
        folate_ug_dfe: 4,
        calcium_mg: 15,
        iron_mg: 1,
        magnesium_mg: 29,
        potassium_mg: 256,
        zinc_mg: 1,
        cholesterol_mg: 85,
        caffeine_mg: null,
      },
      confidence: 'medium',
    },
  ],
  label: null,
  assumptions: ['No oil'],
  follow_up_question: null,
  follow_up_options: [],
};

const USAGE = {
  input_tokens: 2800,
  input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 200 },
  output_tokens: 1500,
  output_tokens_details: { reasoning_tokens: 600 },
  total_tokens: 4300,
};

const REQUEST: AiAnalyzeRequest = {
  model: 'gpt-5.6-sol',
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

function responseBody(
  content: unknown[],
  overrides: JsonObject = {},
): JsonObject {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1_790_000_000,
    status: 'completed',
    model: 'gpt-5.6-sol-2026-07-09',
    error: null,
    incomplete_details: null,
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content,
      },
    ],
    usage: USAGE,
    service_tier: 'default',
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
      'x-request-id': 'req_123',
      ...headers,
    },
  });
}

function textContent(text: string): unknown[] {
  return [{ type: 'output_text', text, annotations: [] }];
}

function providerWith(
  respond: (
    body: JsonObject,
    init: RequestInit | undefined,
  ) => Response | Promise<Response>,
  options: Partial<OpenAiProviderOptions> = {},
): { provider: OpenAiProvider; bodies: JsonObject[] } {
  const bodies: JsonObject[] = [];
  const fetch: OpenAiFetch = async (_input, init) => {
    const raw = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(raw) as JsonObject;
    bodies.push(body);
    return respond(body, init);
  };
  const provider = new OpenAiProvider({
    apiKey: 'sk-test',
    timeoutMs: 5_000,
    reasoningEffort: 'low',
    serviceTier: 'default',
    fetch,
    ...options,
  });
  return { provider, bodies };
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

describe('OpenAiProvider', () => {
  it('returns the parsed model JSON with usage, model and request id', async () => {
    const { provider, bodies } = providerWith(() =>
      json(responseBody(textContent(JSON.stringify(SAMPLE)))),
    );

    const result = await provider.analyze(REQUEST);

    expect(result.raw).toEqual(SAMPLE);
    expect(result.usage).toEqual({
      inputTokens: 2800,
      cachedInputTokens: 1000,
      cacheWriteTokens: 200,
      outputTokens: 1500,
      reasoningTokens: 600,
    });
    expect(result.model).toBe('gpt-5.6-sol-2026-07-09');
    expect(result.requestId).toBe('req_123');
    expect(result.serviceTier).toBe('default');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(bodies).toHaveLength(1);
  });

  it('sends the image with explicit detail, a strict json_schema and no temperature', async () => {
    const { provider, bodies } = providerWith(() =>
      json(responseBody(textContent(JSON.stringify(SAMPLE)))),
    );
    await provider.analyze(REQUEST);
    const [body] = bodies as [JsonObject];

    expect(body.model).toBe('gpt-5.6-sol');
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(16_000);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('service_tier');
    expect(body.text.verbosity).toBe('low');
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'food_analysis',
      strict: true,
    });
    expect(body.text.format.schema.required).toEqual([
      'input_type',
      'meal_name',
      'portion',
      'scale_cues',
      'items',
      'label',
      'assumptions',
      'follow_up_question',
      'follow_up_options',
    ]);

    const [developer, user] = body.input as [JsonObject, JsonObject];
    expect(developer.role).toBe('developer');
    expect(developer.content[0].text).toBe(DEVELOPER_INSTRUCTIONS);
    expect(user.role).toBe('user');
    expect(user.content[0].type).toBe('input_text');
    expect(user.content[0].text).toContain('"150 g chicken"');
    expect(user.content[1]).toEqual({
      type: 'input_image',
      image_url: 'data:image/jpeg;base64,/9j/4AAQ',
      detail: 'high',
    });
  });

  it('sends every image in order with its own detail after the listing text', () => {
    const body = buildOpenAiRequest(
      {
        ...REQUEST,
        images: [
          { dataUrl: 'data:image/jpeg;base64,food', detail: 'low' },
          { dataUrl: 'data:image/jpeg;base64,label', detail: 'high' },
        ],
        prompt: { ...REQUEST.prompt, imageRoles: ['food', 'label'] },
      },
      { reasoningEffort: 'low', serviceTier: 'default' },
    ) as JsonObject;
    const content = body.input[1].content as JsonObject[];
    expect(content.map((part) => part.type)).toEqual([
      'input_text',
      'input_image',
      'input_image',
    ]);
    expect(content[0]?.text).toContain(
      'Image 1: food photo; Image 2: nutrition label/packaging',
    );
    expect(content.slice(1)).toEqual([
      {
        type: 'input_image',
        image_url: 'data:image/jpeg;base64,food',
        detail: 'low',
      },
      {
        type: 'input_image',
        image_url: 'data:image/jpeg;base64,label',
        detail: 'high',
      },
    ]);
  });

  it('omits the image part for text analysis', () => {
    const body = buildOpenAiRequest(
      {
        ...REQUEST,
        images: [],
        prompt: { ...REQUEST.prompt, mode: 'text', imageRoles: [] },
      },
      { reasoningEffort: 'low', serviceTier: 'default' },
    ) as JsonObject;
    expect(body.input[1].content).toHaveLength(1);
    expect(body.input[1].content[0].type).toBe('input_text');
  });

  it.each([
    ['gpt-5.6-sol', true],
    ['gpt-5.6-luna', true],
    ['gpt-6-sol', true],
    ['gpt-6-astra', true],
    ['gpt-5.5', false],
    ['gpt-5.4-mini', false],
    ['gpt-4.1', false],
    ['some-future-model', false],
  ])('uses explicit prompt caching for %s: %s', (model, explicit) => {
    const body = buildOpenAiRequest(
      { ...REQUEST, model },
      { reasoningEffort: 'low', serviceTier: 'default' },
    ) as JsonObject;
    const developerText = body.input[0].content[0];
    if (explicit) {
      expect(body.prompt_cache_options).toEqual({ mode: 'explicit' });
      expect(developerText.prompt_cache_breakpoint).toEqual({
        mode: 'explicit',
      });
    } else {
      expect(body).not.toHaveProperty('prompt_cache_options');
      expect(developerText).not.toHaveProperty('prompt_cache_breakpoint');
    }
    expect(body.input[1].content[0]).not.toHaveProperty(
      'prompt_cache_breakpoint',
    );
  });

  it('raises the effort to the model minimum and omits reasoning for non-reasoning models', () => {
    const settings = {
      reasoningEffort: 'none',
      serviceTier: 'fast',
    } as const;
    const astra = buildOpenAiRequest(
      { ...REQUEST, model: 'gpt-6-astra' },
      settings,
    ) as JsonObject;
    const sol = buildOpenAiRequest(
      { ...REQUEST, model: 'gpt-6-sol' },
      settings,
    ) as JsonObject;
    const legacy = buildOpenAiRequest(
      { ...REQUEST, model: 'gpt-4.1' },
      settings,
    ) as JsonObject;

    expect(astra.reasoning).toEqual({ effort: 'low' });
    expect(sol.reasoning).toEqual({ effort: 'none' });
    expect(legacy).not.toHaveProperty('reasoning');
    expect(legacy.text).not.toHaveProperty('verbosity');
    expect(sol.service_tier).toBe('fast');
    expect(
      (
        buildOpenAiRequest(REQUEST, {
          reasoningEffort: 'minimal',
          serviceTier: 'default',
        }) as JsonObject
      ).reasoning,
    ).toEqual({ effort: 'low' });
  });

  it('classifies a refusal and keeps the usage', async () => {
    const { provider } = providerWith(() =>
      json(responseBody([{ type: 'refusal', refusal: 'I cannot help.' }])),
    );
    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({ kind: 'refusal', retryable: false });
    expect(error.details.usage?.outputTokens).toBe(1500);
    expect(error.details.requestId).toBe('req_123');
  });

  it('classifies an incomplete response as not retryable', async () => {
    const { provider } = providerWith(() =>
      json(
        responseBody([], {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ type: 'reasoning', id: 'rs_1', summary: [] }],
        }),
      ),
    );
    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({ kind: 'incomplete', retryable: false });
    expect(error.message).toContain('max_output_tokens');
    expect(error.details.usage?.inputTokens).toBe(2800);
  });

  it('treats a content-filtered response as a refusal', async () => {
    const { provider } = providerWith(() =>
      json(
        responseBody([], {
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
        }),
      ),
    );
    await expect(provider.analyze(REQUEST)).rejects.toMatchObject({
      kind: 'refusal',
    });
  });

  it('classifies invalid JSON as retryable invalid_output with usage', async () => {
    const { provider } = providerWith(() =>
      json(responseBody(textContent('{"input_type": "food_photo"'))),
    );
    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({ kind: 'invalid_output', retryable: true });
    expect(error.details.usage?.outputTokens).toBe(1500);
  });

  it('classifies schema violations as invalid_output', async () => {
    const { provider } = providerWith(() =>
      json(
        responseBody(
          textContent(JSON.stringify({ ...SAMPLE, input_type: 'bogus' })),
        ),
      ),
    );
    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({ kind: 'invalid_output', retryable: true });
    expect(error.message).toContain('input_type');
  });

  it('classifies a 500 as a retryable server error after exactly one call', async () => {
    const { provider, bodies } = providerWith(() =>
      json(
        { error: { message: 'boom', type: 'server_error', code: null } },
        500,
      ),
    );
    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({
      kind: 'server_error',
      retryable: true,
      details: { status: 500, requestId: 'req_123', model: 'gpt-5.6-sol' },
    });
    expect(bodies).toHaveLength(1);
  });

  it('does not retry a 429 caused by an exhausted quota', async () => {
    const { provider, bodies } = providerWith(() =>
      json(
        {
          error: {
            message: 'You exceeded your current quota',
            type: 'insufficient_quota',
            code: 'insufficient_quota',
          },
        },
        429,
        { 'retry-after': '1' },
      ),
    );
    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({ kind: 'quota_exceeded', retryable: false });
    expect(bodies).toHaveLength(1);
  });

  it('marks a plain 429 as retryable and reads retry-after-ms', async () => {
    const { provider } = providerWith(() =>
      json(
        {
          error: {
            message: 'slow down',
            type: 'rate_limit_error',
            code: 'slow_down',
          },
        },
        429,
        { 'retry-after-ms': '250' },
      ),
    );
    const error = await failure(provider.analyze(REQUEST));
    expect(error).toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      details: { retryAfterMs: 250 },
    });
  });

  it('classifies authentication and bad request errors as not retryable', async () => {
    const auth = providerWith(() =>
      json(
        { error: { message: 'bad key', type: 'invalid_request_error' } },
        401,
      ),
    );
    const bad = providerWith(() =>
      json(
        { error: { message: 'bad param', type: 'invalid_request_error' } },
        400,
      ),
    );
    await expect(auth.provider.analyze(REQUEST)).rejects.toMatchObject({
      kind: 'auth',
      retryable: false,
    });
    await expect(bad.provider.analyze(REQUEST)).rejects.toMatchObject({
      kind: 'bad_request',
      retryable: false,
    });
  });

  it('retries network failures but never timeouts, which are billed anyway', async () => {
    const offline = providerWith(() => {
      throw new TypeError('fetch failed');
    });
    const hanging = providerWith(
      (_body, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
      { timeoutMs: 50 },
    );
    await expect(offline.provider.analyze(REQUEST)).rejects.toMatchObject({
      kind: 'connection',
      retryable: true,
    });
    await expect(hanging.provider.analyze(REQUEST)).rejects.toMatchObject({
      kind: 'timeout',
      retryable: false,
    });
  });
});
