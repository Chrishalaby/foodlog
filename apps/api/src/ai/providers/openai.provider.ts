import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import {
  buildMenuUserMessage,
  MENU_INSTRUCTIONS,
} from '../../compare/menu-prompt.js';
import {
  MENU_SCAN_TEXT_FORMAT,
  type MenuScanOutput,
  parseMenuScanJson,
} from '../../compare/menu-scan.schema.js';
import {
  buildMealIdeasUserMessage,
  MEAL_IDEAS_INSTRUCTIONS,
} from '../../meal-ideas/meal-ideas-prompt.js';
import {
  MEAL_IDEAS_TEXT_FORMAT,
  type MealIdeasOutput,
  parseMealIdeasJson,
} from '../../meal-ideas/meal-ideas.schema.js';
import {
  FOOD_ANALYSIS_TEXT_FORMAT,
  type FoodAnalysisOutput,
  parseFoodAnalysisJson,
} from '../food-analysis.schema.js';
import { MEAL_SPLIT_INSTRUCTIONS } from '../meal-split.js';
import {
  MEAL_SPLIT_TEXT_FORMAT,
  type MealSplitOutput,
  parseMealSplitJson,
} from '../meal-split.schema.js';
import { buildUserMessage, DEVELOPER_INSTRUCTIONS } from '../prompt.js';
import type {
  AiAnalyzeRequest,
  AiAnalyzeResult,
  AiMealIdeasRequest,
  AiMealIdeasResult,
  AiMealSplitResult,
  AiMenuRequest,
  AiMenuResult,
  AiProvider,
  MealIdeasAiProvider,
  MealSplitAiProvider,
  MenuAiProvider,
} from './ai-provider.js';
import {
  buildStructuredRequest,
  interpretStructuredResponse,
  OpenAiStructuredClient,
  type OpenAiProviderOptions,
  type OpenAiRequestSettings,
  type OpenAiResult,
  type StructuredCall,
  type StructuredOutput,
} from './openai-structured.js';

export {
  DEFAULT_MAX_OUTPUT_TOKENS,
  normalizeOpenAiUsage,
  type OpenAiFetch,
  type OpenAiProviderOptions,
  type OpenAiRequestSettings,
} from './openai-structured.js';

export const FOOD_ANALYSIS_OUTPUT: StructuredOutput<FoodAnalysisOutput> = {
  format: FOOD_ANALYSIS_TEXT_FORMAT,
  parse: parseFoodAnalysisJson,
};

export const MENU_SCAN_OUTPUT: StructuredOutput<MenuScanOutput> = {
  format: MENU_SCAN_TEXT_FORMAT,
  parse: parseMenuScanJson,
};

export const MEAL_SPLIT_OUTPUT: StructuredOutput<MealSplitOutput> = {
  format: MEAL_SPLIT_TEXT_FORMAT,
  parse: parseMealSplitJson,
};

export const MEAL_IDEAS_OUTPUT: StructuredOutput<MealIdeasOutput> = {
  format: MEAL_IDEAS_TEXT_FORMAT,
  parse: parseMealIdeasJson,
};

export function foodAnalysisCall(
  request: AiAnalyzeRequest,
): StructuredCall<FoodAnalysisOutput> {
  return {
    model: request.model,
    instructions: DEVELOPER_INSTRUCTIONS,
    userText: buildUserMessage(request.prompt),
    images: request.images,
    output: FOOD_ANALYSIS_OUTPUT,
  };
}

export function mealSplitCall(
  request: AiAnalyzeRequest,
): StructuredCall<MealSplitOutput> {
  return {
    model: request.model,
    instructions: MEAL_SPLIT_INSTRUCTIONS,
    userText: buildUserMessage({ ...request.prompt, split: true }),
    images: [],
    output: MEAL_SPLIT_OUTPUT,
  };
}

export function menuScanCall(
  request: AiMenuRequest,
): StructuredCall<MenuScanOutput> {
  return {
    model: request.model,
    instructions: MENU_INSTRUCTIONS,
    userText: buildMenuUserMessage(request.prompt),
    images: request.images,
    output: MENU_SCAN_OUTPUT,
  };
}

export function mealIdeasCall(
  request: AiMealIdeasRequest,
): StructuredCall<MealIdeasOutput> {
  return {
    model: request.model,
    instructions: MEAL_IDEAS_INSTRUCTIONS,
    userText: buildMealIdeasUserMessage(request.prompt),
    images: [],
    output: MEAL_IDEAS_OUTPUT,
  };
}

export function buildOpenAiRequest(
  request: AiAnalyzeRequest,
  settings: OpenAiRequestSettings,
): ResponseCreateParamsNonStreaming {
  return buildStructuredRequest(foodAnalysisCall(request), settings);
}

export function interpretOpenAiResponse(
  response: OpenAiResult,
  requestedModel: string,
  latencyMs: number,
): AiAnalyzeResult {
  return interpretStructuredResponse(
    response,
    FOOD_ANALYSIS_OUTPUT,
    requestedModel,
    latencyMs,
  );
}

export class OpenAiProvider
  implements
    AiProvider,
    MenuAiProvider,
    MealSplitAiProvider,
    MealIdeasAiProvider
{
  readonly name = 'openai';
  private readonly client: OpenAiStructuredClient;

  constructor(options: OpenAiProviderOptions) {
    this.client = new OpenAiStructuredClient(options);
  }

  analyze(request: AiAnalyzeRequest): Promise<AiAnalyzeResult> {
    return this.client.call(foodAnalysisCall(request));
  }

  analyzeMeals(request: AiAnalyzeRequest): Promise<AiMealSplitResult> {
    return this.client.call(mealSplitCall(request));
  }

  extractMenu(request: AiMenuRequest): Promise<AiMenuResult> {
    return this.client.call(menuScanCall(request));
  }

  suggestMeals(request: AiMealIdeasRequest): Promise<AiMealIdeasResult> {
    return this.client.call(mealIdeasCall(request));
  }
}
