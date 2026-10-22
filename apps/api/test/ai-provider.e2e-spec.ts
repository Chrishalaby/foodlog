import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  AiProviderResponse,
  AnalyzeResponse,
  ApiError,
  ProfileResponse,
  TestAiProviderResponse,
  UpdateAiProviderRequest,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { MockProvider } from '../src/ai/providers/mock.provider.js';
import type { AiAnalyzeRequest } from '../src/ai/providers/ai-provider.js';
import { AppConfig } from '../src/config/app-config.js';
import { type AiSettings, parseSettings } from '../src/config/settings.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSignedInUser,
  createTestApp,
  resetDatabase,
  type SignedInTestUser,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const CLAUDE_KEY = 'sk-ant-e2e-fake-key-00001a2b';
const SERVER_KEY = 'sk-local-e2e-fake-key-5678';
const WRONG_KEY = 'sk-wrong-e2e-fake-key-9999';
const PATH = '/api/admin/ai-provider';

const ANALYZE_REQUEST: AiAnalyzeRequest = {
  model: 'vision-e2e',
  images: [],
  prompt: {
    mode: 'text',
    imageRoles: [],
    description: 'an apple',
    localTime: '2026-10-22T12:00',
    mealType: null,
    location: null,
    answeredQuestions: [],
    followUp: null,
  },
};

function withAiSettings(
  overrides: Partial<AiSettings>,
): (builder: TestingModuleBuilder) => TestingModuleBuilder {
  const settings = parseSettings(process.env);
  const config = new AppConfig({
    ...settings,
    ai: { ...settings.ai, ...overrides },
  });
  return (builder) => builder.overrideProvider(AppConfig).useValue(config);
}

