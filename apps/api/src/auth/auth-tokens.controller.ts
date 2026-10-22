import type { AuthTokenInfoResponse, UserDto } from '@food/shared';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AUTH_ATTEMPTS_THROTTLE } from './auth.constants.js';
import { AcceptAuthTokenDto } from './auth.dto.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { Public } from './public.decorator.js';
import {
  readSessionToken,
  readUserAgent,
  SessionCookies,
} from './session-cookies.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth/tokens')
export class AuthTokensController {
  constructor(
    private readonly tokens: AuthTokensService,
    private readonly sessions: SessionsService,
    private readonly cookies: SessionCookies,
  ) {}

  @Public()
  @Get(':token')
  @Header('Cache-Control', 'no-store')
  info(@Param('token') token: string): Promise<AuthTokenInfoResponse> {
    return this.tokens.info(token);
  }

  @Public()
  @Throttle(AUTH_ATTEMPTS_THROTTLE)
  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('token') token: string,
    @Body() body: AcceptAuthTokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDto> {
    const result = await this.tokens.accept(
      token,
      body,
      readUserAgent(request),
    );
    await this.sessions.revokeToken(readSessionToken(request));
    this.cookies.set(response, result.token);
    return result.user;
  }
}
