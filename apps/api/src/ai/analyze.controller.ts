import { type AnalyzeResponse, API_LIMITS } from '@food/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AiThrottlerGuard } from '../common/throttling.js';
import { AnalyzeRequestDto } from './analyze.dto.js';
import { AnalyzeService } from './analyze.service.js';
import {
  type AnalyzeUploadFiles,
  collectAnalyzeUploads,
} from './analyze-uploads.js';

const MAX_FORM_FIELDS = 16;
const MAX_FORM_FIELD_BYTES = 16 * 1024;

@Controller('analyze')
export class AnalyzeController {
  constructor(private readonly analyzer: AnalyzeService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AiThrottlerGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'image', maxCount: 1 },
        { name: 'images', maxCount: API_LIMITS.analyzeImagesMax },
      ],
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
  analyze(
    @CurrentUser() user: AuthUser,
    @Body() body: AnalyzeRequestDto,
    @UploadedFiles() files?: AnalyzeUploadFiles,
  ): Promise<AnalyzeResponse> {
    return this.analyzer.analyze(
      user.id,
      body,
      collectAnalyzeUploads(files, body.imageRoles),
    );
  }
}
