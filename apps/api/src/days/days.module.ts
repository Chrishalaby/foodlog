import { Module } from '@nestjs/common';
import { DaysController } from './days.controller.js';
import { DaysService } from './days.service.js';

@Module({
  controllers: [DaysController],
  providers: [DaysService],
  exports: [DaysService],
})
export class DaysModule {}
