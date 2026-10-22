import { HttpErrorResponse } from '@angular/common/http';
import {
  DEFAULT_BASE_TARGETS,
  type EntryItemInput,
  type MealIdea,
  type MealIdeaPart,
  type Nutrients,
} from '@food/shared';
import {
  IDEAS_FRESH_MS,
  describeIdeasError,
  ideaAfter,
  ideaLogPlan,
  ideaLogTopics,
  ideasBasis,
  ideasCardNote,
  isFresh,
  isNewFood,
  leftLine,
  macroLine,
  partAmount,
  type DayBalance,
} from './meal-ideas-model';
import { nutrients } from './today-fixtures';

function day(eaten: Partial<Nutrients> = {}, calories = 2200, protein = 170): DayBalance {
  return {
    targets: { ...DEFAULT_BASE_TARGETS, calories, protein },
    totals: nutrients(eaten),
  };
}

function item(name: string, extras: Partial<EntryItemInput> = {}): EntryItemInput {
  return { name, grams: 100, nutrients: nutrients({ calories: 100 }), ...extras };
}

function part(overrides: Partial<MealIdeaPart> = {}): MealIdeaPart {
  return {
    name: 'Chicken wrap',
    foodKey: 'meal:1',
    servings: 1,
    grams: 320,
    portion: null,
    nutrients: nutrients({ calories: 640, protein: 40 }),
    items: [item('Chicken wrap')],
    ...overrides,
  };
}

function idea(parts: MealIdeaPart[], totals: Partial<Nutrients> = {}): MealIdea {
  return {
    title: 'Dinner idea',
    mealType: 'dinner',
    reason: 'Fits',
    parts,
    totals: nutrients({ calories: 640, protein: 40, carbs: 60.4, fat: 24.5, ...totals }),
    grams: 320,
  };
}

function httpError(status: number, message?: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: message ? { message } : null });
}

describe('what is left today', () => {
  it('states the calories left and the protein still to go', () => {
    const balance = day({ calories: 1300.4, protein: 90 });
    expect(leftLine(balance)).toBe('900 kcal left · 80 g protein to go');
    expect(ideasCardNote(balance)).toBe('From your usual foods · 900 kcal left');
  });

  it('says when the day is over target and protein is done', () => {
    const balance = day({ calories: 2350, protein: 171 });
    expect(leftLine(balance)).toBe('150 kcal over · protein target hit');
    expect(ideasCardNote(balance)).toBe('From your usual foods · light options');
  });

  it('uses thousands separators for big days', () => {
    expect(leftLine(day({}, 2230, 180))).toBe('2,230 kcal left · 180 g protein to go');
  });
});

describe('ideaAfter', () => {
  it('shows what the idea leaves for the rest of the day', () => {
    expect(ideaAfter(day({ calories: 1300, protein: 90 }), idea([part()]))).toEqual({
      text: 'Leaves 260 kcal · 40 g protein to go',
      over: false,
    });
  });

  it('celebrates the protein target when the idea reaches it', () => {
    expect(ideaAfter(day({ calories: 1300, protein: 140 }), idea([part()])).text).toBe(
      'Leaves 260 kcal · protein target hit',
    );
  });

  it('warns by how much an idea goes over the calories left', () => {
    expect(ideaAfter(day({ calories: 1800, protein: 90 }), idea([part()]))).toEqual({
      text: "240 kcal over today's target",
      over: true,
    });
  });
});

describe('idea rows', () => {
  it('summarises the macros in whole grams', () => {
    expect(macroLine(idea([part()]))).toBe('Protein 40 g · Carbs 60 g · Fat 25 g');
  });

  it('shows the counted portion with the weight, or just the weight', () => {
    expect(
      partAmount(part({ portion: { count: 1.5, unit: 'wrap', unitPlural: 'wraps' }, grams: 480 })),
    ).toBe('1½ wraps · 480 g');
    expect(partAmount(part({ grams: 125.4 }))).toBe('125 g');
    expect(partAmount(part({ grams: 0 }))).toBe('');
  });

  it('marks foods that are not from the library as new', () => {
    expect(isNewFood(part())).toBe(false);
    expect(isNewFood(part({ foodKey: null, servings: null }))).toBe(true);
  });
});

