import type { AuthStatusResponse, SessionDto, UserDto } from '@food/shared';
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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LoginAccountThrottlerGuard } from '../common/throttling.js';
import { AUTH_ATTEMPTS_THROTTLE } from './auth.constants.js';
import {
  ChangePasswordDto,
  LoginDto,
  SetupDto,
  UpdateAccountDto,
} from './auth.dto.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import {
  readSessionToken,
  readUserAgent,
  SessionCookies,
} from './session-cookies.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly cookies: SessionCookies,
  ) {}

  @Public()
  @Get('status')
  async status(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthStatusResponse> {
    const token = readSessionToken(request);
    const { status, renewedToken } = await this.auth.status(token);
    if (renewedToken) {
      this.cookies.set(response, renewedToken);
    } else if (token !== null && !status.authenticated) {
      this.cookies.clear(response);
    }
    return status;
  }

  @Public()
  @Throttle(AUTH_ATTEMPTS_THROTTLE)
  @Post('setup')
  async setup(
    @Body() body: SetupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDto> {
    const { user, token } = await this.auth.setup(body, readUserAgent(request));
    this.cookies.set(response, token);
    return user;
  }

  @Public()
  @Throttle(AUTH_ATTEMPTS_THROTTLE)
  @UseGuards(LoginAccountThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDto> {
    const { user, token } = await this.auth.login(body, readUserAgent(request));
    await this.sessions.revokeToken(readSessionToken(request));
    this.cookies.set(response, token);
    return user;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeToken(readSessionToken(request));
    this.cookies.clear(response);
  }

  @Throttle(AUTH_ATTEMPTS_THROTTLE)
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(user, body);
  }

  @Get('sessions')
  listSessions(@CurrentUser() user: AuthUser): Promise<SessionDto[]> {
    return this.sessions.list(user.id, user.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revokeOwn(user.id, id);
    if (id === user.sessionId) {
      this.cookies.clear(response);
    }
  }

  @Put('account')
  updateAccount(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateAccountDto,
  ): Promise<UserDto> {
    return this.auth.updateAccount(user, body);
  }
}
