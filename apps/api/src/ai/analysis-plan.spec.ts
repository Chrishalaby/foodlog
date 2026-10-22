import { BadRequestException } from '@nestjs/common';
import {
  type AnalysisPlan,
  answeredQuestionTexts,
  capAnalysisPhotos,
  carriedPhotos,
  DEFAULT_PROFILE_AI_SETTINGS,
  type DraftStart,
  type ImageUploadSpec,
  planAnalysis,
  type PreviousAnalysis,
  primaryPhoto,
  type ProfileAiSettings,
  resolveMode,
  toImageRole,
  uploadRole,
} from './analysis-plan.js';

const PROFILE: ProfileAiSettings = {
  ...DEFAULT_PROFILE_AI_SETTINGS,
  aiDetailFood: 'low',
  aiDetailLabel: 'high',
};

const PHOTO_ID = '0199a0b6-0000-7000-8000-000000000002';
const LABEL_ID = '0199a0b6-0000-7000-8000-000000000003';
const SECOND_LABEL_ID = '0199a0b6-0000-7000-8000-000000000004';
const DRAFT_PHOTO_ID = '0199a0b6-0000-7000-8000-000000000005';

const LEGACY: ImageUploadSpec[] = [{ field: 'image', role: null }];

const PREVIOUS: PreviousAnalysis = {
  id: '0199a0b6-0000-7000-8000-000000000001',
  mode: 'food_photo',
  description: 'chicken plate',
  photos: [{ photoId: PHOTO_ID, role: 'food' }],
  result: {
    mealName: 'Chicken plate',
    items: [
      { name: 'Chicken', grams: 150, nutrients: { calories: 248 } },
      { name: 42 },
    ],
    totals: { calories: 248 },
    followUpQuestion: 'How was it cooked?',
  },
  answeredQuestions: [],
};

function images(...roles: ImageUploadSpec['role'][]): ImageUploadSpec[] {
  return roles.map((role) => ({ field: 'images', role }));
}

function photosOf(plan: AnalysisPlan): [string, string, string][] {
  return plan.photos.map(({ source, role, detail }) => [
    source.kind === 'stored' ? source.photoId : `upload:${source.index}`,
    role,
    detail,
  ]);
}

function badRequest(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof BadRequestException) {
      return error.message;
    }
    throw error;
  }
  throw new Error('expected a BadRequestException');
}

