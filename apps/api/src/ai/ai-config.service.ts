import type { AiConfigDto, AiModelOption } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import {
  canonicalModelId,
  estimateTypicalCostUsd,
  isSelectableModel,
  MODEL_CATALOG,
} from './models.js';

@Injectable()
export class AiConfigService {
  constructor(private readonly config: AppConfig) {}

  get provider(): AiConfigDto['provider'] {
    if (this.config.ai.provider === 'mock') {
      return 'mock';
    }
    return this.config.ai.apiKey ? 'openai' : 'unconfigured';
  }

  get customEndpoint(): boolean {
    return this.config.ai.baseUrl !== null;
  }

  get voiceEnabled(): boolean {
    if (this.provider === 'mock') {
      return true;
    }
    const { ai } = this.config;
    return ai.voiceEnabled && Boolean(ai.transcribeApiKey ?? ai.apiKey);
  }

  get defaultModel(): string {
    return canonicalModelId(this.config.ai.model);
  }

  get preciseModel(): string {
    return canonicalModelId(this.config.ai.preciseModel);
  }

  isSelectableModel(model: string): boolean {
    return this.customEndpoint
      ? this.customModels().includes(model.trim())
      : isSelectableModel(model);
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
    if (this.customEndpoint) {
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
    return MODEL_CATALOG.filter((entry) => entry.selectable).map((entry) => ({
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
