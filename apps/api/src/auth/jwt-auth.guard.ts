import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './auth.types.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { readSessionToken, SessionCookies } from './session-cookies.js';
import { SessionsService } from './sessions.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
    private readonly cookies: SessionCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const session = await this.sessions.authenticate(readSessionToken(request));
    if (!session) {
      throw new UnauthorizedException();
    }
    request.user = session.user;
    if (session.renewedToken) {
      this.cookies.set(http.getResponse<Response>(), session.renewedToken);
    }
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }
}