describe('planAnalysis', () => {
  it('plans a photo upload with the profile detail for the mode', () => {
    const food = planAnalysis({ mode: 'food_photo' }, null, LEGACY, PROFILE);
    const label = planAnalysis(
      { mode: 'nutrition_label' },
      null,
      LEGACY,
      PROFILE,
    );

    expect(food).toMatchObject({
      mode: 'food_photo',
      description: null,
      detail: 'low',
      precise: false,
      photos: [{ source: { kind: 'upload', index: 0 }, role: 'food' }],
      followUp: null,
      previousAnalysisId: null,
    });
    expect(photosOf(label)).toEqual([['upload:0', 'label', 'high']]);
    expect(label.detail).toBe('high');
    expect(
      planAnalysis(
        { mode: 'food_photo', detail: 'high' },
        null,
        LEGACY,
        PROFILE,
      ).detail,
    ).toBe('high');
  });

  it('plans a text analysis without detail', () => {
    const plan = planAnalysis(
      {
        mode: 'text',
        description: '  2 eggs  ',
        precise: 'true',
        localTime: '2026-09-28T08:00',
        mealType: 'breakfast',
      },
      null,
      [],
      PROFILE,
    );
    expect(plan).toMatchObject({
      mode: 'text',
      description: '2 eggs',
      detail: null,
      precise: true,
      photos: [],
      localTime: '2026-09-28T08:00',
      mealType: 'breakfast',
    });
  });

  it('requires an image for photo modes and a description for text', () => {
    expect(
      badRequest(() => planAnalysis({ mode: 'food_photo' }, null, [], PROFILE)),
    ).toBe('A photo is required for food photo analysis');
    expect(
      badRequest(() =>
        planAnalysis({ mode: 'nutrition_label' }, null, [], PROFILE),
      ),
    ).toBe('A photo of the nutrition label is required');
    expect(
      badRequest(() =>
        planAnalysis({ mode: 'text', description: '   ' }, null, [], PROFILE),
      ),
    ).toBe('Describe what you ate for a text analysis');
    expect(
      badRequest(() =>
        planAnalysis(
          { mode: 'text', description: 'soup' },
          null,
          LEGACY,
          PROFILE,
        ),
      ),
    ).toContain('Text analysis does not take an image');
    expect(
      badRequest(() =>
        planAnalysis(
          { mode: 'text', description: 'soup' },
          null,
          images('food', 'label'),
          PROFILE,
        ),
      ),
    ).toContain('Text analysis does not take an image');
  });

  it('reuses the previous photo, mode and description for a follow-up', () => {
    const plan = planAnalysis(
      { mode: 'text', followUpAnswer: ' Pan-fried in oil ' },
      PREVIOUS,
      [],
      PROFILE,
    );
    expect(plan).toMatchObject({
      mode: 'food_photo',
      description: 'chicken plate',
      photos: [
        {
          source: { kind: 'stored', photoId: PHOTO_ID },
          role: 'food',
          detail: 'low',
        },
      ],
      previousAnalysisId: PREVIOUS.id,
      followUpAnswer: 'Pan-fried in oil',
      followUp: {
        answer: 'Pan-fried in oil',
        kind: 'answer',
        previous: {
          mealName: 'Chicken plate',
          items: [{ name: 'Chicken', grams: 150, calories: 248 }],
          totalCalories: 248,
          question: 'How was it cooked?',
        },
      },
    });
  });

  it('lets a new description replace the previous one and re-runs without follow-up context', () => {
    const plan = planAnalysis(
      { mode: 'food_photo', description: 'chicken with rice', precise: 'true' },
      PREVIOUS,
      [],
      PROFILE,
    );
    expect(plan.description).toBe('chicken with rice');
    expect(plan.followUp).toBeNull();
    expect(plan.precise).toBe(true);
  });

  it('carries the answers already given in the chain into re-runs and follow-ups', () => {
    const earlier = [{ question: 'Oil or butter?', answer: 'Butter' }];
    const previous = { ...PREVIOUS, answeredQuestions: earlier };

    const rerun = planAnalysis(
      { mode: 'food_photo', precise: 'true' },
      previous,
      [],
      PROFILE,
    );
    const followUp = planAnalysis(
      { mode: 'food_photo', followUpAnswer: 'Grilled' },
      previous,
      [],
      PROFILE,
    );

    expect(rerun.answeredQuestions).toEqual(earlier);
    expect(answeredQuestionTexts(rerun)).toEqual(['Oil or butter?']);
    expect(followUp.answeredQuestions).toEqual(earlier);
    expect(answeredQuestionTexts(followUp)).toEqual([
      'Oil or butter?',
      'How was it cooked?',
    ]);
    expect(
      planAnalysis({ mode: 'text', description: 'soup' }, null, [], PROFILE)
        .answeredQuestions,
    ).toEqual([]);
  });

  it('leaves the open question unanswered for a correction', () => {
    const earlier = [{ question: 'Oil or butter?', answer: 'Butter' }];
    const previous = { ...PREVIOUS, answeredQuestions: earlier };

    const correction = planAnalysis(
      {
        mode: 'food_photo',
        followUpAnswer: 'I ate half the rice',
        followUpKind: 'correction',
      },
      previous,
      [],
      PROFILE,
    );
    const answer = planAnalysis(
      { mode: 'food_photo', followUpAnswer: 'Grilled', followUpKind: 'answer' },
      previous,
      [],
      PROFILE,
    );

    expect(correction.followUp).toMatchObject({
      answer: 'I ate half the rice',
      kind: 'correction',
      previous: { question: 'How was it cooked?' },
    });
    expect(answeredQuestionTexts(correction)).toEqual(['Oil or butter?']);
    expect(answer.followUp?.kind).toBe('answer');
    expect(answeredQuestionTexts(answer)).toEqual([
      'Oil or butter?',
      'How was it cooked?',
    ]);
  });

  it('rejects answers without a previous analysis and previous analyses without a photo', () => {
    expect(
      badRequest(() =>
        planAnalysis(
          { mode: 'food_photo', followUpAnswer: 'fried' },
          null,
          LEGACY,
          PROFILE,
        ),
      ),
    ).toBe('followUpAnswer requires previousAnalysisId');
    expect(
      badRequest(() =>
        planAnalysis(
          { mode: 'food_photo' },
          { ...PREVIOUS, photos: [] },
          [],
          PROFILE,
        ),
      ),
    ).toContain('original photo is no longer available');
  });
});

