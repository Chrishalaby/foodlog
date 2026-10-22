import { API_LIMITS } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnalyzeRequestDto, isLocalTime } from './analyze.dto.js';

async function invalidFields(plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(AnalyzeRequestDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property).sort();
}

describe('isLocalTime', () => {
  it('accepts real local date-times without seconds or offset', () => {
    expect(isLocalTime('2026-09-28T13:05')).toBe(true);
    expect(isLocalTime('2024-02-29T00:00')).toBe(true);
  });

  it.each([
    '2026-09-28',
    '2026-09-28T24:00',
    '2026-09-28T12:60',
    '2026-02-30T12:00',
    '2026-09-28T12:00:00',
    '2026-09-28T12:00Z',
    42,
  ])('rejects %s', (value) => {
    expect(isLocalTime(value)).toBe(false);
  });
});

describe('AnalyzeRequestDto', () => {
  it('accepts the full multipart field set as strings', async () => {
    await expect(
      invalidFields({
        mode: 'food_photo',
        description: ' 2 eggs ',
        detail: 'low',
        precise: 'true',
        previousAnalysisId: '0199a0b6-3c1e-7d2f-8a4b-5c6d7e8f9a0b',
        followUpAnswer: 'fried',
        followUpKind: 'correction',
        localTime: '2026-09-28T08:15',
        mealType: 'breakfast',
        imageRoles: 'food,label',
        draftId: '0199a0b6-3c1e-7d2f-8a4b-5c6d7e8f9a0c',
        split: 'true',
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields({ mode: 'text', description: 'soup', split: 'yes' }),
    ).resolves.toEqual(['split']);
    const dto = plainToInstance(AnalyzeRequestDto, {
      mode: 'text',
      description: '  soup ',
    });
    expect(dto.description).toBe('soup');
  });

  it('rejects invalid values and unknown fields', async () => {
    await expect(
      invalidFields({
        mode: 'photo',
        description: 'x'.repeat(API_LIMITS.descriptionMax + 1),
        detail: 'auto',
        precise: 'yes',
        previousAnalysisId: 'not-a-uuid',
        followUpAnswer: 'y'.repeat(API_LIMITS.followUpAnswerMax + 1),
        followUpKind: 'question',
        localTime: '08:15',
        mealType: 'brunch',
        imageRoles: 'food,drink',
        draftId: 'draft-1',
        extra: 'field',
      }),
    ).resolves.toEqual([
      'description',
      'detail',
      'draftId',
      'extra',
      'followUpAnswer',
      'followUpKind',
      'imageRoles',
      'localTime',
      'mealType',
      'mode',
      'precise',
      'previousAnalysisId',
    ]);
  });

  it('trims before checking the length limit', async () => {
    await expect(
      invalidFields({
        mode: 'text',
        description: `  ${'x'.repeat(API_LIMITS.descriptionMax)}  `,
      }),
    ).resolves.toEqual([]);
  });

  it('accepts an empty role list and rejects non-string roles', async () => {
    await expect(
      invalidFields({ mode: 'food_photo', imageRoles: '' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields({ mode: 'food_photo', imageRoles: ['food'] }),
    ).resolves.toEqual(['imageRoles']);
  });
});
