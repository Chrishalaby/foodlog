import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module.js';
import { PhotoCleanupService } from './photo-cleanup.service.js';
import { PhotosController } from './photos.controller.js';
import { PhotosService } from './photos.service.js';

@Module({
  imports: [StorageModule],
  controllers: [PhotosController],
  providers: [PhotosService, PhotoCleanupService],
  exports: [PhotosService, PhotoCleanupService],
})
export class PhotosModule {}
