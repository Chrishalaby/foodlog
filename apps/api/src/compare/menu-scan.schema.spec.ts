import {
  MENU_SCAN_FORMAT_NAME,
  MENU_SCAN_TEXT_FORMAT,
  type MenuScanOutput,
  parseMenuScanJson,
} from './menu-scan.schema.js';

type JsonSchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean;
  anyOf?: JsonSchema[];
};

const SAMPLE: MenuScanOutput = {
  restaurant: 'Cafe Nour',
  dishes: [
    {
      name: 'Chicken shawarma plate',
      description: 'Chicken, garlic sauce, fries, pickles',
      portion_basis: 'Plate with ~200 g chicken and fries',
      portion: { count: 1, unit: 'plate', unit_plural: 'plates' },
      estimated_quantity_g: 480,
      per_serving: {
        calories: 980,
        protein_g: 55,
        carbs_g: 80,
        fat_g: 48,
        saturated_fat_g: 9,
        fiber_g: 6,
        sugar_g: 5,
        sodium_mg: 2100,
        alcohol_g: 0,
      },
      confidence: 'medium',
      notes: null,
    },
  ],
  warnings: [],
};

function schema(): JsonSchema {
  return MENU_SCAN_TEXT_FORMAT.schema as JsonSchema;
}

describe('menu scan schema', () => {
  it('is a strict json_schema text format', () => {
    expect(MENU_SCAN_TEXT_FORMAT).toMatchObject({
      type: 'json_schema',
      name: MENU_SCAN_FORMAT_NAME,
      strict: true,
    });
  });

  it('requires every field, in the order the model should reason', () => {
    const root = schema();
    expect(root.required).toEqual(['restaurant', 'dishes', 'warnings']);
    expect(root.additionalProperties).toBe(false);
    const dish = root.properties?.dishes?.items;
    expect(dish?.required).toEqual([
      'name',
      'description',
      'portion_basis',
      'portion',
      'estimated_quantity_g',
      'per_serving',
      'confidence',
      'notes',
    ]);
    expect(dish?.additionalProperties).toBe(false);
    expect(dish?.properties?.portion?.anyOf).toEqual([
      expect.objectContaining({
        type: 'object',
        required: ['count', 'unit', 'unit_plural'],
        additionalProperties: false,
      }),
      { type: 'null' },
    ]);
    expect(dish?.properties?.per_serving?.required).toEqual([
      'calories',
      'protein_g',
      'carbs_g',
      'fat_g',
      'saturated_fat_g',
      'fiber_g',
      'sugar_g',
      'sodium_mg',
      'alcohol_g',
    ]);
  });

  it('parses valid model output', () => {
    expect(parseMenuScanJson(JSON.stringify(SAMPLE))).toEqual({
      ok: true,
      data: SAMPLE,
    });
  });

  it('reports invalid JSON', () => {
    expect(parseMenuScanJson('{"restaurant": ')).toEqual({
      ok: false,
      error: 'Model output is not valid JSON',
    });
  });

  it('reports schema violations with the failing path', () => {
    const result = parseMenuScanJson(
      JSON.stringify({
        ...SAMPLE,
        dishes: [{ ...SAMPLE.dishes[0], confidence: 'certain' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('confidence');
  });
});
