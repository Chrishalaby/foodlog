import {
  MEAL_IDEAS_FORMAT_NAME,
  MEAL_IDEAS_TEXT_FORMAT,
  type MealIdeasOutput,
  parseMealIdeasJson,
} from './meal-ideas.schema.js';

type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean;
  anyOf?: JsonSchema[];
};

const SAMPLE: MealIdeasOutput = {
  summary: 'Room for a solid dinner; protein is the gap to close.',
  ideas: [
    {
      title: 'Chicken wrap with yogurt',
      meal_type: 'dinner',
      parts: [
        { food_id: 'F1', name: 'Chicken wrap', servings: 1, estimate: null },
        {
          food_id: null,
          name: 'Boiled eggs',
          servings: 1,
          estimate: {
            grams: 100,
            portion: { count: 2, unit: 'egg', unit_plural: 'eggs' },
            calories: 155,
            protein_g: 13,
            carbs_g: 1.1,
            fat_g: 11,
            saturated_fat_g: 3.3,
            fiber_g: 0,
            sugar_g: 1.1,
            sodium_mg: 124,
          },
        },
      ],
      reason: 'High protein and close to your usual dinner',
    },
  ],
};

function schema(): JsonSchema {
  return MEAL_IDEAS_TEXT_FORMAT.schema as JsonSchema;
}

describe('meal ideas schema', () => {
  it('is a strict json_schema text format', () => {
    expect(MEAL_IDEAS_TEXT_FORMAT).toMatchObject({
      type: 'json_schema',
      name: MEAL_IDEAS_FORMAT_NAME,
      strict: true,
    });
  });

  it('requires every field and lets a part be a listed food or a new estimate', () => {
    const root = schema();
    expect(root.required).toEqual(['summary', 'ideas']);
    expect(root.additionalProperties).toBe(false);
    const idea = root.properties?.ideas?.items;
    expect(idea?.required).toEqual(['title', 'meal_type', 'parts', 'reason']);
    expect(idea?.additionalProperties).toBe(false);
    const part = idea?.properties?.parts?.items;
    expect(part?.required).toEqual(['food_id', 'name', 'servings', 'estimate']);
    expect(part?.additionalProperties).toBe(false);
    expect(part?.properties?.estimate?.anyOf).toEqual([
      expect.objectContaining({
        type: 'object',
        required: [
          'grams',
          'portion',
          'calories',
          'protein_g',
          'carbs_g',
          'fat_g',
          'saturated_fat_g',
          'fiber_g',
          'sugar_g',
          'sodium_mg',
        ],
        additionalProperties: false,
      }),
      { type: 'null' },
    ]);
  });

  it('parses valid model output', () => {
    expect(parseMealIdeasJson(JSON.stringify(SAMPLE))).toEqual({
      ok: true,
      data: SAMPLE,
    });
  });

  it('reports invalid JSON', () => {
    expect(parseMealIdeasJson('{"summary": ')).toEqual({
      ok: false,
      error: 'Model output is not valid JSON',
    });
  });

  it('reports schema violations with the failing path', () => {
    const result = parseMealIdeasJson(
      JSON.stringify({
        ...SAMPLE,
        ideas: [{ ...SAMPLE.ideas[0], meal_type: 'brunch' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('meal_type');
  });
});
