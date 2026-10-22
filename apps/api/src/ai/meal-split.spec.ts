import { API_LIMITS } from '@food/shared';
import {
  EMPTY_MEAL_QUESTION,
  MEAL_SPLIT_INSTRUCTIONS,
  MEAL_SPLIT_MAX_DAYS_AGO,
  mealTiming,
  normalizeClockTime,
  normalizeDaysAgo,
  splitMeals,
} from './meal-split.js';
import {
  MEAL_SPLIT_TEXT_FORMAT,
  MealSplitSchema,
  type MealSplitMeal,
  parseMealSplitJson,
} from './meal-split.schema.js';
import { DEVELOPER_INSTRUCTIONS } from './prompt.js';
import { mockMealSplit } from './providers/mock-meal-split.js';

const PROMPT = {
  mode: 'text' as const,
  imageRoles: [],
  description: null,
  localTime: '2026-10-04T21:30',
  mealType: null,
  location: null,
  answeredQuestions: [],
  followUp: null,
};

function meals(description: string): MealSplitMeal[] {
  return mockMealSplit({ ...PROMPT, description }).meals;
}

function meal(overrides: Partial<MealSplitMeal> = {}): MealSplitMeal {
  const [first] = meals('2 eggs');
  if (!first) {
    throw new Error('expected a mock meal');
  }
  return { ...first, ...overrides };
}

type SchemaNode = Record<string, unknown>;

function objectNodes(node: unknown, found: SchemaNode[] = []): SchemaNode[] {
  if (Array.isArray(node)) {
    node.forEach((child) => objectNodes(child, found));
  } else if (typeof node === 'object' && node !== null) {
    const record = node as SchemaNode;
    if (record.type === 'object') {
      found.push(record);
    }
    Object.values(record).forEach((child) => objectNodes(child, found));
  }
  return found;
}

describe('meal split structured output format', () => {
  it('is a strict json_schema named meal_split', () => {
    expect(MEAL_SPLIT_TEXT_FORMAT).toMatchObject({
      type: 'json_schema',
      name: 'meal_split',
      strict: true,
    });
  });

  it('requires every property and forbids extra ones on every object', () => {
    const objects = objectNodes(MEAL_SPLIT_TEXT_FORMAT.schema);
    expect(objects.length).toBeGreaterThanOrEqual(6);
    for (const object of objects) {
      const properties = Object.keys(object.properties as SchemaNode);
      expect(object.additionalProperties).toBe(false);
      expect(object.required).toEqual(properties);
    }
  });

  it('avoids keywords strict mode rejects', () => {
    const text = JSON.stringify(MEAL_SPLIT_TEXT_FORMAT.schema);
    expect(text).not.toMatch(/"(allOf|oneOf|not|\$ref|if|then|else)"/);
  });

  it('asks for the words and timing of a meal before its analysis', () => {
    const [first] = objectNodes(
      (MEAL_SPLIT_TEXT_FORMAT.schema as SchemaNode).properties,
    );
    expect(Object.keys(first?.properties as SchemaNode).slice(0, 5)).toEqual([
      'description',
      'meal_type',
      'eaten_at',
      'days_ago',
      'input_type',
    ]);
  });

  it('parses valid output and explains invalid output', () => {
    const output = { meals: [meal()] };
    expect(parseMealSplitJson(JSON.stringify(output))).toEqual({
      ok: true,
      data: MealSplitSchema.parse(output),
    });
    expect(parseMealSplitJson('{')).toEqual({
      ok: false,
      error: 'Model output is not valid JSON',
    });
    expect(parseMealSplitJson('{"meals":[{}]}').ok).toBe(false);
  });
});

describe('meal split instructions', () => {
  it('extend the single-meal instructions with the splitting rules', () => {
    expect(MEAL_SPLIT_INSTRUCTIONS.startsWith(DEVELOPER_INSTRUCTIONS)).toBe(
      true,
    );
    expect(MEAL_SPLIT_INSTRUCTIONS).toContain('SEVERAL MEALS');
    expect(MEAL_SPLIT_INSTRUCTIONS).toContain('never make one meal per food');
  });
});