describe('planAnalysis with meal splitting', () => {
  const DRAFT: DraftStart = {
    id: '0199a0b6-0000-7000-8000-0000000000d2',
    description: 'eggs for breakfast, pizza for dinner',
    photos: [],
  };

  it('splits only a fresh text description that asks for it', () => {
    const text = { mode: 'text', description: 'eggs then pizza' } as const;

    expect(planAnalysis(text, null, [], PROFILE).split).toBe(false);
    expect(
      planAnalysis({ ...text, split: 'false' }, null, [], PROFILE).split,
    ).toBe(false);
    expect(
      planAnalysis({ ...text, split: 'true' }, null, [], PROFILE).split,
    ).toBe(true);
  });

  it('never splits photos, follow-ups or drafts', () => {
    expect(
      planAnalysis({ mode: 'food_photo', split: 'true' }, null, LEGACY, PROFILE)
        .split,
    ).toBe(false);
    expect(
      planAnalysis(
        { mode: 'text', split: 'true' },
        { ...PREVIOUS, mode: 'text', photos: [] },
        [],
        PROFILE,
      ).split,
    ).toBe(false);
    expect(
      planAnalysis({ mode: 'text', split: 'true' }, null, [], PROFILE, DRAFT)
        .split,
    ).toBe(false);
  });
});

describe('planAnalysis with several photos', () => {
  it('defaults the first photo to food and later ones to label, with the detail of each role', () => {
    const plan = planAnalysis(
      { mode: 'food_photo' },
      null,
      images(null, null, null),
      PROFILE,
    );
    expect(photosOf(plan)).toEqual([
      ['upload:0', 'food', 'low'],
      ['upload:1', 'label', 'high'],
      ['upload:2', 'label', 'high'],
    ]);
    expect(plan.detail).toBe('high');
  });

  it('defaults every photo of a nutrition label scan to label', () => {
    const plan = planAnalysis(
      { mode: 'nutrition_label' },
      null,
      images(null, null),
      PROFILE,
    );
    expect(photosOf(plan)).toEqual([
      ['upload:0', 'label', 'high'],
      ['upload:1', 'label', 'high'],
    ]);
  });

  it('uses the requested roles and lets a requested detail apply to every photo', () => {
    const plan = planAnalysis(
      { mode: 'food_photo', detail: 'low' },
      null,
      images('label', 'food'),
      PROFILE,
    );
    expect(photosOf(plan)).toEqual([
      ['upload:0', 'label', 'low'],
      ['upload:1', 'food', 'low'],
    ]);
    expect(plan.detail).toBe('low');
  });

  it('gives a legacy image the natural role of the mode ahead of the images list', () => {
    const uploads: ImageUploadSpec[] = [...LEGACY, ...images(null)];
    expect(
      photosOf(planAnalysis({ mode: 'food_photo' }, null, uploads, PROFILE)),
    ).toEqual([
      ['upload:0', 'food', 'low'],
      ['upload:1', 'label', 'high'],
    ]);
    expect(
      photosOf(
        planAnalysis({ mode: 'nutrition_label' }, null, uploads, PROFILE),
      ),
    ).toEqual([
      ['upload:0', 'label', 'high'],
      ['upload:1', 'label', 'high'],
    ]);
  });

  it('carries the previous photos over and appends new uploads as labels by default', () => {
    const plan = planAnalysis(
      { mode: 'food_photo' },
      PREVIOUS,
      images(null),
      PROFILE,
    );
    expect(photosOf(plan)).toEqual([
      [PHOTO_ID, 'food', 'low'],
      ['upload:0', 'label', 'high'],
    ]);
    expect(plan.previousAnalysisId).toBe(PREVIOUS.id);
  });

  it('uses the mode of the previous analysis for the role of a legacy image', () => {
    const labelScan: PreviousAnalysis = {
      ...PREVIOUS,
      mode: 'nutrition_label',
      photos: [{ photoId: LABEL_ID, role: 'label' }],
    };
    expect(
      photosOf(
        planAnalysis({ mode: 'food_photo' }, labelScan, LEGACY, PROFILE),
      ),
    ).toEqual([
      [LABEL_ID, 'label', 'high'],
      ['upload:0', 'label', 'high'],
    ]);
  });

  it('caps at three photos, keeping the first food photo and the newest others', () => {
    const previous: PreviousAnalysis = {
      ...PREVIOUS,
      photos: [
        { photoId: PHOTO_ID, role: 'food' },
        { photoId: LABEL_ID, role: 'label' },
        { photoId: SECOND_LABEL_ID, role: 'label' },
      ],
    };
    const plan = planAnalysis(
      { mode: 'food_photo' },
      previous,
      images('label'),
      PROFILE,
    );
    expect(photosOf(plan)).toEqual([
      [PHOTO_ID, 'food', 'low'],
      [SECOND_LABEL_ID, 'label', 'high'],
      ['upload:0', 'label', 'high'],
    ]);

    const replaced = planAnalysis(
      { mode: 'food_photo' },
      { ...previous, photos: previous.photos.slice(0, 2) },
      images('food', 'label', 'label'),
      PROFILE,
    );
    expect(photosOf(replaced)).toEqual([
      [PHOTO_ID, 'food', 'low'],
      ['upload:1', 'label', 'high'],
      ['upload:2', 'label', 'high'],
    ]);
  });
});

