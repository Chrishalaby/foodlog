import type { AppConfig } from '../../config/app-config.js';
import type { AiConnection } from '../ai-runtime-settings.js';
import type {
  AiAnalyzeResult,
  AiMealIdeasResult,
  AiMealSplitResult,
  AiMenuResult,
  AiProvider,
  AiStructuredResult,
  MealIdeasAiProvider,
  MealSplitAiProvider,
  MenuAiProvider,
} from './ai-provider.js';
import { AiProviderError } from './ai-provider-error.js';
import { AnthropicProvider } from './anthropic.provider.js';
import {
  ANTHROPIC_BASE_URL,
  AnthropicStructuredClient,
} from './anthropic-structured.js';
import { MOCK_LATENCY_MS, MockProvider } from './mock.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import {
  OpenAiStructuredClient,
  type OpenAiFetch,
  type StructuredCall,
} from './openai-structured.js';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const KEYLESS_API_KEY = 'not-needed';

export type ConfiguredAiProvider = AiProvider &
  MenuAiProvider &
  MealSplitAiProvider &
  MealIdeasAiProvider;

export interface StructuredClient {
  call<T>(call: StructuredCall<T>): Promise<AiStructuredResult<T>>;
}

export interface StructuredClientOptions {
  maxOutputTokens?: number;
  fetch?: OpenAiFetch;
}

function notConfigured(): AiProviderError {
  return new AiProviderError('auth', 'No AI provider is configured', false);
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
    return Promise.reject(notConfigured());
  }

  analyzeMeals(): Promise<AiMealSplitResult> {
    return Promise.reject(notConfigured());
  }

  extractMenu(): Promise<AiMenuResult> {
    return Promise.reject(notConfigured());
  }

  suggestMeals(): Promise<AiMealIdeasResult> {
    return Promise.reject(notConfigured());
  }
}

function anthropicOptions(
  connection: AiConnection,
  config: AppConfig,
  options: StructuredClientOptions,
) {
  return {
    apiKey: connection.apiKey ?? '',
    timeoutMs: config.ai.timeoutMs,
    baseURL: connection.baseUrl ?? ANTHROPIC_BASE_URL,
    reasoningEffort: config.ai.reasoningEffort,
    ...options,
  };
}

function openAiOptions(
  connection: AiConnection,
  config: AppConfig,
  options: StructuredClientOptions,
) {
  return {
    apiKey: connection.apiKey ?? KEYLESS_API_KEY,
    timeoutMs: config.ai.timeoutMs,
    baseURL: connection.baseUrl ?? OPENAI_BASE_URL,
    apiStyle: connection.apiStyle,
    reasoningEffort: config.ai.reasoningEffort,
    serviceTier: config.ai.serviceTier,
    ...options,
  };
}

export function createStructuredClient(
  connection: AiConnection,
  config: AppConfig,
  options: StructuredClientOptions = {},
): StructuredClient {
  return connection.provider === 'anthropic'
    ? new AnthropicStructuredClient(
        anthropicOptions(connection, config, options),
      )
    : new OpenAiStructuredClient(openAiOptions(connection, config, options));
}

export function createAiProvider(
  connection: AiConnection,
  config: AppConfig,
): ConfiguredAiProvider {
  if (connection.provider === 'mock') {
    return new MockProvider({
      latencyMs: config.nodeEnv === 'test' ? 0 : MOCK_LATENCY_MS,
    });
  }
  if (connection.provider === 'unconfigured') {
    return new UnconfiguredAiProvider();
  }
  if (connection.provider === 'anthropic') {
    return new AnthropicProvider(anthropicOptions(connection, config, {}));
  }
  return new OpenAiProvider(openAiOptions(connection, config, {}));
}
