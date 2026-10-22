import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AiUsageRecorder } from './ai-usage.recorder.js';
import { zeroUsage } from './providers/ai-provider.js';

function prismaMock(): PrismaService {
  return {
    aiUsage: {
      create: ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'usage-1', ...data }),
    },
  } as unknown as PrismaService;
}

describe('AiUsageRecorder warnings', () => {
  it('warns once per model without a known price, however often it is used', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const recorder = new AiUsageRecorder(prismaMock());
    const attempt = (model: string) =>
      recorder.record(
        {
          userId: 'u1',
          mode: 'food_photo',
          detail: 'high',
          requestedModel: model,
        },
        {
          attempt: 1,
          ok: true,
          durationMs: 10,
          result: {
            raw: {},
            usage: { ...zeroUsage(), inputTokens: 100, outputTokens: 10 },
            model,
            requestId: null,
            latencyMs: 10,
            serviceTier: null,
          },
        },
      );

    await attempt('qwen2.5vl:7b');
    await attempt('qwen2.5vl:7b');
    await attempt('llava:13b');
    await attempt('qwen2.5vl:7b');

    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      'No price known for model "qwen2.5vl:7b"; recording its cost as 0',
      'No price known for model "llava:13b"; recording its cost as 0',
    ]);
    warn.mockRestore();
  });
});
