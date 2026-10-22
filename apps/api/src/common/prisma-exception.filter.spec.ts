import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { toHttpException } from './prisma-exception.filter.js';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe('toHttpException', () => {
  it('maps a missing record to 404', () => {
    expect(toHttpException(prismaError('P2025'))).toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps a unique constraint violation to 409', () => {
    expect(toHttpException(prismaError('P2002'))).toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps foreign key violations to 409', () => {
    expect(toHttpException(prismaError('P2003'))?.getStatus()).toBe(409);
  });

  it('leaves other errors untouched', () => {
    expect(toHttpException(prismaError('P2034'))).toBeNull();
  });
});