interface FakeServer {
  url: string;
  requests: {
    path: string;
    authorization: string;
    body: Record<string, any>;
  }[];
  close: () => Promise<void>;
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<
    string,
    any
  >;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startFakeAiServer(): Promise<FakeServer> {
  const mock = new MockProvider({ latencyMs: 0 });
  const answers: Record<string, unknown> = {
    connection_check: { ok: true },
    food_analysis: (await mock.analyze(ANALYZE_REQUEST)).raw,
    meal_split: (await mock.analyzeMeals(ANALYZE_REQUEST)).raw,
  };
  const requests: FakeServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    void readJson(req).then((body) => {
      const authorization = req.headers.authorization ?? '';
      requests.push({ path: req.url ?? '', authorization, body });
      if (authorization === `Bearer ${WRONG_KEY}`) {
        send(res, 401, {
          error: {
            message: `Incorrect API key provided: ${WRONG_KEY}.`,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        });
        return;
      }
      const name = body.response_format?.json_schema?.name as string;
      send(res, 200, {
        id: 'chatcmpl-e2e',
        object: 'chat.completion',
        created: 1,
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify(answers[name] ?? {}),
              refusal: null,
            },
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function claudeSettings(
  overrides: Partial<UpdateAiProviderRequest> = {},
): UpdateAiProviderRequest {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    preciseModel: 'claude-opus-5-5',
    apiKey: CLAUDE_KEY,
    voiceEnabled: true,
    ...overrides,
  };
}

describe('admin AI provider settings (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let member: SignedInTestUser;
  let fake: FakeServer;

  function customSettings(
    overrides: Partial<UpdateAiProviderRequest> = {},
  ): UpdateAiProviderRequest {
    return {
      provider: 'custom',
      baseUrl: fake.url,
      apiStyle: 'chat',
      model: 'vision-e2e',
      preciseModel: 'vision-e2e-large',
      apiKey: SERVER_KEY,
      voiceEnabled: false,
      ...overrides,
    };
  }

  beforeAll(async () => {
    fake = await startFakeAiServer();
    app = await createTestApp({
      configure: withAiSettings({ provider: 'openai', apiKey: null }),
    });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    admin = await setupAndLogin(app);
    member = await createSignedInUser(app);
  });

  afterEach(async () => {
    await admin.delete(PATH).expect(200);
    fake.requests.length = 0;
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
    await fake.close();
  });

  it('lets only admins read or change the provider', async () => {
    await request(app.getHttpServer()).get(PATH).expect(401);
    await member.agent.get(PATH).expect(403);
    await member.agent.put(PATH).send(claudeSettings()).expect(403);
    await member.agent.delete(PATH).expect(403);
    await member.agent.post(`${PATH}/test`).send(claudeSettings()).expect(403);
    expect(await prisma.aiProviderConfig.count()).toBe(0);
  });

  it('starts with AI off and editable', async () => {
    const response = await admin.get(PATH).expect(200);
    expect(response.body as AiProviderResponse).toEqual({
      source: 'none',
      editable: true,
      active: false,
      voice: false,
      keyUnreadable: false,
      settings: null,
      server: null,
    });
    const profile = await member.agent.get('/api/profile').expect(200);
    expect((profile.body as ProfileResponse).ai.provider).toBe('unconfigured');
  });

  it('saves Claude with an encrypted key that is never returned or exported', async () => {
    const saved = await admin.put(PATH).send(claudeSettings()).expect(200);
    const body = saved.body as AiProviderResponse;

    expect(body).toMatchObject({
      source: 'app',
      active: true,
      voice: false,
      settings: {
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        hasApiKey: true,
        apiKeyLast4: '1a2b',
      },
    });
    expect(saved.text).not.toContain(CLAUDE_KEY);
    expect((await admin.get(PATH).expect(200)).text).not.toContain(CLAUDE_KEY);

    const row = await prisma.aiProviderConfig.findUniqueOrThrow({
      where: { id: 'default' },
    });
    expect(row.apiKeySealed).toMatch(/^v1:(env|db):/);
    expect(JSON.stringify(row)).not.toContain(CLAUDE_KEY);

    const profile = await member.agent.get('/api/profile').expect(200);
    const ai = (profile.body as ProfileResponse).ai;
    expect(ai).toMatchObject({
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-5-5',
      voice: false,
    });
    expect(ai.availableModels.map((model) => model.id)).toContain(
      'claude-opus-5-5',
    );
    expect(profile.text).not.toContain(CLAUDE_KEY);

    for (const agent of [admin, member.agent]) {
      const exported = await agent.get('/api/export').expect(200);
      expect(exported.text).not.toContain(CLAUDE_KEY);
      expect(exported.text).not.toContain('apiKeySealed');
    }
  });

  it('keeps the saved key when settings are saved again without one', async () => {
    await admin.put(PATH).send(customSettings()).expect(200);
    const resaved = await admin
      .put(PATH)
      .send(customSettings({ apiKey: undefined, model: 'vision-e2e-2' }))
      .expect(200);

    expect((resaved.body as AiProviderResponse).settings).toMatchObject({
      model: 'vision-e2e-2',
      hasApiKey: true,
      apiKeyLast4: '5678',
    });
    const result = await admin
      .post(`${PATH}/test`)
      .send(customSettings({ apiKey: undefined }))
      .expect(200);
    expect((result.body as TestAiProviderResponse).ok).toBe(true);
    expect(fake.requests.at(-1)?.authorization).toBe(`Bearer ${SERVER_KEY}`);
  });

  it('uses a newly saved provider for analysis without a restart', async () => {
    await member.agent
      .post('/api/analyze')
      .send({ mode: 'text', description: 'an apple' })
      .expect(503);

    await admin.put(PATH).send(customSettings()).expect(200);
    const analyzed = await member.agent
      .post('/api/analyze')
      .send({ mode: 'text', description: 'an apple' })
      .expect(200);

    expect((analyzed.body as AnalyzeResponse).usage.model).toBe('vision-e2e');
    const call = fake.requests.find((entry) =>
      entry.path.endsWith('/chat/completions'),
    );
    expect(call?.authorization).toBe(`Bearer ${SERVER_KEY}`);
    expect(call?.body.model).toBe('vision-e2e');
    const usage = await prisma.aiUsage.findFirstOrThrow({
      where: { userId: member.user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(usage).toMatchObject({
      model: 'vision-e2e',
      inputTokens: 120,
      outputTokens: 40,
      costUsd: 0,
      success: true,
    });
  });

  it('tests a connection and explains a failure without echoing the key', async () => {
    const ok = await admin
      .post(`${PATH}/test`)
      .send(customSettings())
      .expect(200);
    expect(ok.body as TestAiProviderResponse).toMatchObject({
      ok: true,
      model: 'vision-e2e',
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.body.response_format.json_schema.name).toBe(
      'connection_check',
    );
    expect(await prisma.aiProviderConfig.count()).toBe(0);

    const rejected = await admin
      .post(`${PATH}/test`)
      .send(customSettings({ apiKey: WRONG_KEY }))
      .expect(200);
    const failure = rejected.body as TestAiProviderResponse;
    expect(failure.ok).toBe(false);
    expect(failure.message).toMatch(/^The API key was rejected\./);
    expect(rejected.text).not.toContain(WRONG_KEY);

    const unreachable = await admin
      .post(`${PATH}/test`)
      .send(customSettings({ baseUrl: 'http://127.0.0.1:9/v1' }))
      .expect(200);
    expect((unreachable.body as TestAiProviderResponse).message).toContain(
      'Could not reach 127.0.0.1:9',
    );
  });

  it('rejects incomplete or invalid settings', async () => {
    const missingKey = await admin
      .put(PATH)
      .send(claudeSettings({ apiKey: null }))
      .expect(400);
    expect((missingKey.body as ApiError).message).toEqual([
      'apiKey is required for Anthropic (Claude)',
    ]);
    await admin
      .put(PATH)
      .send(customSettings({ baseUrl: 'ftp://example.com' }))
      .expect(400);
    await admin
      .put(PATH)
      .send(customSettings({ baseUrl: 'http://user:secret@example.com/v1' }))
      .expect(400);
    await admin
      .put(PATH)
      .send({ ...claudeSettings(), provider: 'skynet' })
      .expect(400);
    await admin
      .put(PATH)
      .send({ ...claudeSettings(), extra: true })
      .expect(400);
    expect(await prisma.aiProviderConfig.count()).toBe(0);
  });
});

describe('AI provider set on the server (e2e)', () => {
  it('shows the server settings read-only and refuses changes', async () => {
    const app = await createTestApp({
      configure: withAiSettings({
        provider: 'openai',
        apiKey: 'sk-env-e2e-fake-key-4321',
      }),
    });
    const prisma = app.get(PrismaService);
    try {
      await resetDatabase(prisma);
      const admin = await setupAndLogin(app);

      const response = await admin.get(PATH).expect(200);
      expect(response.body as AiProviderResponse).toMatchObject({
        source: 'env',
        editable: false,
        active: true,
        server: { provider: 'openai', model: 'gpt-5.6-sol' },
      });
      expect(response.text).not.toContain('sk-env-e2e-fake-key-4321');
      const refused = await admin.put(PATH).send(claudeSettings()).expect(409);
      expect((refused.body as ApiError).message).toContain('OPENAI_API_KEY');
      await admin.delete(PATH).expect(409);
      await admin.post(`${PATH}/test`).send(claudeSettings()).expect(409);
      expect(await prisma.aiProviderConfig.count()).toBe(0);
    } finally {
      await resetDatabase(prisma);
      await app.close();
    }
  });
});
