import type { AdminAccessRequestDto, InviteLinkResponse } from '@food/shared';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AdminOnly } from '../auth/admin-only.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AppConfig } from '../config/app-config.js';
import { appBaseUrl } from '../config/app-url.js';
import { AdminAccessRequestsQueryDto } from './admin.dto.js';
import { AdminAccessRequestsService } from './admin-access-requests.service.js';
import { RequestOrigin, type RequestOriginParts } from './admin-base-url.js';

@AdminOnly()
@Controller('admin/access-requests')
export class AdminAccessRequestsController {
  constructor(
    private readonly requests: AdminAccessRequestsService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  list(
    @Query() query: AdminAccessRequestsQueryDto,
  ): Promise<AdminAccessRequestDto[]> {
    return this.requests.list(query.status);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestOrigin() origin: RequestOriginParts,
  ): Promise<InviteLinkResponse> {
    return this.requests.approve(actor, id, appBaseUrl(this.config, origin));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminAccessRequestDto> {
    return this.requests.reject(actor, id);
  }
}
