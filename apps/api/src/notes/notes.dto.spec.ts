import { API_LIMITS } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ENTRY_CURSOR_MAX_LENGTH } from '../entries/entry-cursor.js';
import { CreateNoteDto, NoteListQueryDto, UpdateNoteDto } from './notes.dto.js';

async function invalidFields<T extends object>(
  type: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property).sort();
}

describe('NoteListQueryDto', () => {
  it('accepts an empty query', async () => {
    await expect(invalidFields(NoteListQueryDto, {})).resolves.toEqual([]);
  });

  it('trims the search text and reads the limit from a query string', () => {
    const dto = plainToInstance(NoteListQueryDto, {
      q: '  buy mirror ',
      limit: '25',
      status: 'open',
    });

    expect(dto).toEqual({ q: 'buy mirror', limit: 25, status: 'open' });
  });

  it('limits the search text after trimming', async () => {
    await expect(
      invalidFields(NoteListQueryDto, {
        q: ` ${'x'.repeat(API_LIMITS.foodQueryMax)} `,
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(NoteListQueryDto, {
        q: 'x'.repeat(API_LIMITS.foodQueryMax + 1),
      }),
    ).resolves.toEqual(['q']);
  });

  it.each(['all', 'open', 'done'])('accepts status %s', async (status) => {
    await expect(invalidFields(NoteListQueryDto, { status })).resolves.toEqual(
      [],
    );
  });

  it.each(['closed', 'DONE', ''])('rejects status %j', async (status) => {
    await expect(invalidFields(NoteListQueryDto, { status })).resolves.toEqual([
      'status',
    ]);
  });

  it('accepts a page size from 1 to the maximum', async () => {
    await expect(
      invalidFields(NoteListQueryDto, { limit: '1' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(NoteListQueryDto, {
        limit: String(API_LIMITS.notesPageMax),
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['0'],
    [String(API_LIMITS.notesPageMax + 1)],
    ['2.5'],
    ['many'],
    [''],
  ])('rejects limit %j', async (limit) => {
    await expect(invalidFields(NoteListQueryDto, { limit })).resolves.toEqual([
      'limit',
    ]);
  });

  it('bounds the cursor length and rejects unknown fields', async () => {
    await expect(
      invalidFields(NoteListQueryDto, {
        before: 'A'.repeat(ENTRY_CURSOR_MAX_LENGTH),
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(NoteListQueryDto, {
        before: 'A'.repeat(ENTRY_CURSOR_MAX_LENGTH + 1),
        after: 'x',
      }),
    ).resolves.toEqual(['after', 'before']);
  });
});

describe('CreateNoteDto', () => {
  it('accepts a note without text so a photo can stand alone', async () => {
    await expect(invalidFields(CreateNoteDto, {})).resolves.toEqual([]);
    await expect(invalidFields(CreateNoteDto, { text: '' })).resolves.toEqual(
      [],
    );
  });

  it('trims the text and keeps the line breaks inside it', () => {
    const dto = plainToInstance(CreateNoteDto, {
      text: '  Width around 20cm\nheight around 30 cm \n',
    });

    expect(dto.text).toBe('Width around 20cm\nheight around 30 cm');
  });

  it('limits the text length after trimming', async () => {
    await expect(
      invalidFields(CreateNoteDto, {
        text: ` ${'x'.repeat(API_LIMITS.noteTextMax)} `,
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(CreateNoteDto, {
        text: 'x'.repeat(API_LIMITS.noteTextMax + 1),
      }),
    ).resolves.toEqual(['text']);
  });

  it.each([
    ['null', { text: null }],
    ['a number', { text: 42 }],
    ['a list', { text: ['Buy mirror'] }],
    ['a null character', { text: 'Buy\u0000mirror' }],
  ])('rejects %s as text', async (_label, plain) => {
    await expect(invalidFields(CreateNoteDto, plain)).resolves.toEqual([
      'text',
    ]);
  });

  it('rejects unknown fields', async () => {
    await expect(
      invalidFields(CreateNoteDto, { text: 'Buy mirror', done: true }),
    ).resolves.toEqual(['done']);
  });
});

describe('UpdateNoteDto', () => {
  it('accepts text, done or both', async () => {
    await expect(
      invalidFields(UpdateNoteDto, { text: ' Dehumidifier ' }),
    ).resolves.toEqual([]);
    await expect(invalidFields(UpdateNoteDto, { done: true })).resolves.toEqual(
      [],
    );
    await expect(
      invalidFields(UpdateNoteDto, { text: '', done: false }),
    ).resolves.toEqual([]);
    expect(
      plainToInstance(UpdateNoteDto, { text: ' Dehumidifier ' }).text,
    ).toBe('Dehumidifier');
  });

  it.each([
    ['a done flag sent as text', { done: 'true' }, ['done']],
    ['a done flag sent as a number', { done: 1 }, ['done']],
    ['a null done flag', { done: null }, ['done']],
    ['null text', { text: null }, ['text']],
    [
      'text over the limit',
      { text: 'x'.repeat(API_LIMITS.noteTextMax + 1) },
      ['text'],
    ],
    ['unknown fields', { text: 'ok', photos: [] }, ['photos']],
  ])('rejects %s', async (_label, plain, fields) => {
    await expect(invalidFields(UpdateNoteDto, plain)).resolves.toEqual(fields);
  });
});
