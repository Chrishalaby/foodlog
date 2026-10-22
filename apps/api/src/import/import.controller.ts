import type { ImportBatchResponse } from '@food/shared';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ImportBatchDto } from './import.dto.js';
import { ImportService } from './import.service.js';

@Controller('import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  importBatch(
    @CurrentUser() user: AuthUser,
    @Body() body: ImportBatchDto,
  ): Promise<ImportBatchResponse> {
    return this.imports.importBatch(user.id, body);
  }
}
