import { zeroNutrients, type DraftDto, type EntryItemInput } from '@food/shared';
import type { LocalDraft } from '../../../core/offline-drafts.store';
import {
  DRAFT_STATE_LABELS,
  draftCalories,
  draftFacts,
  draftStateLabel,
  draftTitle,
  draftWhen,
  localDraftRow,
  parseDraftItems,
  serverDraftRow,
  sortDraftRows,
} from './draft-rows';

const RICE: EntryItemInput = {
  name: 'Rice',
  grams: 150,
  nutrients: { ...zeroNutrients(), calories: 195.4, carbs: 42 },
  confidence: 'medium',
};
const CHICKEN: EntryItemInput = {
  name: 'Chicken',
  grams: 120,
  nutrients: { ...zeroNutrients(), calories: 198, protein: 37 },
};

function server(overrides: Partial<DraftDto> = {}): DraftDto {
  return {
    portion: null,
    id: 'draft-1',
    mode: 'food_photo',
    name: null,
    description: null,
    mealType: 'lunch',
    timestamp: new Date(2026, 8, 30, 12, 30).toISOString(),
    localDate: '2026-09-30',
    items: null,
    analysisId: null,
    photos: [
      {
        role: 'food',
        photo: {
          id: 'p1',
          url: '/api/photos/p1',
          thumbUrl: '/api/photos/p1/thumb',
          width: 1,
          height: 1,
        },
      },
      {
        role: 'label',
        photo: {
          id: 'p2',
          url: '/api/photos/p2',
          thumbUrl: '/api/photos/p2/thumb',
          width: 1,
          height: 1,
        },
      },
    ],
    createdAt: '2026-09-30T09:31:00.000Z',
    updatedAt: '2026-09-30T09:32:00.000Z',
    ...overrides,
  };
}

function local(overrides: Partial<LocalDraft> = {}): LocalDraft {
  return {
    localId: 'local-1',
    userId: 'u',
    fields: {
      mode: 'text',
      description: '2 eggs\nand toast',
      timestamp: new Date(2026, 8, 29, 8, 5).toISOString(),
      localDate: '2026-09-29',
    },
    images: [],
    photoId: null,
    createdAt: '2026-09-30T10:00:00.000Z',
    attempts: 0,
    nextAttemptAt: 0,
    firstSentAt: null,
    lastSentAt: null,
    failure: null,
    ...overrides,
  };
}

describe('parseDraftItems', () => {
  it('reads the items a draft saved as JSON', () => {
    expect(parseDraftItems(JSON.stringify([RICE, CHICKEN]))).toEqual([
      { ...RICE, count: null, unit: null, unitPlural: null },
      { ...CHICKEN, confidence: null, count: null, unit: null, unitPlural: null },
    ]);
  });

  it('keeps vitamins and drink ml of saved items and drops malformed ones', () => {
    const pepsi = { ...RICE, name: 'Diet Pepsi', micros: { caffeine: 36 }, fluidMl: 330 };
    const odd = { ...CHICKEN, micros: { caffeine: -1, bogus: 3 }, fluidMl: '330' };
    const [first, second] = parseDraftItems(JSON.stringify([pepsi, odd]))!;
    expect(first).toMatchObject({ micros: { caffeine: 36 }, fluidMl: 330 });
    expect(second).not.toHaveProperty('micros');
    expect(second).not.toHaveProperty('fluidMl');
  });

  it('keeps item counts and reads the portion of a local draft', () => {
    const eggs = { ...RICE, name: 'Eggs', count: 2, unit: 'egg', unitPlural: 'eggs' };
    expect(parseDraftItems(JSON.stringify([eggs]))?.[0]).toMatchObject({
      count: 2,
      unit: 'egg',
      unitPlural: 'eggs',
    });
    const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };
    const facts = draftFacts({
      kind: 'local',
      draft: local({
        fields: {
          ...local().fields,
          items: JSON.stringify([RICE]),
          portion: JSON.stringify(burgers),
        },
      }),
    });
    expect(facts.portion).toEqual(burgers);
    expect(draftFacts({ kind: 'local', draft: local() }).portion).toBeNull();
  });

  it('keeps the saved food each item links to', () => {
    const linked = { ...RICE, productId: 'food-rice' };
    expect(parseDraftItems(JSON.stringify([linked, RICE]))?.map((item) => item.productId)).toEqual([
      'food-rice',
      undefined,
    ]);
    expect(parseDraftItems(JSON.stringify([{ ...RICE, productId: 7 }]))).toBeNull();
  });

  it('ignores missing, empty or malformed items', () => {
    expect(parseDraftItems(undefined)).toBeNull();
    expect(parseDraftItems('')).toBeNull();
    expect(parseDraftItems('[]')).toBeNull();
    expect(parseDraftItems('{oops')).toBeNull();
    expect(parseDraftItems(JSON.stringify([{ name: 'x' }]))).toBeNull();
    expect(parseDraftItems(JSON.stringify([{ ...RICE, confidence: 'certain' }]))).toBeNull();
  });
});

