import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { AppConfig } from '../config/app-config.js';
import { UsageModule } from '../usage/usage.module.js';
import { VoiceController } from './voice.controller.js';
import { VOICE_AI_PROVIDER } from './voice-provider.js';
import { createVoiceProvider } from './voice-provider.factory.js';
import { VoiceService } from './voice.service.js';

@Module({
  imports: [AiModule, UsageModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    {
      provide: VOICE_AI_PROVIDER,
      inject: [AppConfig],
      useFactory: createVoiceProvider,
    },
  ],
})
export class VoiceModule {}
