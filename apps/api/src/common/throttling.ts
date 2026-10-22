import { type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerStorage,
  SkipThrottle,
  ThrottlerGuard,
  type ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { LOGIN_ACCOUNT_THROTTLER } from '../auth/auth.constants.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { aiRateLimits } from '../config/rate-limits.js';
import type { AiRateLimits } from '../config/settings.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const APP_THROTTLERS = [
  { name: 'short', ttl: 1_000, limit: 20 },
  { name: 'long', ttl: 60_000, limit: 600 },
] as const satisfies readonly ThrottlerOptions[];

export type ThrottlerName = (typeof APP_THROTTLERS)[number]['name'];

export function SkipAllThrottlers(): MethodDecorator & ClassDecorator {
  const skip: Record<ThrottlerName, true> = { short: true, long: true };
  return SkipThrottle(skip);
}

export function SkipBurstThrottler(): MethodDecorator & ClassDecorator {
  const skip: Partial<Record<ThrottlerName, true>> = { short: true };
  return SkipThrottle(skip);
}

export function aiThrottlers(limits: AiRateLimits): ThrottlerOptions[] {
  return [
    { name: 'aiMinute', ttl: MINUTE_MS, limit: limits.perMinute },
    { name: 'aiHour', ttl: HOUR_MS, limit: limits.perHour },
  ];
}

export function userTrackerKey(
  request: Pick<AuthenticatedRequest, 'user'>,
  ipTracker: string,
): string {
  const userId = request.user?.id;
  return userId ? `user:${userId}` : `ip:${ipTracker}`;
}

export function aiThrottleKey(throttlerName: string, tracker: string): string {
  return `ai:${throttlerName}:${tracker}`;
}

@Injectable()
export class AiThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super({ throttlers: aiThrottlers(aiRateLimits()) }, storage, reflector);
  }

  protected override async getTracker(
    request: Record<string, unknown>,
  ): Promise<string> {
    return userTrackerKey(
      request as Pick<AuthenticatedRequest, 'user'>,
      await super.getTracker(request),
    );
  }

  protected override generateKey(
    _context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    return aiThrottleKey(name, suffix);
  }
}

export const VOICE_RATE_LIMIT_FACTOR = 2;

export function voiceThrottlers(limits: AiRateLimits): ThrottlerOptions[] {
  return [
    {
      name: 'voiceMinute',
      ttl: MINUTE_MS,
      limit: limits.perMinute * VOICE_RATE_LIMIT_FACTOR,
    },
    {
      name: 'voiceHour',
      ttl: HOUR_MS,
      limit: limits.perHour * VOICE_RATE_LIMIT_FACTOR,
    },
  ];
}

export function voiceThrottleKey(
  throttlerName: string,
  tracker: string,
): string {
  return `voice:${throttlerName}:${tracker}`;
}

@Injectable()
export class VoiceThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super({ throttlers: voiceThrottlers(aiRateLimits()) }, storage, reflector);
  }

  protected override async getTracker(
    request: Record<string, unknown>,
  ): Promise<string> {
    return userTrackerKey(
      request as Pick<AuthenticatedRequest, 'user'>,
      await super.getTracker(request),
    );
  }

  protected override generateKey(
    _context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    return voiceThrottleKey(name, suffix);
  }
}

export function loginAccountTrackerKey(
  body: unknown,
  ipTracker: string,
): string {
  const email =
    typeof body === 'object' && body !== null
      ? (body as { email?: unknown }).email
      : undefined;
  const normalized =
    typeof email === 'string' ? email.trim().toLowerCase() : '';
  return normalized === '' ? `ip:${ipTracker}` : `email:${normalized}`;
}

@Injectable()
export class LoginAccountThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    @Inject(Reflector) reflector: Reflector,
  ) {
    super({ throttlers: [LOGIN_ACCOUNT_THROTTLER] }, storage, reflector);
  }

  protected override async getTracker(
    request: Record<string, unknown>,
  ): Promise<string> {
    return loginAccountTrackerKey(
      request.body,
      await super.getTracker(request),
    );
  }
}
