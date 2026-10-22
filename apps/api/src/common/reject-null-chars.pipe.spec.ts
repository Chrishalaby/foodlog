import { BadRequestException } from '@nestjs/common';
import {
  containsNullChar,
  RejectNullCharsPipe,
} from './reject-null-chars.pipe.js';

describe('RejectNullCharsPipe', () => {
  const pipe = new RejectNullCharsPipe();

  it('finds null characters in nested values', () => {
    expect(containsNullChar({ a: [{ b: 'x\u0000y' }] })).toBe(true);
    expect(containsNullChar({ a: ['ok', 1, null] })).toBe(false);
  });

  it('rejects bodies and queries with null characters', () => {
    expect(() => pipe.transform({ name: 'a\u0000' }, { type: 'body' })).toThrow(
      BadRequestException,
    );
    expect(() => pipe.transform('q\u0000', { type: 'query' })).toThrow(
      BadRequestException,
    );
    expect(pipe.transform({ name: 'ok' }, { type: 'body' })).toEqual({
      name: 'ok',
    });
  });

  it('ignores custom decorator values', () => {
    const user = { id: '1', email: 'x\u0000' };
    expect(pipe.transform(user, { type: 'custom' })).toBe(user);
  });
});
