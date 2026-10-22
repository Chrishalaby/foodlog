import {
  FOOD_ANALYSIS_TEXT_FORMAT,
  parseFoodAnalysisJson,
} from './food-analysis.schema.js';

type SchemaNode = Record<string, unknown>;

const MICRO_FIELDS = [
  'vitamin_a_ug_rae',
  'vitamin_c_mg',
  'vitamin_d_ug',
  'vitamin_e_mg',
  'vitamin_k_ug',
  'vitamin_b6_mg',
  'vitamin_b12_ug',
  'folate_ug_dfe',
  'calcium_mg',
  'iron_mg',
  'magnesium_mg',
  'potassium_mg',
  'zinc_mg',
  'cholesterol_mg',
  'caffeine_mg',
];

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

describe('food analysis structured output format', () => {
  it('is a strict json_schema named food_analysis', () => {
    expect(FOOD_ANALYSIS_TEXT_FORMAT).toMatchObject({
      type: 'json_schema',
      name: 'food_analysis',
      strict: true,
    });
  });

  it('requires every property and forbids extra ones on every object', () => {
    const objects = objectNodes(FOOD_ANALYSIS_TEXT_FORMAT.schema);
    expect(objects.length).toBeGreaterThanOrEqual(5);
    for (const object of objects) {
      const properties = Object.keys(object.properties as SchemaNode);
      expect(object.additionalProperties).toBe(false);
      expect(object.required).toEqual(properties);
    }
  });

  it('avoids keywords strict mode rejects and nests nullable objects via anyOf', () => {
    const text = JSON.stringify(FOOD_ANALYSIS_TEXT_FORMAT.schema);
    expect(text).not.toMatch(/"(allOf|oneOf|not|\$ref|if|then|else)"/);
    const label = (
      (FOOD_ANALYSIS_TEXT_FORMAT.schema as SchemaNode).properties as SchemaNode
    ).label as SchemaNode;
    expect(label.anyOf).toEqual([
      expect.objectContaining({ type: 'object' }),
      { type: 'null' },
    ]);
  });

  it('keeps the generation order with grams before nutrient values', () => {
    const schema = FOOD_ANALYSIS_TEXT_FORMAT.schema as SchemaNode;
    const items = (schema.properties as SchemaNode).items as SchemaNode;
    const item = items.items as SchemaNode;
    expect(Object.keys(item.properties as SchemaNode)).toEqual([
      'name',
      'saved_food',
      'amount_source',
      'count',
      'unit',
      'unit_plural',
      'portion_basis',
      'state',
      'estimated_quantity_g',
      'fluid_ml',
      'per_100g',
      'micros_per_100g',
      'confidence',
    ]);
  });

  it('asks for every vitamin and mineral with its unit in the key and allows null', () => {
    const schema = FOOD_ANALYSIS_TEXT_FORMAT.schema as SchemaNode;
    const items = (schema.properties as SchemaNode).items as SchemaNode;
    const item = (items.items as SchemaNode).properties as SchemaNode;
    const micros = item.micros_per_100g as SchemaNode;
    expect(Object.keys(micros.properties as SchemaNode)).toEqual(MICRO_FIELDS);
    for (const value of Object.values(micros.properties as SchemaNode)) {
      expect(value).toMatchObject({ type: ['number', 'null'] });
    }
    expect(item.fluid_ml).toMatchObject({ type: ['number', 'null'] });
  });

  it('asks for printed vitamins and minerals on the label', () => {
    const schema = FOOD_ANALYSIS_TEXT_FORMAT.schema as SchemaNode;
    const label = ((schema.properties as SchemaNode).label as SchemaNode)
      .anyOf as SchemaNode[];
    const labelObject = label[0]?.properties as SchemaNode;
    const keys = Object.keys(labelObject);
    expect(keys.indexOf('micros_per_100')).toBe(keys.indexOf('per_100') + 1);
    expect(
      Object.keys(
        (labelObject.micros_per_100 as SchemaNode).properties as SchemaNode,
      ),
    ).toEqual(MICRO_FIELDS);
  });

  it('asks for the meal portion before the items and allows null', () => {
    const schema = FOOD_ANALYSIS_TEXT_FORMAT.schema as SchemaNode;
    const properties = schema.properties as SchemaNode;
    const keys = Object.keys(properties);
    expect(keys.indexOf('portion')).toBe(keys.indexOf('meal_name') + 1);
    expect(keys.indexOf('portion')).toBeLessThan(keys.indexOf('items'));
    expect((properties.portion as SchemaNode).anyOf).toEqual([
      expect.objectContaining({
        type: 'object',
        required: ['count', 'unit', 'unit_plural'],
        additionalProperties: false,
      }),
      { type: 'null' },
    ]);
  });

  it('asks for the saved food right after the name and allows null', () => {
    const schema = FOOD_ANALYSIS_TEXT_FORMAT.schema as SchemaNode;
    const items = (schema.properties as SchemaNode).items as SchemaNode;
    const item = (items.items as SchemaNode).properties as SchemaNode;
    expect(item.saved_food).toMatchObject({ type: ['string', 'null'] });
  });

  it('makes item counts nullable', () => {
    const schema = FOOD_ANALYSIS_TEXT_FORMAT.schema as SchemaNode;
    const items = (schema.properties as SchemaNode).items as SchemaNode;
    const item = (items.items as SchemaNode).properties as SchemaNode;
    expect(item.count).toMatchObject({ type: ['number', 'null'] });
    expect(item.unit).toMatchObject({ type: ['string', 'null'] });
    expect(item.unit_plural).toMatchObject({ type: ['string', 'null'] });
  });
});

describe('parseFoodAnalysisJson', () => {
  const valid = {
    input_type: 'text',
    meal_name: 'Apple',
    portion: { count: 1, unit: 'apple', unit_plural: 'apples' },
    scale_cues: 'none',
    items: [],
    label: null,
    assumptions: [],
    follow_up_question: null,
    follow_up_options: [],
  };

  it('accepts output that matches the schema', () => {
    expect(parseFoodAnalysisJson(JSON.stringify(valid))).toEqual({
      ok: true,
      data: valid,
    });
  });

  it('reports invalid JSON and schema violations', () => {
    expect(parseFoodAnalysisJson('{')).toEqual({
      ok: false,
      error: 'Model output is not valid JSON',
    });
    const missing = parseFoodAnalysisJson(
      JSON.stringify({ ...valid, follow_up_options: undefined }),
    );
    expect(missing.ok).toBe(false);
    const noPortion = parseFoodAnalysisJson(
      JSON.stringify({ ...valid, portion: undefined }),
    );
    expect(noPortion.ok).toBe(false);
  });
});
