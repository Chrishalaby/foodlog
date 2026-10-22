import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DemoCleanupService } from './demo-cleanup.service.js';
import { DemoController } from './demo.controller.js';
import { DemoService } from './demo.service.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [DemoController],
  providers: [DemoService, DemoCleanupService],
  exports: [DemoService, DemoCleanupService],
})
export class DemoModule {}