describe('planAnalysis with a draft', () => {
  const DRAFT: DraftStart = {
    id: '0199a0b6-0000-7000-8000-0000000000d1',
    description: 'lunch at the office',
    photos: [{ photoId: DRAFT_PHOTO_ID, role: 'food' }],
  };

  it("starts from the draft's photos and description", () => {
    const plan = planAnalysis({ mode: 'food_photo' }, null, [], PROFILE, DRAFT);
    expect(plan).toMatchObject({
      mode: 'food_photo',
      description: 'lunch at the office',
      previousAnalysisId: null,
      followUp: null,
    });
    expect(photosOf(plan)).toEqual([[DRAFT_PHOTO_ID, 'food', 'low']]);
  });

  it('appends new uploads to the draft photos as labels by default', () => {
    const plan = planAnalysis(
      { mode: 'food_photo', description: '  with extra sauce ' },
      null,
      images(null),
      PROFILE,
      DRAFT,
    );
    expect(plan.description).toBe('with extra sauce');
    expect(photosOf(plan)).toEqual([
      [DRAFT_PHOTO_ID, 'food', 'low'],
      ['upload:0', 'label', 'high'],
    ]);
  });

  it('switches a described draft with photos to photo or label analysis', () => {
    const food = planAnalysis({ mode: 'text' }, null, [], PROFILE, DRAFT);
    const label = planAnalysis({ mode: 'text' }, null, [], PROFILE, {
      ...DRAFT,
      photos: [{ photoId: LABEL_ID, role: 'label' }],
    });
    expect(food.mode).toBe('food_photo');
    expect(photosOf(food)).toEqual([[DRAFT_PHOTO_ID, 'food', 'low']]);
    expect(label.mode).toBe('nutrition_label');
    expect(photosOf(label)).toEqual([[LABEL_ID, 'label', 'high']]);
  });

  it('keeps a text draft without photos a text analysis', () => {
    const plan = planAnalysis({ mode: 'text' }, null, [], PROFILE, {
      ...DRAFT,
      photos: [],
    });
    expect(plan).toMatchObject({
      mode: 'text',
      description: 'lunch at the office',
      photos: [],
    });
    expect(
      badRequest(() =>
        planAnalysis({ mode: 'text' }, null, [], PROFILE, {
          ...DRAFT,
          description: '  ',
          photos: [],
        }),
      ),
    ).toBe('Describe what you ate for a text analysis');
    expect(
      badRequest(() =>
        planAnalysis({ mode: 'food_photo' }, null, [], PROFILE, {
          ...DRAFT,
          photos: [],
        }),
      ),
    ).toBe('A photo is required for food photo analysis');
  });

  it('layers a previous analysis on top without duplicating shared photos', () => {
    const previous: PreviousAnalysis = {
      ...PREVIOUS,
      description: 'chicken plate with rice',
      photos: [
        { photoId: DRAFT_PHOTO_ID, role: 'food' },
        { photoId: LABEL_ID, role: 'label' },
      ],
    };
    const plan = planAnalysis(
      { mode: 'text', followUpAnswer: 'Grilled' },
      previous,
      images('label'),
      PROFILE,
      DRAFT,
    );
    expect(plan).toMatchObject({
      mode: 'food_photo',
      description: 'chicken plate with rice',
      previousAnalysisId: PREVIOUS.id,
      followUpAnswer: 'Grilled',
    });
    expect(photosOf(plan)).toEqual([
      [DRAFT_PHOTO_ID, 'food', 'low'],
      [LABEL_ID, 'label', 'high'],
      ['upload:0', 'label', 'high'],
    ]);
  });

  it('does not bring back a draft photo that a previous analysis dropped', () => {
    const draft: DraftStart = {
      ...DRAFT,
      photos: [
        { photoId: DRAFT_PHOTO_ID, role: 'food' },
        { photoId: LABEL_ID, role: 'label' },
        { photoId: SECOND_LABEL_ID, role: 'label' },
      ],
    };
    const plan = planAnalysis(
      { mode: 'food_photo' },
      {
        ...PREVIOUS,
        photos: [
          { photoId: DRAFT_PHOTO_ID, role: 'food' },
          { photoId: SECOND_LABEL_ID, role: 'label' },
          { photoId: PHOTO_ID, role: 'label' },
        ],
      },
      [],
      PROFILE,
      draft,
    );
    expect(photosOf(plan)).toEqual([
      [DRAFT_PHOTO_ID, 'food', 'low'],
      [SECOND_LABEL_ID, 'label', 'high'],
      [PHOTO_ID, 'label', 'high'],
    ]);
  });
});

