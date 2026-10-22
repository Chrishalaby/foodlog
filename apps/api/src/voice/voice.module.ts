import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { RuntimeVoiceProvider } from './runtime-voice-provider.js';
import { VoiceController } from './voice.controller.js';
import { VOICE_AI_PROVIDER } from './voice-provider.js';
import { VoiceService } from './voice.service.js';

@Module({
  imports: [AiModule, UsageModule],
  controllers: [VoiceController],
  providers: [
    VoiceService,
    RuntimeVoiceProvider,
    { provide: VOICE_AI_PROVIDER, useExisting: RuntimeVoiceProvider },
  ],
})
export class VoiceModule {}
