import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { DaySummariesService } from './day-summaries.service.js';

@Module({
  imports: [ProfileModule],
  controllers: [DashboardController],
  providers: [DashboardService, DaySummariesService],
  exports: [DaySummariesService],
})
export class DashboardModule {}
