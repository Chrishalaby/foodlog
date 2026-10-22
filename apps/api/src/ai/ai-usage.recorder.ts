import type { AiUsageSummary, UsageMode } from '@food/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  canonicalModelId,
  computeCostUsd,
  serviceTierMultiplier,
  TYPICAL_REQUEST_TOKENS,
} from './models.js';
import { type AiTokenUsage, zeroUsage } from './providers/ai-provider.js';
import { MOCK_MODEL } from './providers/mock.provider.js';
import { DEFAULT_MAX_OUTPUT_TOKENS } from './providers/openai.provider.js';
import type { StructuredAttemptRecord } from './providers/structured-attempts.js';

export const USAGE_ERROR_MESSAGE_MAX = 500;

export interface AttemptContext {
  userId: string;
  mode: UsageMode;
  detail: string | null;
  requestedModel: string;
}

export interface RecordedAttempt {
  id: string;
  model: string;
  usage: AiTokenUsage;
  costUsd: number;
  durationMs: number;
  success: boolean;
}

export type UnknownModelWarning = (model: string) => void;

export function attemptCostUsd(
  model: string,
  usage: AiTokenUsage,
  serviceTier: string | null | undefined,
  onUnknownModel: UnknownModelWarning,
): number {
  if (model === MOCK_MODEL) {
    return 0;
  }
  const cost = computeCostUsd(
    model,
    usage,
    serviceTierMultiplier(model, serviceTier),
  );
  if (cost === null) {
    onUnknownModel(model);
    return 0;
  }
  return cost;
}

export function timeoutUsageEstimate(): AiTokenUsage {
  return {
    inputTokens: TYPICAL_REQUEST_TOKENS.input,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    reasoningTokens: 0,
  };
}

function billedUsage<T>(
  record: StructuredAttemptRecord<T>,
  usage: AiTokenUsage,
): AiTokenUsage {
  const timedOutWithoutUsage =
    !record.ok &&
    record.error.kind === 'timeout' &&
    !record.error.details?.usage;
  return timedOutWithoutUsage ? timeoutUsageEstimate() : usage;
}

export function buildUsageRow<T>(
  context: AttemptContext,
  record: StructuredAttemptRecord<T>,
  onUnknownModel: UnknownModelWarning,
  costUsd?: number,
): Prisma.AiUsageUncheckedCreateInput {
  const details = record.ok ? null : record.error.details;
  const model = canonicalModelId(
    (record.ok ? record.result.model : details?.model) ||
      context.requestedModel,
  );
  const usage = record.ok
    ? record.result.usage
    : (details?.usage ?? zeroUsage());
  const serviceTier = record.ok
    ? record.result.serviceTier
    : (details?.serviceTier ?? null);
  return {
    userId: context.userId,
    model,
    mode: context.mode,
    detail: context.detail,
    attempt: record.attempt,
    ...usage,
    costUsd:
      costUsd ??
      attemptCostUsd(
        model,
        billedUsage(record, usage),
        serviceTier,
        onUnknownModel,
      ),
    durationMs: record.durationMs,
    success: record.ok,
    errorKind: record.ok ? null : record.error.kind,
    errorMessage: record.ok
      ? null
      : record.error.message.slice(0, USAGE_ERROR_MESSAGE_MAX),
    requestId:
      (record.ok ? record.result.requestId : details?.requestId) ?? null,
  };
}

export function summarizeUsage(
  model: string,
  attempts: readonly RecordedAttempt[],
): AiUsageSummary {
  const sum = (pick: (attempt: RecordedAttempt) => number): number =>
    attempts.reduce((total, attempt) => total + pick(attempt), 0);
  return {
    model,
    inputTokens: sum((a) => a.usage.inputTokens),
    cachedInputTokens: sum((a) => a.usage.cachedInputTokens),
    outputTokens: sum((a) => a.usage.outputTokens),
    reasoningTokens: sum((a) => a.usage.reasoningTokens),
    costUsd: Math.round(sum((a) => a.costUsd) * 1e6) / 1e6,
    durationMs: sum((a) => a.durationMs),
    attempts: attempts.length,
  };
}

@Injectable()
export class AiUsageRecorder {
  private readonly logger = new Logger(AiUsageRecorder.name);
  private readonly unpricedModels = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async record<T>(
    context: AttemptContext,
    record: StructuredAttemptRecord<T>,
    costUsd?: number,
  ): Promise<RecordedAttempt> {
    const data = buildUsageRow(
      context,
      record,
      (model) => this.warnUnpriced(model),
      costUsd,
    );
    const row = await this.prisma.aiUsage.create({ data });
    return {
      id: row.id,
      model: row.model,
      usage: {
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        outputTokens: row.outputTokens,
        reasoningTokens: row.reasoningTokens,
      },
      costUsd: row.costUsd,
      durationMs: row.durationMs,
      success: row.success,
    };
  }

  private warnUnpriced(model: string): void {
    if (this.unpricedModels.has(model)) {
      return;
    }
    this.unpricedModels.add(model);
    this.logger.warn(
      `No price known for model "${model}"; recording its cost as 0`,
    );
  }
}
