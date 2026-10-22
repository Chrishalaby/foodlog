import type { UserDto } from '@food/shared';
import type { Request } from 'express';

export interface AuthUser extends UserDto {
  sessionId: string;
}

export interface SessionClaims {
  userId: string;
  sessionId: string;
  issuedAt: number;
}

export interface SessionResult {
  user: UserDto;
  token: string;
}

export interface AuthenticatedSession {
  user: AuthUser;
  renewedToken: string | null;
}

export type AuthenticatedRequest = Request & { user?: AuthUser };
