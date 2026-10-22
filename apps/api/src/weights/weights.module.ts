import { Module } from '@nestjs/common';
import { WeightsController } from './weights.controller.js';
import { WeightsService } from './weights.service.js';

@Module({
  controllers: [WeightsController],
  providers: [WeightsService],
  exports: [WeightsService],
})
export class WeightsModule {}
