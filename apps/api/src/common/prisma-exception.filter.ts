import {
  type ArgumentsHost,
  Catch,
  ConflictException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '../generated/prisma/client.js';

export function toHttpException(
  error: Prisma.PrismaClientKnownRequestError,
): HttpException | null {
  switch (error.code) {
    case 'P2025':
      return new NotFoundException();
    case 'P2002':
      return new ConflictException('A record with these values already exists');
    case 'P2003':
      return new ConflictException('A referenced record no longer exists');
    default:
      return null;
  }
}

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  override catch(
    exception: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    super.catch(toHttpException(exception) ?? exception, host);
  }
}
