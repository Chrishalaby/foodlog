import type {
  AdminOverviewResponse,
  AdminUserDto,
  InviteLinkResponse,
} from '@food/shared';
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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminOnly } from '../auth/admin-only.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionCookies } from '../auth/session-cookies.js';
import { AppConfig } from '../config/app-config.js';
import { appBaseUrl } from '../config/app-url.js';
import { UpdateAdminUserDto } from './admin.dto.js';
import { RequestOrigin, type RequestOriginParts } from './admin-base-url.js';
import { AdminOverviewService } from './admin-overview.service.js';
import { AdminUsersService } from './admin-users.service.js';

@AdminOnly()
@Controller('admin')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly overviews: AdminOverviewService,
    private readonly cookies: SessionCookies,
    private readonly config: AppConfig,
  ) {}

  @Get('overview')
  overview(): Promise<AdminOverviewResponse> {
    return this.overviews.overview();
  }

  @Get('users')
  list(@CurrentUser() actor: AuthUser): Promise<AdminUserDto[]> {
    return this.users.list(actor);
  }

  @Patch('users/:id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminUserDto,
  ): Promise<AdminUserDto> {
    return this.users.update(actor, id, body);
  }

  @Post('users/:id/reset-link')
  @HttpCode(HttpStatus.OK)
  resetLink(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @RequestOrigin() origin: RequestOriginParts,
  ): Promise<InviteLinkResponse> {
    return this.users.resetLink(actor, id, appBaseUrl(this.config, origin));
  }

  @Post('users/:id/revoke-sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSessions(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.users.revokeSessions(id);
    if (id === actor.id) {
      this.cookies.clear(response);
    }
  }

  @Delete('users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.users.remove(actor, id);
  }
}
