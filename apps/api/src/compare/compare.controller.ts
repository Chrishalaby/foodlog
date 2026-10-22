import { API_LIMITS, type MenuScanResponse } from '@food/shared';
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
import { FilesInterceptor } from '@nestjs/platform-express';
import type { UploadedFile } from '../ai/analyze-uploads.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AiThrottlerGuard } from '../common/throttling.js';
import { MenuScanDto } from './compare.dto.js';
import { CompareService } from './compare.service.js';
import {
  collectMenuImages,
  MENU_IMAGES_FIELD,
  MENU_IMAGES_MAX,
} from './menu-uploads.js';

const MAX_FORM_FIELDS = 8;
const MAX_FORM_FIELD_BYTES = 16 * 1024;

@Controller('compare')
export class CompareController {
  constructor(private readonly compare: CompareService) {}

  @Post('menu')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AiThrottlerGuard)
  @UseInterceptors(
    FilesInterceptor(MENU_IMAGES_FIELD, MENU_IMAGES_MAX, {
      limits: {
        fileSize: API_LIMITS.imageMaxBytes,
        files: MENU_IMAGES_MAX,
        fields: MAX_FORM_FIELDS,
        fieldSize: MAX_FORM_FIELD_BYTES,
        parts: MAX_FORM_FIELDS + MENU_IMAGES_MAX,
      },
    }),
  )
  scanMenu(
    @CurrentUser() user: AuthUser,
    @Body() body: MenuScanDto,
    @UploadedFiles() files?: UploadedFile[],
  ): Promise<MenuScanResponse> {
    return this.compare.scanMenu(user.id, body, collectMenuImages(files));
  }
}
