import { Module } from '@nestjs/common';
import { PhotosModule } from '../photos/photos.module.js';
import { NotesController } from './notes.controller.js';
import { NotesService } from './notes.service.js';

@Module({
  imports: [PhotosModule],
  controllers: [NotesController],
  providers: [NotesService],
})
export class NotesModule {}
