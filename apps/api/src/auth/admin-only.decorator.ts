import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only admins can do this');
    }
    return true;
  }
}

export function AdminOnly(): ClassDecorator & MethodDecorator {
  return UseGuards(AdminGuard);
}
