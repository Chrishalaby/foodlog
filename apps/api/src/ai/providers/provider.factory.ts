import type { AppConfig } from '../../config/app-config.js';
import type {
  AiAnalyzeResult,
  AiMealIdeasResult,
  AiMealSplitResult,
  AiMenuResult,
  AiProvider,
  MealIdeasAiProvider,
  MealSplitAiProvider,
  MenuAiProvider,
} from './ai-provider.js';
import { AiProviderError } from './ai-provider-error.js';
import { MOCK_LATENCY_MS, MockProvider } from './mock.provider.js';
import { OpenAiProvider } from './openai.provider.js';

export type ConfiguredAiProvider = AiProvider &
  MenuAiProvider &
  MealSplitAiProvider &
  MealIdeasAiProvider;

function missingApiKey(): AiProviderError {
  return new AiProviderError('auth', 'OPENAI_API_KEY is not set', false);
}

export class UnconfiguredAiProvider
  implements
    AiProvider,
    MenuAiProvider,
    MealSplitAiProvider,
    MealIdeasAiProvider
{
  readonly name = 'openai';

  analyze(): Promise<AiAnalyzeResult> {
    return Promise.reject(missingApiKey());
  }

  analyzeMeals(): Promise<AiMealSplitResult> {
    return Promise.reject(missingApiKey());
  }

  extractMenu(): Promise<AiMenuResult> {
    return Promise.reject(missingApiKey());
  }

  suggestMeals(): Promise<AiMealIdeasResult> {
    return Promise.reject(missingApiKey());
  }
}

export function createAiProvider(config: AppConfig): ConfiguredAiProvider {
  const { ai } = config;
  if (ai.provider === 'mock') {
    return new MockProvider({
      latencyMs: config.nodeEnv === 'test' ? 0 : MOCK_LATENCY_MS,
    });
  }
  if (!ai.apiKey) {
    return new UnconfiguredAiProvider();
  }
  return new OpenAiProvider({
    apiKey: ai.apiKey,
    timeoutMs: ai.timeoutMs,
    ...(ai.baseUrl ? { baseURL: ai.baseUrl } : {}),
    apiStyle: ai.apiStyle,
    reasoningEffort: ai.reasoningEffort,
    serviceTier: ai.serviceTier,
  });
}
