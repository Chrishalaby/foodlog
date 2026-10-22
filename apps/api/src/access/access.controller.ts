import type {
  AccessRequestStatusResponse,
  CreateAccessRequestResponse,
  UserDto,
} from '@food/shared';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AUTH_ATTEMPTS_THROTTLE } from '../auth/auth.constants.js';
import { Public } from '../auth/public.decorator.js';
import {
  readSessionToken,
  readUserAgent,
  SessionCookies,
} from '../auth/session-cookies.js';
import { SessionsService } from '../auth/sessions.service.js';
import {
  AcceptAccessRequestDto,
  AccessRequestStatusDto,
  CreateAccessRequestDto,
} from './access.dto.js';
import { AccessService } from './access.service.js';

const HOUR_MS = 3_600_000;
export const ACCESS_REQUESTS_PER_HOUR = 5;

@Controller('access-requests')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly sessions: SessionsService,
    private readonly cookies: SessionCookies,
  ) {}

  @Public()
  @Throttle({ long: { limit: ACCESS_REQUESTS_PER_HOUR, ttl: HOUR_MS } })
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() body: CreateAccessRequestDto,
  ): Promise<CreateAccessRequestResponse> {
    return this.access.create(body);
  }

  @Public()
  @Post('status')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  status(
    @Body() body: AccessRequestStatusDto,
  ): Promise<AccessRequestStatusResponse> {
    return this.access.status(body.statusToken);
  }

  @Public()
  @Throttle(AUTH_ATTEMPTS_THROTTLE)
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body() body: AcceptAccessRequestDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDto> {
    const result = await this.access.accept(body, readUserAgent(request));
    await this.sessions.revokeToken(readSessionToken(request));
    this.cookies.set(response, result.token);
    return result.user;
  }
}
