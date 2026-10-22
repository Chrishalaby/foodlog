import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SessionClaims } from './auth.types.js';

interface SessionPayload {
  sub: string;
  sid: string;
  iat?: number;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { sub, sid, iat } = value as Record<string, unknown>;
  return (
    typeof sub === 'string' &&
    sub !== '' &&
    typeof sid === 'string' &&
    sid !== '' &&
    (iat === undefined || (typeof iat === 'number' && Number.isFinite(iat)))
  );
}

@Injectable()
export class SessionTokens {
  constructor(private readonly jwt: JwtService) {}

  sign(userId: string, sessionId: string): Promise<string> {
    const payload: SessionPayload = { sub: userId, sid: sessionId };
    return this.jwt.signAsync(payload);
  }

  async verify(token: unknown): Promise<SessionClaims | null> {
    if (typeof token !== 'string' || token === '') {
      return null;
    }
    try {
      const payload: unknown = await this.jwt.verifyAsync(token);
      if (!isSessionPayload(payload)) {
        return null;
      }
      return {
        userId: payload.sub,
        sessionId: payload.sid,
        issuedAt: (payload.iat ?? 0) * 1000,
      };
    } catch {
      return null;
    }
  }
}