describe('meal timing', () => {
  it('keeps real clock times as HH:MM and drops everything else', () => {
    expect(normalizeClockTime('14:00')).toBe('14:00');
    expect(normalizeClockTime('8:05')).toBe('08:05');
    expect(normalizeClockTime(' 23.59 ')).toBe('23:59');
    expect(normalizeClockTime('24:00')).toBeNull();
    expect(normalizeClockTime('12:60')).toBeNull();
    expect(normalizeClockTime('noon')).toBeNull();
    expect(normalizeClockTime(null)).toBeNull();
  });

  it('keeps days ago a whole number within a week', () => {
    expect(normalizeDaysAgo(0)).toBe(0);
    expect(normalizeDaysAgo(1.4)).toBe(1);
    expect(normalizeDaysAgo(-3)).toBe(0);
    expect(normalizeDaysAgo(30)).toBe(MEAL_SPLIT_MAX_DAYS_AGO);
    expect(normalizeDaysAgo(Number.NaN)).toBe(0);
  });

  it('reads the timing of a meal', () => {
    expect(
      mealTiming(meal({ meal_type: 'lunch', eaten_at: '2:30', days_ago: 1 })),
    ).toEqual({ mealType: 'lunch', time: '02:30', daysAgo: 1 });
    expect(mealTiming(meal({ meal_type: null, eaten_at: 'later' }))).toEqual({
      mealType: null,
      time: null,
      daysAgo: 0,
    });
  });
});

describe('splitMeals', () => {
  it('keeps the whole description for a single meal', () => {
    const description = 'for breakfast 2 eggs and toast';
    const [only, ...rest] = splitMeals(
      { meals: meals(description) },
      description,
    );

    expect(rest).toEqual([]);
    expect(only?.description).toBe(description);
    expect(only?.timing).toEqual({
      mealType: 'breakfast',
      time: null,
      daysAgo: 0,
    });
    expect(only?.raw.items.length).toBeGreaterThan(0);
    expect(only?.raw).not.toHaveProperty('meal_type');
    expect(only?.raw).not.toHaveProperty('description');
  });

  it('gives each of several meals its own words and timing', () => {
    const description =
      'For breakfast I had 2 eggs with toast, and for lunch 150g chicken and rice';
    const split = splitMeals({ meals: meals(description) }, description);

    expect(split.map((item) => item.timing.mealType)).toEqual([
      'breakfast',
      'lunch',
    ]);
    expect(split.map((item) => item.description)).toEqual([
      'For breakfast I had 2 eggs with toast',
      'lunch 150g chicken and rice',
    ]);
  });

  it('drops meals without food when another meal has some', () => {
    const split = splitMeals(
      { meals: [meal({ items: [] }), meal({ description: 'eggs' })] },
      'whole',
    );

    expect(split).toHaveLength(1);
    expect(split[0]?.description).toBe('whole');
  });

  it('falls back to the whole description for a meal without its own words', () => {
    const split = splitMeals(
      { meals: [meal({ description: '  ' }), meal({ description: 'eggs' })] },
      'whole day',
    );

    expect(split.map((item) => item.description)).toEqual([
      'whole day',
      'eggs',
    ]);
  });

  it('keeps a meal without food so its question can be asked', () => {
    const question = 'What did you eat?';
    const [only] = splitMeals(
      { meals: [meal({ items: [], follow_up_question: question })] },
      'hello',
    );

    expect(only?.raw.items).toEqual([]);
    expect(only?.raw.follow_up_question).toBe(question);
  });

  it('asks what was eaten when the model returns no meal at all', () => {
    const [only, ...rest] = splitMeals({ meals: [] }, 'hello');

    expect(rest).toEqual([]);
    expect(only?.raw.items).toEqual([]);
    expect(only?.raw.follow_up_question).toBe(EMPTY_MEAL_QUESTION);
    expect(only?.description).toBe('hello');
  });

  it('caps the number of meals', () => {
    const many = Array.from({ length: API_LIMITS.splitMealsMax + 3 }, () =>
      meal(),
    );

    expect(splitMeals({ meals: many }, 'day')).toHaveLength(
      API_LIMITS.splitMealsMax,
    );
  });
});
