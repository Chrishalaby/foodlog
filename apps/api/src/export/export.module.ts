import { Module } from '@nestjs/common';
import { ProfileModule } from '../profile/profile.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';

@Module({
  imports: [ProfileModule],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
