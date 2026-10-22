import { storedProvider } from '../../test/support/ai-settings.js';
import { buildConfig } from '../../test/support/config.js';
import { redactSecrets, testAiConnection } from './ai-connection-test.js';
import { type AiConnection, appConnection } from './ai-runtime-settings.js';
import type { OpenAiFetch } from './providers/openai-structured.js';

type JsonObject = Record<string, any>;

const OPENAI_KEY = 'sk-proj-fake-0000000000001a2b';
const config = buildConfig();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recording(respond: (url: string, body: JsonObject) => Response): {
  fetch: OpenAiFetch;
  calls: { url: string; headers: Headers; body: JsonObject }[];
} {
  const calls: { url: string; headers: Headers; body: JsonObject }[] = [];
  const fetch: OpenAiFetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(
      typeof init?.body === 'string' ? init.body : '{}',
    ) as JsonObject;
    calls.push({ url, headers: new Headers(init?.headers), body });
    return respond(url, body);
  };
  return { fetch, calls };
}

function chatAnswer(content: string): JsonObject {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'qwen3-vl:8b',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content, refusal: null },
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
  };
}

function connection(
  overrides: Partial<AiConnection> = {},
  provider = storedProvider('local'),
): AiConnection {
  return { ...appConnection(provider), ...overrides };
}

describe('testAiConnection', () => {
  it('sends one tiny structured request to an OpenAI-compatible server', async () => {
    const { fetch, calls } = recording(() => json(chatAnswer('{"ok":true}')));

    const result = await testAiConnection(connection(), config, fetch);

    expect(result).toMatchObject({ ok: true, model: 'qwen3-vl:8b' });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain('qwen3-vl:8b');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(call?.body.max_tokens).toBe(2048);
    expect(call?.body.response_format.json_schema.name).toBe(
      'connection_check',
    );
    expect(call?.body.messages[1].content).toBe('Reply with {"ok": true}.');
  });

  it('checks Claude through the Messages API', async () => {
    const { fetch, calls } = recording(() =>
      json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: [{ type: 'text', text: '{"ok":true}' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        stop_details: null,
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    );

    const result = await testAiConnection(
      appConnection(
        storedProvider('anthropic', { apiKey: 'sk-ant-fake-key-0000' }),
      ),
      config,
      fetch,
    );

    expect(result).toMatchObject({ ok: true, model: 'claude-sonnet-5-5' });
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.headers.get('x-api-key')).toBe('sk-ant-fake-key-0000');
    expect(calls[0]?.body.max_tokens).toBe(2048);
  });

  it('explains a rejected key without echoing it', async () => {
    const { fetch } = recording(() =>
      json(
        {
          error: {
            message: `Incorrect API key provided: ${OPENAI_KEY}. You can find your API key at https://platform.openai.com/account/api-keys.`,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
        401,
      ),
    );

    const result = await testAiConnection(
      appConnection(storedProvider('openai', { apiKey: OPENAI_KEY })),
      config,
      fetch,
    );

    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.message).toMatch(/^The API key was rejected\./);
    expect(result.message).not.toContain(OPENAI_KEY);
    expect(result.message).not.toContain('sk-proj');
  });

  it('says when the server cannot be reached', async () => {
    const { fetch } = recording(() => {
      throw new TypeError('fetch failed');
    });

    const result = await testAiConnection(
      connection({ baseUrl: 'http://ollama.lan:11434/v1' }),
      config,
      fetch,
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Could not reach ollama.lan:11434');
  });

  it('says when the model does not answer in the expected format', async () => {
    const { fetch } = recording(() => json(chatAnswer('Sure! OK.')));

    const result = await testAiConnection(connection(), config, fetch);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('structured format');
  });
});

describe('redactSecrets', () => {
  it('hides the key and masked key echoes in provider messages', () => {
    expect(
      redactSecrets('Incorrect API key provided: sk-pr***1a2b. See docs.', []),
    ).toBe('Incorrect API key provided: [hidden] See docs.');
    expect(redactSecrets(`bad key ${OPENAI_KEY}!`, [OPENAI_KEY, null])).toBe(
      'bad key [hidden]!',
    );
  });
});
