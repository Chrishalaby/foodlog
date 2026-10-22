import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { translateClientErrors } from './common/client-errors.middleware.js';
import { rejectCrossSiteWrites } from './common/cross-site-guard.middleware.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { securityHeaders } from './common/security-headers.middleware.js';
import { RejectNullCharsPipe } from './common/reject-null-chars.pipe.js';

export const API_PREFIX = 'api';
export const JSON_BODY_LIMIT = '1mb';

export function configureApp<T extends NestExpressApplication>(app: T): T {
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.use(securityHeaders);
  app.use(rejectCrossSiteWrites);
  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.use(translateClientErrors);
  app.useGlobalPipes(
    new RejectNullCharsPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter(app.getHttpAdapter()));
  app.enableShutdownHooks([], { useProcessExit: true });
  return app;
}
