import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PhotosModule } from '../photos/photos.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { AiConfigService } from './ai-config.service.js';
import { AiUsageRecorder } from './ai-usage.recorder.js';
import { AnalyzeController } from './analyze.controller.js';
import { AnalyzeService } from './analyze.service.js';
import { AI_PROVIDER } from './providers/ai-provider.js';
import { createAiProvider } from './providers/provider.factory.js';

@Module({
  imports: [PhotosModule, UsageModule],
  controllers: [AnalyzeController],
  providers: [
    AiConfigService,
    AiUsageRecorder,
    AnalyzeService,
    {
      provide: AI_PROVIDER,
      inject: [AppConfig],
      useFactory: createAiProvider,
    },
  ],
  exports: [AiConfigService, AiUsageRecorder],
})
export class AiModule {}
