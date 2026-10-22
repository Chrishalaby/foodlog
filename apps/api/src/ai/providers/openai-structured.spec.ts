import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { MENU_INSTRUCTIONS } from '../../compare/menu-prompt.js';
import type { MenuScanOutput } from '../../compare/menu-scan.schema.js';
import { MEAL_IDEAS_INSTRUCTIONS } from '../../meal-ideas/meal-ideas-prompt.js';
import type { MealIdeasOutput } from '../../meal-ideas/meal-ideas.schema.js';
import type { AiMealIdeasRequest, AiMenuRequest } from './ai-provider.js';
import { AiProviderError } from './ai-provider-error.js';
import {
  buildStructuredRequest,
  type OpenAiFetch,
  OpenAiStructuredClient,
  type StructuredCall,
  type StructuredOutput,
} from './openai-structured.js';
import {
  mealIdeasCall,
  menuScanCall,
  OpenAiProvider,
} from './openai.provider.js';

type JsonObject = Record<string, any>;

const GreetingSchema = z.object({ greeting: z.string() });
type Greeting = z.infer<typeof GreetingSchema>;

const GREETING_OUTPUT: StructuredOutput<Greeting> = {
  format: zodTextFormat(GreetingSchema, 'greeting'),
  parse: (text) => {
    const result = GreetingSchema.safeParse(JSON.parse(text));
    return result.success
      ? { ok: true, data: result.data }
      : { ok: false, error: 'bad greeting' };
  },
};

const CALL: StructuredCall<Greeting> = {
  model: 'gpt-5.6-sol',
  instructions: 'Say hello.',
  userText: 'Name: Chris',
  images: [{ dataUrl: 'data:image/jpeg;base64,/9j/menu', detail: 'high' }],
  output: GREETING_OUTPUT,
};

const MENU: MenuScanOutput = {
  restaurant: null,
  dishes: [
    {
      name: 'Falafel wrap',
      description: null,
      portion_basis: 'One wrap',
      portion: { count: 1, unit: 'wrap', unit_plural: 'wraps' },
      estimated_quantity_g: 320,
      per_serving: {
        calories: 638,
        protein_g: 20,
        carbs_g: 78,
        fat_g: 30,
        saturated_fat_g: 4.5,
        fiber_g: 12,
        sugar_g: 7,
        sodium_mg: 1350,
        alcohol_g: 0,
      },
      confidence: 'medium',
      notes: null,
    },
  ],
  warnings: [],
};

const MENU_REQUEST: AiMenuRequest = {
  model: 'gpt-6-sol',
  images: [
    { dataUrl: 'data:image/jpeg;base64,/9j/page1', detail: 'high' },
    { dataUrl: 'data:image/jpeg;base64,/9j/page2', detail: 'high' },
  ],
  prompt: {
    description: 'half portion',
    imageCount: 2,
    location: 'Beirut',
  },
};

const USAGE = {
  input_tokens: 3200,
  input_tokens_details: { cached_tokens: 1200, cache_write_tokens: 0 },
  output_tokens: 900,
  output_tokens_details: { reasoning_tokens: 300 },
  total_tokens: 4100,
};

function responseBody(text: string): JsonObject {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1_790_000_000,
    status: 'completed',
    model: 'gpt-6-sol-2026-08-01',
    error: null,
    incomplete_details: null,
    output: [
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    usage: USAGE,
    service_tier: 'default',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_9' },
  });
}

function capture(respond: () => Response): {
  fetch: OpenAiFetch;
  bodies: JsonObject[];
} {
  const bodies: JsonObject[] = [];
  const fetch: OpenAiFetch = (_input, init) => {
    bodies.push(
      JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as JsonObject,
    );
    return Promise.resolve(respond());
  };
  return { fetch, bodies };
}

const OPTIONS = {
  apiKey: 'sk-test',
  timeoutMs: 5_000,
  reasoningEffort: 'low',
  serviceTier: 'default',
} as const;

