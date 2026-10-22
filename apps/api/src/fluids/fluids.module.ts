import { Module } from '@nestjs/common';
import { DaysModule } from '../days/days.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { FluidsController } from './fluids.controller.js';
import { FluidsService } from './fluids.service.js';

@Module({
  imports: [ProfileModule, DaysModule],
  controllers: [FluidsController],
  providers: [FluidsService],
})
export class FluidsModule {}
