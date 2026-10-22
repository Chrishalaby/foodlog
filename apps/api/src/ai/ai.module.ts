import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module.js';
import { SecretsModule } from '../secrets/secrets.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AiConfigService } from './ai-config.service.js';
import { AiProviderSettingsController } from './ai-provider-settings.controller.js';
import { AiProviderSettingsService } from './ai-provider-settings.service.js';
import { AiUsageRecorder } from './ai-usage.recorder.js';
import { AnalyzeController } from './analyze.controller.js';
import { AnalyzeService } from './analyze.service.js';
import { AI_PROVIDER } from './providers/ai-provider.js';
import { RuntimeAiProvider } from './providers/runtime-ai-provider.js';

@Module({
  imports: [PhotosModule, UsageModule, SecretsModule],
  controllers: [AnalyzeController, AiProviderSettingsController],
  providers: [
    AiConfigService,
    AiProviderSettingsService,
    AiUsageRecorder,
    AnalyzeService,
    RuntimeAiProvider,
    { provide: AI_PROVIDER, useExisting: RuntimeAiProvider },
  ],
  exports: [
    AiConfigService,
    AiProviderSettingsService,
    AiUsageRecorder,
    RuntimeAiProvider,
  ],
})
export class AiModule {}