describe('buildStructuredRequest', () => {
  it('sends the instructions as a cacheable developer message and the images after the text', () => {
    const body = buildStructuredRequest(CALL, {
      reasoningEffort: 'low',
      serviceTier: 'default',
    }) as JsonObject;

    expect(body).toMatchObject({
      model: 'gpt-5.6-sol',
      store: false,
      max_output_tokens: 16_000,
      reasoning: { effort: 'low' },
      prompt_cache_options: { mode: 'explicit' },
      text: {
        verbosity: 'low',
        format: { type: 'json_schema', name: 'greeting', strict: true },
      },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body.input).toEqual([
      {
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: 'Say hello.',
            prompt_cache_breakpoint: { mode: 'explicit' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Name: Chris' },
          {
            type: 'input_image',
            image_url: 'data:image/jpeg;base64,/9j/menu',
            detail: 'high',
          },
        ],
      },
    ]);
  });

  it('skips explicit caching for models without it and honours the output limit', () => {
    const body = buildStructuredRequest(
      { ...CALL, model: 'gpt-4.1' },
      { reasoningEffort: 'low', serviceTier: 'flex', maxOutputTokens: 900 },
    ) as JsonObject;

    expect(body).not.toHaveProperty('prompt_cache_options');
    expect(body).not.toHaveProperty('reasoning');
    expect(body.text).not.toHaveProperty('verbosity');
    expect(body.service_tier).toBe('flex');
    expect(body.max_output_tokens).toBe(900);
    expect(body.input[0].content[0]).not.toHaveProperty(
      'prompt_cache_breakpoint',
    );
  });
});

describe('OpenAiStructuredClient', () => {
  it('parses the output with the call parser and reports usage and ids', async () => {
    const { fetch, bodies } = capture(() =>
      json(responseBody(JSON.stringify({ greeting: 'Hello Chris' }))),
    );
    const client = new OpenAiStructuredClient({ ...OPTIONS, fetch });

    const result = await client.call(CALL);

    expect(result).toMatchObject({
      raw: { greeting: 'Hello Chris' },
      model: 'gpt-6-sol-2026-08-01',
      requestId: 'req_9',
      serviceTier: 'default',
      usage: {
        inputTokens: 3200,
        cachedInputTokens: 1200,
        cacheWriteTokens: 0,
        outputTokens: 900,
        reasoningTokens: 300,
      },
    });
    expect(bodies).toHaveLength(1);
  });

  it('reports output the parser rejects as retryable invalid_output', async () => {
    const { fetch } = capture(() =>
      json(responseBody(JSON.stringify({ greeting: 42 }))),
    );
    const client = new OpenAiStructuredClient({ ...OPTIONS, fetch });

    await expect(client.call(CALL)).rejects.toMatchObject({
      kind: 'invalid_output',
      retryable: true,
      message: 'bad greeting',
    });
  });

  it('maps HTTP failures with the requested model and never retries itself', async () => {
    const { fetch, bodies } = capture(() =>
      json({ error: { message: 'boom', type: 'server_error' } }, 503),
    );
    const client = new OpenAiStructuredClient({ ...OPTIONS, fetch });

    const error: unknown = await client.call(CALL).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({
      kind: 'server_error',
      retryable: true,
      details: { status: 503, model: 'gpt-5.6-sol' },
    });
    expect(bodies).toHaveLength(1);
  });
});

describe('OpenAiProvider.extractMenu', () => {
  it('sends the menu instructions, prompt and every photo with a strict menu schema', async () => {
    const { fetch, bodies } = capture(() =>
      json(responseBody(JSON.stringify(MENU))),
    );
    const provider = new OpenAiProvider({ ...OPTIONS, fetch });

    const result = await provider.extractMenu(MENU_REQUEST);

    expect(result.raw).toEqual(MENU);
    expect(result.model).toBe('gpt-6-sol-2026-08-01');
    const [body] = bodies as [JsonObject];
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'menu_scan',
      strict: true,
    });
    expect(body.input[0].content[0].text).toBe(MENU_INSTRUCTIONS);
    const content = body.input[1].content as JsonObject[];
    expect(content.map((part) => part.type)).toEqual([
      'input_text',
      'input_image',
      'input_image',
    ]);
    expect(content[0]?.text).toContain('the 2 attached menu photos');
    expect(content[0]?.text).toContain('"half portion"');
    expect(content[0]?.text).toContain('Location: "Beirut"');
    expect(content.slice(1).map((part) => part.detail)).toEqual([
      'high',
      'high',
    ]);
  });

  it('builds the same call shape the food analysis uses', () => {
    const call = menuScanCall(MENU_REQUEST);
    expect(call.model).toBe('gpt-6-sol');
    expect(call.instructions).toBe(MENU_INSTRUCTIONS);
    expect(call.images).toBe(MENU_REQUEST.images);
    expect(call.output.parse(JSON.stringify(MENU))).toEqual({
      ok: true,
      data: MENU,
    });
  });
});

