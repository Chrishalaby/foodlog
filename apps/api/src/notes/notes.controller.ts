import { API_LIMITS, type NoteDto, type NoteListResponse } from '@food/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { collectNoteUploads, type NoteUploadFiles } from './note-uploads.js';
import { CreateNoteDto, NoteListQueryDto, UpdateNoteDto } from './notes.dto.js';
import { NotesEnabledGuard } from './notes-enabled.guard.js';
import { NotesService } from './notes.service.js';

const MAX_FORM_FIELDS = 4;
const MAX_FORM_FIELD_BYTES = 64 * 1024;

export const NOTE_CREATE_THROTTLE = {
  long: { limit: 60, ttl: 60_000 },
} as const;

@UseGuards(NotesEnabledGuard)
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: NoteListQueryDto,
  ): Promise<NoteListResponse> {
    return this.notes.list(user.id, query);
  }

  @Post()
  @Throttle(NOTE_CREATE_THROTTLE)
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'images', maxCount: API_LIMITS.notePhotosMax }],
      {
        limits: {
          fileSize: API_LIMITS.imageMaxBytes,
          files: API_LIMITS.notePhotosMax,
          fields: MAX_FORM_FIELDS,
          fieldSize: MAX_FORM_FIELD_BYTES,
          parts: MAX_FORM_FIELDS + API_LIMITS.notePhotosMax,
        },
      },
    ),
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateNoteDto,
    @UploadedFiles() files?: NoteUploadFiles,
  ): Promise<NoteDto> {
    return this.notes.create(user.id, body, collectNoteUploads(files));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateNoteDto,
  ): Promise<NoteDto> {
    return this.notes.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notes.remove(user.id, id);
  }
}
