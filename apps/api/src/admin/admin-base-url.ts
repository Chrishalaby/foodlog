import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type RequestOriginParts = Pick<Request, 'protocol' | 'host'>;

export const RequestOrigin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestOriginParts => {
    const request = context.switchToHttp().getRequest<Request>();
    return { protocol: request.protocol, host: request.host };
  },
);
