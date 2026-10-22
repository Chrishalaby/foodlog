import { Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { AppConfig } from '../config/app-config.js';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_PATH,
  SESSION_MAX_AGE_MS,
} from './auth.constants.js';

export function readSessionToken(request: Request): string | null {
  const cookies: Record<string, unknown> | undefined = request.cookies;
  const token = cookies?.[SESSION_COOKIE];
  return typeof token === 'string' && token !== '' ? token : null;
}

export function readUserAgent(request: Request): string | null {
  return request.get('user-agent') ?? null;
}

@Injectable()
export class SessionCookies {
  constructor(private readonly config: AppConfig) {}

  set(response: Response, token: string): void {
    response.cookie(SESSION_COOKIE, token, {
      ...this.baseOptions(),
      maxAge: SESSION_MAX_AGE_MS,
    });
  }

  clear(response: Response): void {
    response.clearCookie(SESSION_COOKIE, this.baseOptions());
  }

  private baseOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'strict',
      path: SESSION_COOKIE_PATH,
      secure: this.config.cookieSecure,
    };
  }
}
