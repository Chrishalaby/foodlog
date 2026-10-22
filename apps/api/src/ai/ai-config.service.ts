import type { AiConfigDto, AiModelOption } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { AiProviderSettingsService } from './ai-provider-settings.service.js';
import type { AiConnection } from './ai-runtime-settings.js';
import {
  canonicalModelId,
  estimateTypicalCostUsd,
  isSelectableModel,
  selectableModels,
} from './models.js';

@Injectable()
export class AiConfigService {
  constructor(
    private readonly config: AppConfig,
    private readonly settings: AiProviderSettingsService,
  ) {}

  private get connection(): AiConnection {
    return this.settings.snapshot().ai;
  }

  get provider(): AiConfigDto['provider'] {
    return this.connection.provider;
  }

  get customEndpoint(): boolean {
    return this.connection.catalog === null;
  }

  get voiceEnabled(): boolean {
    const { ai, voice } = this.settings.snapshot();
    if (ai.provider === 'mock') {
      return true;
    }
    return ai.provider !== 'unconfigured' && voice.enabled;
  }

  get transcribeModel(): string {
    return this.settings.snapshot().voice.model.trim();
  }

  get defaultModel(): string {
    return canonicalModelId(this.connection.model);
  }

  get preciseModel(): string {
    return canonicalModelId(this.connection.preciseModel);
  }

  isSelectableModel(model: string): boolean {
    const { catalog } = this.connection;
    return catalog === null
      ? this.customModels().includes(model.trim())
      : isSelectableModel(model, catalog);
  }

  resolveModel(
    profileModel: string | null | undefined,
    precise: boolean,
  ): string {
    if (precise) {
      return this.preciseModel;
    }
    if (profileModel && this.isSelectableModel(profileModel)) {
      return this.customEndpoint
        ? profileModel.trim()
        : canonicalModelId(profileModel);
    }
    return this.defaultModel;
  }

  availableModels(): AiModelOption[] {
    const { catalog } = this.connection;
    if (catalog === null) {
      return this.customModels().map((id) => ({
        id,
        label: id,
        description:
          id === this.preciseModel
            ? 'Precise re-check model'
            : 'From your AI server',
        estCostPerRequestUsd: 0,
        recommended: id === this.defaultModel,
      }));
    }
    return selectableModels(catalog).map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      estCostPerRequestUsd: estimateTypicalCostUsd(entry.pricing),
      recommended: entry.id === this.defaultModel,
    }));
  }

  describe(
    profileModel: string | null | undefined,
    monthlyBudgetUsd: number | null,
  ): AiConfigDto {
    return {
      provider: this.provider,
      voice: this.voiceEnabled,
      customEndpoint: this.customEndpoint,
      defaultModel: this.defaultModel,
      preciseModel: this.preciseModel,
      activeModel: this.resolveModel(profileModel, false),
      reasoningEffort: this.config.ai.reasoningEffort,
      availableModels: this.availableModels(),
      monthlyBudgetUsd,
    };
  }

  private customModels(): string[] {
    return [...new Set([this.defaultModel, this.preciseModel])];
  }
}
