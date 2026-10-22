import type { AdminInviteDto, InviteLinkResponse } from '@food/shared';
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
} from '@nestjs/common';
import { AdminOnly } from '../auth/admin-only.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AppConfig } from '../config/app-config.js';
import { appBaseUrl } from '../config/app-url.js';
import { CreateInviteDto } from './admin.dto.js';
import { RequestOrigin, type RequestOriginParts } from './admin-base-url.js';
import { AdminInvitesService } from './admin-invites.service.js';

@AdminOnly()
@Controller('admin/invites')
export class AdminInvitesController {
  constructor(
    private readonly invites: AdminInvitesService,
    private readonly config: AppConfig,
  ) {}

  @Get()
  list(): Promise<AdminInviteDto[]> {
    return this.invites.list();
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body() body: CreateInviteDto,
    @RequestOrigin() origin: RequestOriginParts,
  ): Promise<InviteLinkResponse> {
    return this.invites.create(actor, body, appBaseUrl(this.config, origin));
  }

  @Post(':id/regenerate')
  @HttpCode(HttpStatus.OK)
  regenerate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestOrigin() origin: RequestOriginParts,
  ): Promise<InviteLinkResponse> {
    return this.invites.regenerate(actor, id, appBaseUrl(this.config, origin));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.invites.revoke(id);
  }
}