describe('draft titles and times', () => {
  it('prefers the name, then the first line of the description, then the kind of draft', () => {
    const facts = draftFacts({ kind: 'server', draft: server() });
    expect(draftTitle({ ...facts, name: 'Lunch bowl', description: 'rice\nchicken' })).toEqual({
      title: 'Lunch bowl',
      detail: 'rice',
    });
    expect(draftTitle({ ...facts, description: '\n rice and chicken \nmore' })).toEqual({
      title: 'rice and chicken',
      detail: null,
    });
    expect(draftTitle(facts)).toEqual({ title: 'Food photo', detail: null });
    expect(draftTitle({ ...facts, description: 'x'.repeat(200) }).title).toHaveLength(80);
  });

  it('labels when the meal was eaten relative to today', () => {
    const today = '2026-09-30';
    expect(draftWhen(new Date(2026, 8, 30, 12, 30).toISOString(), today)).toBe('Today 12:30');
    expect(draftWhen(new Date(2026, 8, 29, 8, 5).toISOString(), today)).toBe('Yesterday 08:05');
    expect(draftWhen('nope', today)).toBe('');
  });

  it('adds up calories of analysed drafts', () => {
    expect(draftCalories([RICE, CHICKEN])).toBe(393);
    expect(draftCalories(null)).toBeNull();
  });
});

describe('draft rows', () => {
  it('describes a server draft that has not been analysed yet', () => {
    const row = serverDraftRow(server({ description: 'Shawarma plate' }), '2026-09-30');
    expect(row).toMatchObject({
      key: 'server:draft-1',
      title: 'Shawarma plate',
      when: 'Today 12:30',
      thumbs: ['/api/photos/p1/thumb', '/api/photos/p2/thumb'],
      photoCount: 2,
      analysed: false,
      calories: null,
      upload: 'saved',
    });
    expect(draftStateLabel(row)).toBe(DRAFT_STATE_LABELS.pending);
  });

  it('shows the calories of an analysed server draft', () => {
    const row = serverDraftRow(server({ items: [RICE, CHICKEN], analysisId: 'a-1' }));
    expect(row.analysed).toBe(true);
    expect(draftStateLabel(row)).toBe('Analysed · 270 g · 393 kcal');
  });

  it('shows the portion of an analysed server draft', () => {
    const row = serverDraftRow(
      server({
        items: [RICE, CHICKEN],
        analysisId: 'a-1',
        portion: { count: 2, unit: 'bowl', unitPlural: 'bowls' },
      }),
    );
    expect(row.amount).toBe('2 bowls · 270 g');
    expect(draftStateLabel(row)).toBe('Analysed · 2 bowls · 270 g · 393 kcal');
  });

  it('marks drafts that are still on this phone', () => {
    const waiting = localDraftRow(local(), ['blob:1'], false, '2026-09-30');
    expect(waiting).toMatchObject({
      key: 'local:local-1',
      title: '2 eggs',
      when: 'Yesterday 08:05',
      upload: 'waiting',
      thumbs: ['blob:1'],
    });
    expect(draftStateLabel(waiting)).toBe(DRAFT_STATE_LABELS.waiting);
    expect(draftStateLabel(localDraftRow(local(), [], true))).toBe(DRAFT_STATE_LABELS.uploading);
    const failed = localDraftRow(local({ failure: 'Too big.' }), [], false);
    expect(failed.upload).toBe('failed');
    expect(draftStateLabel(failed)).toBe(DRAFT_STATE_LABELS.failed);
  });

  it('reads analysed items from a local draft', () => {
    const row = localDraftRow(
      local({ fields: { ...local().fields, items: JSON.stringify([RICE]), analysisId: 'a-9' } }),
      [],
      false,
    );
    expect(row.analysed).toBe(true);
    expect(row.calories).toBe(195);
    expect(draftFacts(row.source).analysisId).toBe('a-9');
  });

  it('sorts the most recently touched drafts first', () => {
    const older = serverDraftRow(server({ id: 'old', updatedAt: '2026-09-28T10:00:00.000Z' }));
    const newer = serverDraftRow(server({ id: 'new', updatedAt: '2026-09-30T11:00:00.000Z' }));
    const phone = localDraftRow(local({ createdAt: '2026-09-29T10:00:00.000Z' }), [], false);
    expect(sortDraftRows([older, phone, newer]).map((row) => row.key)).toEqual([
      'server:new',
      'local:local-1',
      'server:old',
    ]);
  });
});
