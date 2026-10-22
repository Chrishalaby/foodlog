import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module.js';
import { DraftsController } from './drafts.controller.js';
import { DraftsService } from './drafts.service.js';

@Module({
  imports: [PhotosModule],
  controllers: [DraftsController],
  providers: [DraftsService],
})
export class DraftsModule {}