describe('uploadRole', () => {
  it("gives the first photo the mode's natural role and later ones label", () => {
    const spec: ImageUploadSpec = { field: 'images', role: null };
    expect(uploadRole(spec, 'food_photo', true)).toBe('food');
    expect(uploadRole(spec, 'text', true)).toBe('food');
    expect(uploadRole(spec, 'nutrition_label', true)).toBe('label');
    expect(uploadRole(spec, 'food_photo', false)).toBe('label');
    expect(
      uploadRole({ field: 'image', role: null }, 'food_photo', false),
    ).toBe('food');
    expect(
      uploadRole({ field: 'images', role: 'food' }, 'food_photo', false),
    ).toBe('food');
  });
});

describe('toImageRole', () => {
  it('keeps known roles and falls back to the natural role of the mode', () => {
    expect(toImageRole('label', 'food_photo')).toBe('label');
    expect(toImageRole('menu', 'food_photo')).toBe('food');
    expect(toImageRole('menu', 'nutrition_label')).toBe('label');
  });
});

describe('capAnalysisPhotos', () => {
  const food = (id: string) => ({ id, role: 'food' as const });
  const label = (id: string) => ({ id, role: 'label' as const });

  it('keeps short lists unchanged', () => {
    const photos = [label('a'), food('b')];
    expect(capAnalysisPhotos(photos)).toEqual(photos);
  });

  it('keeps the first food photo in place and fills up with the newest others', () => {
    expect(
      capAnalysisPhotos([
        label('a'),
        food('b'),
        food('c'),
        label('d'),
        label('e'),
      ]).map(({ id }) => id),
    ).toEqual(['b', 'd', 'e']);
  });

  it('keeps the newest photos when there is no food photo', () => {
    expect(
      capAnalysisPhotos([label('a'), label('b'), label('c'), label('d')]).map(
        ({ id }) => id,
      ),
    ).toEqual(['b', 'c', 'd']);
    expect(
      capAnalysisPhotos([label('a'), label('b'), food('c')], 2).map(
        ({ id }) => id,
      ),
    ).toEqual(['b', 'c']);
  });
});

