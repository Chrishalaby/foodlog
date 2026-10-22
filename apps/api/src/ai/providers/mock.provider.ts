import { setTimeout as sleep } from 'node:timers/promises';
import {
  buildMenuUserMessage,
  MENU_INSTRUCTIONS,
} from '../../compare/menu-prompt.js';
import type { MenuScanOutput } from '../../compare/menu-scan.schema.js';
import {
  buildMealIdeasUserMessage,
  MEAL_IDEAS_INSTRUCTIONS,
} from '../../meal-ideas/meal-ideas-prompt.js';
import type { MealIdeasOutput } from '../../meal-ideas/meal-ideas.schema.js';
import type { FoodAnalysisOutput } from '../food-analysis.schema.js';
import { MEAL_SPLIT_INSTRUCTIONS } from '../meal-split.js';
import type { MealSplitOutput } from '../meal-split.schema.js';
import { buildUserMessage, DEVELOPER_INSTRUCTIONS } from '../prompt.js';
import type {
  AiAnalyzeRequest,
  AiAnalyzeResult,
  AiImageInput,
  AiMealIdeasRequest,
  AiMealIdeasResult,
  AiMealSplitResult,
  AiMenuRequest,
  AiMenuResult,
  AiProvider,
  AiTokenUsage,
  MealIdeasAiProvider,
  MealSplitAiProvider,
  MenuAiProvider,
} from './ai-provider.js';
import { mockAnalysis } from './mock-analysis.js';
import { mockMealIdeas } from './mock-meal-ideas.js';
import { mockMealSplit } from './mock-meal-split.js';
import { mockMenuScan } from './mock-menu.js';

export const MOCK_MODEL = 'mock';
export const MOCK_LATENCY_MS = 400;

const SCHEMA_TOKENS = 750;
const IMAGE_TOKENS = { low: 231, high: 922 } as const;
const OUTPUT_TOKENS_BASE = 180;
const OUTPUT_TOKENS_PER_ITEM = 85;
const REASONING_TOKENS = 450;
const MENU_SCHEMA_TOKENS = 420;
const OUTPUT_TOKENS_PER_DISH = 95;
const IDEAS_SCHEMA_TOKENS = 380;
const OUTPUT_TOKENS_PER_IDEA_PART = 45;

export interface MockProviderOptions {
  latencyMs: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function imageTokens(images: readonly AiImageInput[]): number {
  return images.reduce((total, image) => total + IMAGE_TOKENS[image.detail], 0);
}

export function mockUsage(
  request: AiAnalyzeRequest,
  raw: FoodAnalysisOutput,
): AiTokenUsage {
  return {
    inputTokens:
      SCHEMA_TOKENS +
      estimateTokens(DEVELOPER_INSTRUCTIONS) +
      estimateTokens(buildUserMessage(request.prompt)) +
      imageTokens(request.images),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens:
      OUTPUT_TOKENS_BASE +
      OUTPUT_TOKENS_PER_ITEM * raw.items.length +
      REASONING_TOKENS,
    reasoningTokens: REASONING_TOKENS,
  };
}

export function mockMealSplitUsage(
  request: AiAnalyzeRequest,
  raw: MealSplitOutput,
): AiTokenUsage {
  const items = raw.meals.reduce((total, meal) => total + meal.items.length, 0);
  return {
    inputTokens:
      SCHEMA_TOKENS +
      estimateTokens(MEAL_SPLIT_INSTRUCTIONS) +
      estimateTokens(buildUserMessage({ ...request.prompt, split: true })),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens:
      OUTPUT_TOKENS_BASE * raw.meals.length +
      OUTPUT_TOKENS_PER_ITEM * items +
      REASONING_TOKENS,
    reasoningTokens: REASONING_TOKENS,
  };
}

export function mockMenuUsage(
  request: AiMenuRequest,
  raw: MenuScanOutput,
): AiTokenUsage {
  return {
    inputTokens:
      MENU_SCHEMA_TOKENS +
      estimateTokens(MENU_INSTRUCTIONS) +
      estimateTokens(buildMenuUserMessage(request.prompt)) +
      imageTokens(request.images),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens:
      OUTPUT_TOKENS_BASE +
      OUTPUT_TOKENS_PER_DISH * raw.dishes.length +
      REASONING_TOKENS,
    reasoningTokens: REASONING_TOKENS,
  };
}

export function mockMealIdeasUsage(
  request: AiMealIdeasRequest,
  raw: MealIdeasOutput,
): AiTokenUsage {
  const parts = raw.ideas.reduce((total, idea) => total + idea.parts.length, 0);
  return {
    inputTokens:
      IDEAS_SCHEMA_TOKENS +
      estimateTokens(MEAL_IDEAS_INSTRUCTIONS) +
      estimateTokens(buildMealIdeasUserMessage(request.prompt)),
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens:
      OUTPUT_TOKENS_BASE +
      OUTPUT_TOKENS_PER_IDEA_PART * parts +
      REASONING_TOKENS,
    reasoningTokens: REASONING_TOKENS,
  };
}

export class MockProvider
  implements
    AiProvider,
    MenuAiProvider,
    MealSplitAiProvider,
    MealIdeasAiProvider
{
  readonly name = 'mock';

  constructor(private readonly options: MockProviderOptions) {}

  async analyze(request: AiAnalyzeRequest): Promise<AiAnalyzeResult> {
    await this.simulateLatency();
    const raw = mockAnalysis(request.prompt);
    return {
      raw,
      usage: mockUsage(request, raw),
      model: MOCK_MODEL,
      requestId: null,
      latencyMs: this.options.latencyMs,
      serviceTier: null,
    };
  }

  async analyzeMeals(request: AiAnalyzeRequest): Promise<AiMealSplitResult> {
    await this.simulateLatency();
    const raw = mockMealSplit(request.prompt);
    return {
      raw,
      usage: mockMealSplitUsage(request, raw),
      model: MOCK_MODEL,
      requestId: null,
      latencyMs: this.options.latencyMs,
      serviceTier: null,
    };
  }

  async extractMenu(request: AiMenuRequest): Promise<AiMenuResult> {
    await this.simulateLatency();
    const raw = mockMenuScan();
    return {
      raw,
      usage: mockMenuUsage(request, raw),
      model: MOCK_MODEL,
      requestId: null,
      latencyMs: this.options.latencyMs,
      serviceTier: null,
    };
  }

  async suggestMeals(request: AiMealIdeasRequest): Promise<AiMealIdeasResult> {
    await this.simulateLatency();
    const raw = mockMealIdeas(request.prompt);
    return {
      raw,
      usage: mockMealIdeasUsage(request, raw),
      model: MOCK_MODEL,
      requestId: null,
      latencyMs: this.options.latencyMs,
      serviceTier: null,
    };
  }

  private async simulateLatency(): Promise<void> {
    if (this.options.latencyMs > 0) {
      await sleep(this.options.latencyMs);
    }
  }
}
