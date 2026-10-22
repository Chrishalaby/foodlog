import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from '../auth/admin-only.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { AdminAccessRequestsController } from './admin-access-requests.controller.js';
import { AdminInvitesController } from './admin-invites.controller.js';
import { AdminUsersController } from './admin-users.controller.js';

function contextFor(user: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function userWithRole(role: AuthUser['role']): AuthUser {
  return {
    id: 'user-1',
    email: 'a@example.com',
    name: null,
    role,
    sessionId: 'session-1',
  };
}

describe('admin access control', () => {
  it.each([
    AdminUsersController,
    AdminAccessRequestsController,
    AdminInvitesController,
  ])('guards every route of %o under /admin', (controller) => {
    expect(String(Reflect.getMetadata(PATH_METADATA, controller))).toMatch(
      /^admin(\/|$)/,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(
      AdminGuard,
    );
  });

  it('lets admins through and refuses members and anonymous callers', () => {
    const guard = new AdminGuard();

    expect(guard.canActivate(contextFor(userWithRole('admin')))).toBe(true);
    expect(() => guard.canActivate(contextFor(userWithRole('member')))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
