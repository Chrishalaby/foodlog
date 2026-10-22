import type { AnalyzeResponse } from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type request from 'supertest';
import {
  AI_PROVIDER,
  type AiAnalyzeRequest,
  type AiAnalyzeResult,
  type AiProvider,
} from '../src/ai/providers/ai-provider.js';
import { MockProvider } from '../src/ai/providers/mock.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const RELEASE_DELAY_MS = 100;

class GatedProvider implements AiProvider {
  readonly name = 'mock';
  readonly started: Promise<void>;
  private markStarted!: () => void;
  private openGate!: () => void;
  private readonly gate: Promise<void>;
  private readonly mock = new MockProvider({ latencyMs: 0 });

  constructor() {
    this.started = new Promise((resolve) => (this.markStarted = resolve));
    this.gate = new Promise((resolve) => (this.openGate = resolve));
  }

  release(): void {
    this.openGate();
  }

  async analyze(request: AiAnalyzeRequest): Promise<AiAnalyzeResult> {
    this.markStarted();
    await this.gate;
    return this.mock.analyze(request);
  }
}

interface DisconnectObservation {
  aiUsageRows: number;
  analysisRows: number;
  responseStatus: number | null;
}

describe('graceful shutdown (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let provider: GatedProvider;

  beforeAll(async () => {
    provider = new GatedProvider();
    app = await createTestApp({
      configure: (builder: TestingModuleBuilder) =>
        builder.overrideProvider(AI_PROVIDER).useValue(provider),
    });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.$connect();
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  it('finishes an in-flight analysis before disconnecting from the database', async () => {
    let settled: request.Response | null = null;
    const observations: DisconnectObservation[] = [];
    const disconnect = prisma.$disconnect.bind(prisma);
    const spy = vi.spyOn(prisma, '$disconnect').mockImplementation(async () => {
      observations.push({
        aiUsageRows: await prisma.aiUsage.count(),
        analysisRows: await prisma.analysis.count(),
        responseStatus: settled?.status ?? null,
      });
      await disconnect();
    });

    const inFlight = agent
      .post('/api/analyze')
      .send({ mode: 'text', description: '2 eggs' })
      .then((response) => {
        settled = response;
        return response;
      });
    await provider.started;

    const closing = app.close();
    setTimeout(() => provider.release(), RELEASE_DELAY_MS);
    const [response] = await Promise.all([inFlight, closing]);

    expect(response.status).toBe(200);
    expect((response.body as AnalyzeResponse).result.items.length).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(observations).toEqual([
      { aiUsageRows: 1, analysisRows: 1, responseStatus: 200 },
    ]);
  });
});
