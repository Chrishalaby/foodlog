import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module.js';
import { EntriesController } from './entries.controller.js';
import { EntriesService } from './entries.service.js';

@Module({
  imports: [PhotosModule],
  controllers: [EntriesController],
  providers: [EntriesService],
  exports: [EntriesService],
})
export class EntriesModule {}
