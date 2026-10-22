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
  AnthropicStructuredClient,
  type AnthropicProviderOptions,
} from './anthropic-structured.js';
import {
  foodAnalysisCall,
  mealIdeasCall,
  mealSplitCall,
  menuScanCall,
} from './openai.provider.js';

export class AnthropicProvider
  implements
    AiProvider,
    MenuAiProvider,
    MealSplitAiProvider,
    MealIdeasAiProvider
{
  readonly name = 'anthropic';
  private readonly client: AnthropicStructuredClient;

  constructor(options: AnthropicProviderOptions) {
    this.client = new AnthropicStructuredClient(options);
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