const IDEAS: MealIdeasOutput = {
  summary: 'Protein is the gap to close.',
  ideas: [
    {
      title: 'Chicken wrap',
      meal_type: 'dinner',
      parts: [
        { food_id: 'F1', name: 'Chicken wrap', servings: 1, estimate: null },
      ],
      reason: 'Your usual dinner fits what is left',
    },
  ],
};

const IDEAS_REQUEST: AiMealIdeasRequest = {
  model: 'gpt-6-sol',
  prompt: {
    count: 3,
    localTime: '2026-10-11T19:30',
    goal: 'cut',
    trainingDay: false,
    location: 'Beirut',
    targets: {
      calories: 2200,
      protein: 170,
      carbs: 220,
      fat: 70,
      satFatMax: 24,
      fiberMin: 30,
      sugarMax: 99,
      sodiumMax: 2300,
    },
    eaten: {
      calories: 1300,
      protein: 90,
      carbs: 130,
      fat: 45,
      satFat: 14,
      fiber: 12,
      sugar: 40,
      sodium: 1500,
      alcohol: 0,
    },
    logged: [],
    foods: [],
    exclude: [],
    note: 'eating out tonight',
  },
};

describe('OpenAiProvider.suggestMeals', () => {
  it('sends the meal ideas instructions and the day as text only, with a strict schema', async () => {
    const { fetch, bodies } = capture(() =>
      json(responseBody(JSON.stringify(IDEAS))),
    );
    const provider = new OpenAiProvider({ ...OPTIONS, fetch });

    const result = await provider.suggestMeals(IDEAS_REQUEST);

    expect(result.raw).toEqual(IDEAS);
    const [body] = bodies as [JsonObject];
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      name: 'meal_ideas',
      strict: true,
    });
    expect(body.input[0].content[0].text).toBe(MEAL_IDEAS_INSTRUCTIONS);
    const content = body.input[1].content as JsonObject[];
    expect(content.map((part) => part.type)).toEqual(['input_text']);
    expect(content[0]?.text).toContain('Suggest 3 options');
    expect(content[0]?.text).toContain('Left today: calories 900 kcal');
    expect(content[0]?.text).toContain('"eating out tonight"');
    expect(body.store).toBe(false);
  });

  it('builds the same call shape the food analysis uses, without images', () => {
    const call = mealIdeasCall(IDEAS_REQUEST);
    expect(call.model).toBe('gpt-6-sol');
    expect(call.instructions).toBe(MEAL_IDEAS_INSTRUCTIONS);
    expect(call.images).toEqual([]);
    expect(call.output.parse(JSON.stringify(IDEAS))).toEqual({
      ok: true,
      data: IDEAS,
    });
  });
});
