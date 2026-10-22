import { API_LIMITS, type DraftDto, type EntryDto } from '@food/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import {
  type AnalyzeUploadFiles,
  collectAnalyzeUploads,
} from '../ai/analyze-uploads.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreateDraftDto, LogDraftDto, UpdateDraftDto } from './drafts.dto.js';
import { DraftsService } from './drafts.service.js';

const MAX_FORM_FIELDS = 16;
const MAX_FORM_FIELD_BYTES = 64 * 1024;

export const DRAFT_UPLOAD_THROTTLE = {
  long: { limit: 30, ttl: 60_000 },
} as const;

@Controller('drafts')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<DraftDto[]> {
    return this.drafts.list(user.id);
  }

  @Post()
  @Throttle(DRAFT_UPLOAD_THROTTLE)
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'images', maxCount: API_LIMITS.analyzeImagesMax }],
      {
        limits: {
          fileSize: API_LIMITS.imageMaxBytes,
          files: API_LIMITS.analyzeImagesMax,
          fields: MAX_FORM_FIELDS,
          fieldSize: MAX_FORM_FIELD_BYTES,
          parts: MAX_FORM_FIELDS + API_LIMITS.analyzeImagesMax,
        },
      },
    ),
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateDraftDto,
    @UploadedFiles() files?: AnalyzeUploadFiles,
  ): Promise<DraftDto> {
    return this.drafts.create(
      user.id,
      body,
      collectAnalyzeUploads(files, body.imageRoles),
    );
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDraftDto,
  ): Promise<DraftDto> {
    return this.drafts.update(user.id, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.drafts.remove(user.id, id);
  }

  @Post(':id/log')
  log(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LogDraftDto,
  ): Promise<EntryDto> {
    return this.drafts.log(user.id, id, body);
  }
}
