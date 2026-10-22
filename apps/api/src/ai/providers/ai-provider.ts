import type { ImageDetail } from '@food/shared';
import type { MenuPromptInput } from '../../compare/menu-prompt.js';
import type { MenuScanOutput } from '../../compare/menu-scan.schema.js';
import type { MealIdeasPromptInput } from '../../meal-ideas/meal-ideas-prompt.js';
import type { MealIdeasOutput } from '../../meal-ideas/meal-ideas.schema.js';
import type { FoodAnalysisOutput } from '../food-analysis.schema.js';
import type { MealSplitOutput } from '../meal-split.schema.js';
import type { AnalysisPromptInput } from '../prompt.js';

export const AI_PROVIDER = Symbol('AI_PROVIDER');
export const MENU_AI_PROVIDER = Symbol('MENU_AI_PROVIDER');
export const MEAL_IDEAS_AI_PROVIDER = Symbol('MEAL_IDEAS_AI_PROVIDER');

export interface AiTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface AiImageInput {
  dataUrl: string;
  detail: ImageDetail;
}

export interface AiStructuredResult<T> {
  raw: T;
  usage: AiTokenUsage;
  model: string;
  requestId: string | null;
  latencyMs: number;
  serviceTier: string | null;
}

export interface AiAnalyzeRequest {
  model: string;
  images: AiImageInput[];
  prompt: AnalysisPromptInput;
}

export type AiAnalyzeResult = AiStructuredResult<FoodAnalysisOutput>;

export type AiMealSplitResult = AiStructuredResult<MealSplitOutput>;

export interface AiMenuRequest {
  model: string;
  images: AiImageInput[];
  prompt: MenuPromptInput;
}

export type AiMenuResult = AiStructuredResult<MenuScanOutput>;

export interface AiMealIdeasRequest {
  model: string;
  prompt: MealIdeasPromptInput;
}

export type AiMealIdeasResult = AiStructuredResult<MealIdeasOutput>;

export interface AiProvider {
  readonly name: 'openai' | 'mock';
  analyze(request: AiAnalyzeRequest): Promise<AiAnalyzeResult>;
}

export interface MealSplitAiProvider {
  readonly name: 'openai' | 'mock';
  analyzeMeals(request: AiAnalyzeRequest): Promise<AiMealSplitResult>;
}

export interface MenuAiProvider {
  readonly name: 'openai' | 'mock';
  extractMenu(request: AiMenuRequest): Promise<AiMenuResult>;
}

export interface MealIdeasAiProvider {
  readonly name: 'openai' | 'mock';
  suggestMeals(request: AiMealIdeasRequest): Promise<AiMealIdeasResult>;
}

export function zeroUsage(): AiTokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}
