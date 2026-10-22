import { Module } from '@nestjs/common';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';

@Module({
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