describe('ideaLogPlan', () => {
  it('logs a single usual food through quick log with its servings', () => {
    const plan = ideaLogPlan(idea([part({ foodKey: 'favorite:9', servings: 1.5 })]));

    expect(plan).toMatchObject({ kind: 'quick', key: 'favorite:9', servings: 1.5 });
    expect(ideaLogTopics(plan)).toEqual(['entries', 'favorites']);
  });

  it('logs several usual foods as one copied entry with every item', () => {
    const plan = ideaLogPlan(
      idea([
        part({ items: [item('Chicken'), item('Rice')] }),
        part({ foodKey: 'product:2', items: [item('Yogurt', { productId: 'p-2' })] }),
      ]),
    );

    expect(plan.kind).toBe('entry');
    expect(plan).toMatchObject({ source: 'copy' });
    expect(plan.items.map((i) => i.name)).toEqual(['Chicken', 'Rice', 'Yogurt']);
    expect(ideaLogTopics(plan)).toEqual(['entries', 'products']);
  });

  it('logs an idea with a new food as a text entry', () => {
    const plan = ideaLogPlan(
      idea([part(), part({ foodKey: null, servings: null, items: [item('Boiled eggs')] })]),
    );

    expect(plan).toMatchObject({ kind: 'entry', source: 'text' });
    expect(ideaLogTopics(plan)).toEqual(['entries']);
  });

  it('treats a single new food as an entry, never a quick log', () => {
    expect(ideaLogPlan(idea([part({ foodKey: null, servings: null })])).kind).toBe('entry');
  });

  it('refreshes products after quick logging a saved product', () => {
    const plan = ideaLogPlan(idea([part({ foodKey: 'product:7' })]));
    expect(ideaLogTopics(plan)).toEqual(['entries', 'favorites', 'products']);
  });
});

describe('remembering ideas', () => {
  it('ties ideas to the day and what has been eaten so far', () => {
    const summary = { totals: nutrients({ calories: 1300.4 }), entryCount: 2 };
    expect(ideasBasis('2026-10-11', summary)).toBe('2026-10-11|2|1300');
    expect(ideasBasis('2026-10-11', { ...summary, entryCount: 3 })).not.toBe(
      ideasBasis('2026-10-11', summary),
    );
  });

  it('keeps ideas for half an hour', () => {
    expect(isFresh(1000, 1000 + IDEAS_FRESH_MS - 1)).toBe(true);
    expect(isFresh(1000, 1000 + IDEAS_FRESH_MS)).toBe(false);
  });
});

describe('describeIdeasError', () => {
  const member = { admin: false };

  it('explains being offline', () => {
    expect(describeIdeasError(httpError(0), member)).toMatchObject({
      kind: 'offline',
      title: "You're offline",
      retryable: true,
    });
  });

  it('tells a rate limit apart from a used-up AI budget', () => {
    expect(describeIdeasError(httpError(429, 'ThrottlerException'), member)).toMatchObject({
      kind: 'rate_limited',
      message: 'Wait a minute, then ask again.',
      retryable: true,
    });
    expect(
      describeIdeasError(httpError(429, 'Your monthly AI budget is used up'), member),
    ).toMatchObject({
      kind: 'budget',
      title: "You've used this month's AI budget",
      retryable: false,
    });
  });

  it('says when AI is not set up, with the admin fix for admins', () => {
    const err = httpError(503, 'AI is not configured — set OPENAI_API_KEY');
    expect(describeIdeasError(err, member)).toMatchObject({
      kind: 'not_configured',
      retryable: false,
    });
    expect(describeIdeasError(err, { admin: true }).message).toContain('OPENAI_API_KEY');
  });

  it('passes on what the server says when the AI fails, and offers a retry', () => {
    expect(
      describeIdeasError(
        httpError(502, 'OpenAI is having problems right now — please try again shortly'),
        member,
      ),
    ).toEqual({
      kind: 'ai_failed',
      title: "The AI couldn't finish",
      message: 'OpenAI is having problems right now — please try again shortly.',
      retryable: true,
    });
    expect(describeIdeasError(httpError(504), member).title).toBe('The AI took too long');
    expect(describeIdeasError(httpError(503), member)).toMatchObject({
      kind: 'ai_unavailable',
      retryable: true,
    });
  });

  it('falls back to a generic message for anything else', () => {
    expect(describeIdeasError(new Error('boom'), member)).toEqual({
      kind: 'unknown',
      title: "Couldn't get ideas",
      message: 'boom',
      retryable: true,
    });
    expect(describeIdeasError(httpError(400, 'note is too long'), member).kind).toBe('unknown');
  });
});
