import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { WeightsModule } from '../weights/weights.module.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';

@Module({
  imports: [DashboardModule, ProfileModule, WeightsModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
