import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { AiProviderSettingsService } from '../ai-provider-settings.service.js';
import type { AiConnection } from '../ai-runtime-settings.js';
import type {
  AiAnalyzeRequest,
  AiAnalyzeResult,
  AiMealIdeasRequest,
  AiMealIdeasResult,
  AiMealSplitResult,
  AiMenuRequest,
  AiMenuResult,
  AiProviderName,
} from './ai-provider.js';
import {
  type ConfiguredAiProvider,
  createAiProvider,
} from './provider.factory.js';

@Injectable()
export class RuntimeAiProvider implements ConfiguredAiProvider {
  private built: {
    connection: AiConnection;
    provider: ConfiguredAiProvider;
  } | null = null;

  constructor(
    private readonly settings: AiProviderSettingsService,
    private readonly config: AppConfig,
  ) {}

  get name(): AiProviderName {
    return this.current().name;
  }

  analyze(request: AiAnalyzeRequest): Promise<AiAnalyzeResult> {
    return this.current().analyze(request);
  }

  analyzeMeals(request: AiAnalyzeRequest): Promise<AiMealSplitResult> {
    return this.current().analyzeMeals(request);
  }

  extractMenu(request: AiMenuRequest): Promise<AiMenuResult> {
    return this.current().extractMenu(request);
  }

  suggestMeals(request: AiMealIdeasRequest): Promise<AiMealIdeasResult> {
    return this.current().suggestMeals(request);
  }

  private current(): ConfiguredAiProvider {
    const connection = this.settings.snapshot().ai;
    if (this.built?.connection !== connection) {
      this.built = {
        connection,
        provider: createAiProvider(connection, this.config),
      };
    }
    return this.built.provider;
  }
}
