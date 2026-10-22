import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ExportQueryDto } from './export.dto.js';
import { ExportService } from './export.service.js';

export const DEFAULT_EXPORT_FORMAT = 'json';

@Controller('export')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get()
  async download(
    @CurrentUser() user: AuthUser,
    @Query() query: ExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.exports.export(
      user.id,
      query.format ?? DEFAULT_EXPORT_FORMAT,
    );
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
}
