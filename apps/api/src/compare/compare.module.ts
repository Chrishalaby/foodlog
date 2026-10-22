import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { MENU_AI_PROVIDER } from '../ai/providers/ai-provider.js';
import { createAiProvider } from '../ai/providers/provider.factory.js';
import { AppConfig } from '../config/app-config.js';
import { UsageModule } from '../usage/usage.module.js';
import { CompareController } from './compare.controller.js';
import { CompareService } from './compare.service.js';

@Module({
  imports: [AiModule, UsageModule],
  controllers: [CompareController],
  providers: [
    CompareService,
    {
      provide: MENU_AI_PROVIDER,
      inject: [AppConfig],
      useFactory: createAiProvider,
    },
  ],
})
export class CompareModule {}