describe('primaryPhoto', () => {
  it('prefers the first food photo, else the first photo', () => {
    expect(
      primaryPhoto([
        { id: 'a', role: 'label' as const },
        { id: 'b', role: 'food' as const },
        { id: 'c', role: 'food' as const },
      ])?.id,
    ).toBe('b');
    expect(primaryPhoto([{ id: 'a', role: 'label' as const }])?.id).toBe('a');
    expect(primaryPhoto([])).toBeNull();
  });
});

describe('carriedPhotos', () => {
  it('keeps stored roles in order and falls back to the natural role for unknown ones', () => {
    expect(
      carriedPhotos(
        'food_photo',
        [
          { photoId: PHOTO_ID, role: 'food' },
          { photoId: LABEL_ID, role: 'label' },
          { photoId: SECOND_LABEL_ID, role: 'menu' },
        ],
        PHOTO_ID,
      ),
    ).toEqual([
      { photoId: PHOTO_ID, role: 'food' },
      { photoId: LABEL_ID, role: 'label' },
      { photoId: SECOND_LABEL_ID, role: 'food' },
    ]);
  });

  it('falls back to the analysis photo of older analyses', () => {
    expect(carriedPhotos('nutrition_label', [], LABEL_ID)).toEqual([
      { photoId: LABEL_ID, role: 'label' },
    ]);
    expect(carriedPhotos('food_photo', [], PHOTO_ID)).toEqual([
      { photoId: PHOTO_ID, role: 'food' },
    ]);
    expect(carriedPhotos('food_photo', [], null)).toEqual([]);
  });
});

describe('resolveMode', () => {
  const request = { mode: 'text' } as Parameters<typeof resolveMode>[0];
  const previous = (mode: 'text' | 'food_photo') =>
    ({ mode }) as unknown as Parameters<typeof resolveMode>[1];
  const upload = (role?: 'food' | 'label') =>
    ({ field: 'images', role }) as unknown as Parameters<
      typeof resolveMode
    >[2][number];

  it('uses the request mode for a first analysis', () => {
    expect(resolveMode(request, null, [])).toBe('text');
  });

  it('keeps the previous mode for re-runs', () => {
    expect(
      resolveMode(request, previous('food_photo'), [upload('label')]),
    ).toBe('food_photo');
    expect(resolveMode(request, previous('text'), [])).toBe('text');
  });

  it('switches a text request to photo analysis when the draft has photos', () => {
    const draft = (...roles: ('food' | 'label')[]): DraftStart => ({
      id: 'draft',
      description: null,
      photos: roles.map((role, index) => ({ photoId: `p${index}`, role })),
    });
    expect(resolveMode(request, null, [], draft('food'))).toBe('food_photo');
    expect(resolveMode(request, null, [], draft('label'))).toBe(
      'nutrition_label',
    );
    expect(resolveMode(request, null, [upload('food')], draft('label'))).toBe(
      'food_photo',
    );
    expect(resolveMode(request, null, [upload('food')], draft())).toBe('text');
    expect(
      resolveMode({ mode: 'nutrition_label' }, null, [], draft('food')),
    ).toBe('nutrition_label');
    expect(resolveMode(request, previous('text'), [], draft('label'))).toBe(
      'nutrition_label',
    );
  });

  it('switches a described meal to label or photo analysis when photos are added', () => {
    expect(resolveMode(request, previous('text'), [upload('label')])).toBe(
      'nutrition_label',
    );
    expect(
      resolveMode(request, previous('text'), [upload('food'), upload('label')]),
    ).toBe('food_photo');
    expect(resolveMode(request, previous('text'), [upload()])).toBe(
      'food_photo',
    );
  });
});
