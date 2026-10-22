import { Injectable } from '@nestjs/common';
import { AiProviderSettingsService } from '../ai/ai-provider-settings.service.js';
import type { RuntimeAiSettings } from '../ai/ai-runtime-settings.js';
import { AppConfig } from '../config/app-config.js';
import type {
  VoiceAiProvider,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from './voice-provider.js';
import { createVoiceProvider } from './voice-provider.factory.js';

@Injectable()
export class RuntimeVoiceProvider implements VoiceAiProvider {
  private built: {
    settings: RuntimeAiSettings;
    provider: VoiceAiProvider;
  } | null = null;

  constructor(
    private readonly settings: AiProviderSettingsService,
    private readonly config: AppConfig,
  ) {}

  get name(): VoiceAiProvider['name'] {
    return this.current().name;
  }

  transcribe(request: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
    return this.current().transcribe(request);
  }

  private current(): VoiceAiProvider {
    const settings = this.settings.snapshot();
    if (this.built?.settings !== settings) {
      this.built = {
        settings,
        provider: createVoiceProvider(settings, this.config),
      };
    }
    return this.built.provider;
  }
}
