import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { AiProviderError } from './ai-provider-error.js';
import {
  buildChatRequest,
  normalizeChatUsage,
  stripJsonFence,
} from './openai-chat.js';
import {
  type OpenAiFetch,
  OpenAiStructuredClient,
  type StructuredCall,
  type StructuredOutput,
} from './openai-structured.js';

type JsonObject = Record<string, any>;

const GreetingSchema = z.object({ greeting: z.string() });
type Greeting = z.infer<typeof GreetingSchema>;

const GREETING_OUTPUT: StructuredOutput<Greeting> = {
  format: zodTextFormat(GreetingSchema, 'greeting'),
  parse: (text) => {
    try {
      const result = GreetingSchema.safeParse(JSON.parse(text));
      return result.success
        ? { ok: true, data: result.data }
        : { ok: false, error: 'bad greeting' };
    } catch {
      return { ok: false, error: 'not json' };
    }
  },
};

const CALL: StructuredCall<Greeting> = {
  model: 'qwen2.5vl:7b',
  instructions: 'Say hello.',
  userText: 'Name: Chris',
  images: [{ dataUrl: 'data:image/jpeg;base64,/9j/plate', detail: 'high' }],
  output: GREETING_OUTPUT,
};

function completion(
  content: string | null,
  overrides: JsonObject = {},
): JsonObject {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'qwen2.5vl:7b',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content, refusal: null },
      },
    ],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 80,
      total_tokens: 1280,
      prompt_tokens_details: { cached_tokens: 200 },
      completion_tokens_details: { reasoning_tokens: 10 },
    },
    ...overrides,
  };
}

function capture(
  body: JsonObject,
  status = 200,
): { fetch: OpenAiFetch; urls: string[]; bodies: JsonObject[] } {
  const urls: string[] = [];
  const bodies: JsonObject[] = [];
  const fetch: OpenAiFetch = (input, init) => {
    urls.push(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    bodies.push(
      JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as JsonObject,
    );
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_chat',
        },
      }),
    );
  };
  return { fetch, urls, bodies };
}

const OPTIONS = {
  apiKey: 'ollama',
  timeoutMs: 5_000,
  reasoningEffort: 'low',
  serviceTier: 'default',
  baseURL: 'http://ollama.lan:11434/v1',
  apiStyle: 'chat',
} as const;

describe('buildChatRequest', () => {
  it('sends a system message, the text and the images, and asks for the JSON schema', () => {
    const body = buildChatRequest(CALL, 4000) as JsonObject;
    expect(body).toMatchObject({
      model: 'qwen2.5vl:7b',
      max_tokens: 4000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'greeting', strict: true },
      },
    });
    expect(body.response_format.json_schema.schema).toMatchObject({
      type: 'object',
      properties: { greeting: { type: 'string' } },
    });
    expect(body.messages).toEqual([
      { role: 'system', content: 'Say hello.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Name: Chris' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/jpeg;base64,/9j/plate',
              detail: 'high',
            },
          },
        ],
      },
    ]);
    for (const key of ['store', 'reasoning', 'service_tier', 'text', 'input']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('sends plain text when there are no images', () => {
    const body = buildChatRequest({ ...CALL, images: [] }, 100) as JsonObject;
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Name: Chris' });
  });
});

describe('chat helpers', () => {
  it('maps usage numbers', () => {
    expect(
      normalizeChatUsage({
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
        prompt_tokens_details: { cached_tokens: 2 },
        completion_tokens_details: { reasoning_tokens: 1 },
      }),
    ).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheWriteTokens: 0,
      outputTokens: 4,
      reasoningTokens: 1,
    });
    expect(normalizeChatUsage(undefined).inputTokens).toBe(0);
  });

  it('removes a markdown fence some local models put around JSON', () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFence('  {"a":1} ')).toBe('{"a":1}');
  });
});

describe('OpenAiStructuredClient with the chat API', () => {
  it('posts to the chat completions endpoint of the configured server', async () => {
    const { fetch, urls, bodies } = capture(
      completion('{"greeting":"Hello Chris"}'),
    );
    const client = new OpenAiStructuredClient({ ...OPTIONS, fetch });
    const result = await client.call(CALL);

    expect(urls).toEqual(['http://ollama.lan:11434/v1/chat/completions']);
    expect(bodies[0]?.max_tokens).toBe(16_000);
    expect(result).toMatchObject({
      raw: { greeting: 'Hello Chris' },
      model: 'qwen2.5vl:7b',
      requestId: 'req_chat',
      usage: {
        inputTokens: 1200,
        cachedInputTokens: 200,
        outputTokens: 80,
        reasoningTokens: 10,
      },
    });
  });

  it('accepts JSON wrapped in a code fence', async () => {
    const { fetch } = capture(completion('```json\n{"greeting":"Hi"}\n```'));
    const result = await new OpenAiStructuredClient({ ...OPTIONS, fetch }).call(
      CALL,
    );
    expect(result.raw).toEqual({ greeting: 'Hi' });
  });

  it('reports unusable answers as provider errors', async () => {
    const cases: Array<[JsonObject, string, boolean]> = [
      [completion('{"nope":1}'), 'invalid_output', true],
      [completion('not json'), 'invalid_output', true],
      [
        completion('{"greeting":"Hi"}', {
          choices: [
            {
              index: 0,
              finish_reason: 'length',
              message: { role: 'assistant', content: '{"gre', refusal: null },
            },
          ],
        }),
        'incomplete',
        false,
      ],
      [
        completion(null, {
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: null, refusal: 'No.' },
            },
          ],
        }),
        'refusal',
        false,
      ],
      [
        completion('x', {
          choices: [
            {
              index: 0,
              finish_reason: 'content_filter',
              message: { role: 'assistant', content: '', refusal: null },
            },
          ],
        }),
        'refusal',
        false,
      ],
      [completion('x', { choices: [] }), 'server_error', true],
    ];
    for (const [body, kind, retryable] of cases) {
      const { fetch } = capture(body);
      const error = await new OpenAiStructuredClient({ ...OPTIONS, fetch })
        .call(CALL)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AiProviderError);
      expect(error).toMatchObject({ kind, retryable });
    }
  });

  it('maps HTTP errors like the responses API', async () => {
    const { fetch } = capture({ error: { message: 'model not found' } }, 404);
    const error = await new OpenAiStructuredClient({ ...OPTIONS, fetch })
      .call(CALL)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiProviderError);
  });
});
