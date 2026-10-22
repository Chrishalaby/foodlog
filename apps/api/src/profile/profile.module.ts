import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({
  imports: [AiModule, UsageModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
