import type { AnalysisMode, ImageRole } from '@food/shared';
import { FoodAnalysisSchema } from '../food-analysis.schema.js';
import { normalizeAnalysis } from '../normalize.js';
import type { AnalysisPromptInput, FollowUpKind } from '../prompt.js';
import { MOCK_NOTICE, mockAnalysis } from './mock-analysis.js';
import { MockProvider } from './mock.provider.js';

const NATURAL_ROLES: Record<AnalysisMode, ImageRole[]> = {
  food_photo: ['food'],
  nutrition_label: ['label'],
  text: [],
};

function prompt(overrides: Partial<AnalysisPromptInput>): AnalysisPromptInput {
  const mode = overrides.mode ?? 'text';
  return {
    mode,
    imageRoles: NATURAL_ROLES[mode],
    description: null,
    localTime: null,
    mealType: null,
    location: null,
    answeredQuestions: [],
    followUp: null,
    ...overrides,
  };
}

function itemsOf(input: AnalysisPromptInput): [string, number, string][] {
  return mockAnalysis(input).items.map((item) => [
    item.name,
    item.estimated_quantity_g,
    item.amount_source,
  ]);
}

function followUp(
  previousInput: AnalysisPromptInput,
  answer: string,
  kind: FollowUpKind = 'answer',
) {
  const previous = normalizeAnalysis(mockAnalysis(previousInput), {
    mode: previousInput.mode,
  });
  return mockAnalysis({
    ...previousInput,
    followUp: {
      previous: {
        mealName: previous.mealName,
        items: previous.items.map((item) => ({
          name: item.name,
          grams: item.grams,
          calories: item.nutrients.calories,
        })),
        totalCalories: previous.totals.calories,
        question: previous.followUpQuestion,
      },
      answer,
      kind,
    },
  });
}

describe('mockAnalysis', () => {
  it('reads stated grams and counts from the description', () => {
    expect(
      itemsOf(prompt({ description: '150g chicken, 2 eggs and rice' })),
    ).toEqual([
      ['Chicken breast, grilled', 150, 'user_stated'],
      ['Eggs, whole', 100, 'user_stated'],
      ['White rice, cooked', 180, 'typical_serving'],
    ]);
  });

  it('splits a burger into editable parts with the sauce as a hidden item and asks about the patty', () => {
    const result = mockAnalysis(prompt({ description: 'a burger' }));
    expect(result.items.map((item) => item.name)).toEqual([
      'Beef patty 80/20, grilled',
      'Burger bun',
      'Cheddar cheese slice',
      'Ketchup and mayo',
    ]);
    expect(result.items[3]?.amount_source).toBe('assumed_hidden');
    expect(result.follow_up_question).toBe('How big was the patty?');
    expect(result.meal_name).toBe('Cheeseburger');
  });

  it('counts the burgers of the description as the meal portion', () => {
    const two = normalizeAnalysis(
      mockAnalysis(prompt({ description: '2 black angus burgers' })),
      { mode: 'text' },
    );

    expect(two.portion).toEqual({
      count: 2,
      unit: 'burger',
      unitPlural: 'burgers',
    });
    expect(
      two.items.map(({ name, grams, count, unit }) => [
        name,
        grams,
        count,
        unit,
      ]),
    ).toEqual([
      ['Beef patty 80/20, grilled', 180, 2, 'patty'],
      ['Burger bun', 110, 2, 'bun'],
      ['Cheddar cheese slice', 40, 2, 'slice'],
      ['Ketchup and mayo', 30, null, null],
    ]);
  });

  it.each([
    ['1½ burgers', 1.5],
    ['1.5 burgers', 1.5],
    ['½ burger', 0.5],
    ['half a burger', 0.5],
    ['a cheeseburger', 1],
    ['burger', 1],
  ])('reads %j as %d burgers', (description, count) => {
    const result = mockAnalysis(prompt({ description }));

    expect(result.portion).toEqual({
      count,
      unit: 'burger',
      unit_plural: 'burgers',
    });
    expect(result.items[0]?.count).toBe(count);
  });

  it('has no meal portion for mixed or weighed meals but keeps item counts', () => {
    const mixed = mockAnalysis(
      prompt({ description: '150g chicken, 2 eggs and rice' }),
    );
    expect(mixed.portion).toBeNull();
    expect(mixed.items.map((item) => item.count)).toEqual([null, 2, null]);
    expect(
      mockAnalysis(prompt({ description: '300 g burger' })).portion,
    ).toBeNull();
    expect(mockAnalysis(prompt({ mode: 'food_photo' })).portion).toBeNull();
    expect(
      mockAnalysis(prompt({ mode: 'nutrition_label' })).portion,
    ).toBeNull();
  });

  it('halves the portion when the answer says half was eaten', () => {
    const halved = followUp(
      prompt({ description: '2 black angus burgers' }),
      'I only ate half',
    );
    const resized = followUp(
      prompt({ description: '2 black angus burgers' }),
      'Large (~150 g)',
    );

    expect(halved.portion?.count).toBe(1);
    expect(halved.items[0]).toMatchObject({
      count: 1,
      estimated_quantity_g: 90,
    });
    expect(resized.portion?.count).toBe(2);
    expect(resized.items[0]?.count).toBe(2);
  });

  it('adds cooking oil when the description says fried', () => {
    const names = itemsOf(prompt({ description: '2 fried eggs' })).map(
      ([name]) => name,
    );
    expect(names).toEqual(['Eggs, whole', 'Olive oil for cooking']);
  });

  it('returns a plausible plate with hidden oil and a follow-up for an undescribed photo', () => {
    const result = mockAnalysis(prompt({ mode: 'food_photo' }));
    expect(result.items).toHaveLength(4);
    expect(
      result.items.some((item) => item.amount_source === 'assumed_hidden'),
    ).toBe(true);
    expect(result.follow_up_question).toBe('How was the chicken cooked?');
    expect(result.follow_up_options.length).toBeGreaterThanOrEqual(2);
    expect(result.scale_cues).not.toBe('none');
  });

  it('applies a correction but keeps the open question', () => {
    const photo = prompt({ mode: 'food_photo' });

    const corrected = followUp(photo, 'Pan-fried in oil', 'correction');

    expect(
      corrected.items.find((item) => item.name.includes('oil'))
        ?.estimated_quantity_g,
    ).toBe(15);
    expect(corrected.follow_up_question).toBe('How was the chicken cooked?');
  });

  it('changes the estimate according to follow-up answers', () => {
    const photo = prompt({ mode: 'food_photo' });
    const oil = (answer: string): number | undefined =>
      followUp(photo, answer).items.find((item) => item.name.includes('oil'))
        ?.estimated_quantity_g;

    expect(oil('Pan-fried in oil')).toBe(15);
    expect(oil('Grilled, no oil')).toBeUndefined();
    const deepFried = followUp(photo, 'Deep-fried, breaded');
    expect(deepFried.items[0]?.name).toBe(
      'Chicken breast, breaded and deep-fried',
    );
    expect(deepFried.follow_up_question).toBeNull();
    expect(deepFried.assumptions).toContain(
      'Applied your answer: "Deep-fried, breaded"',
    );

    const text = prompt({ description: 'chicken and rice' });
    expect(
      followUp(text, 'it was fried').items.map((item) => item.name),
    ).toContain('Olive oil for cooking');
    expect(
      followUp(prompt({ description: 'burger' }), 'Large (~150 g)').items[0],
    ).toMatchObject({
      estimated_quantity_g: 150,
      amount_source: 'user_stated',
    });
    expect(
      followUp(prompt({ description: 'protein shake' }), 'Water').items.map(
        (i) => i.name,
      ),
    ).toEqual(['Whey protein powder']);
  });

  it('keeps applying earlier answers on re-runs and chained follow-ups', () => {
    const photo = prompt({
      mode: 'food_photo',
      answeredQuestions: [
        { question: 'How was the chicken cooked?', answer: 'Pan-fried in oil' },
      ],
    });
    const rerun = mockAnalysis(photo);
    expect(
      rerun.items.find((item) => item.name === 'Olive oil for cooking')
        ?.estimated_quantity_g,
    ).toBe(15);
    expect(rerun.follow_up_question).toBeNull();

    const chained = followUp(photo, 'Large portion');
    expect(chained.items[0]?.estimated_quantity_g).toBe(225);
    expect(
      chained.items.some((item) => item.name === 'Olive oil for cooking'),
    ).toBe(true);
  });

  it('reads a nutrition label and logs one serving', () => {
    const result = mockAnalysis(prompt({ mode: 'nutrition_label' }));
    expect(result.label).toMatchObject({
      basis_unit: 'g',
      serving_size: 30,
      pack_size: 500,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      estimated_quantity_g: 30,
      amount_source: 'label',
    });
    const twoServings = followUp(
      prompt({ mode: 'nutrition_label' }),
      'Two servings (60 g)',
    );
    expect(twoServings.items[0]?.estimated_quantity_g).toBe(60);
    expect(
      mockAnalysis(prompt({ mode: 'nutrition_label', description: 'ate 45 g' }))
        .items[0],
    ).toMatchObject({ estimated_quantity_g: 45, amount_source: 'user_stated' });
  });

  it('reads the packaging label when a label photo accompanies the food photo', () => {
    const result = mockAnalysis(
      prompt({
        mode: 'food_photo',
        imageRoles: ['food', 'label'],
        description: 'Khoury yogurt',
      }),
    );
    expect(result.label).toMatchObject({
      product_name: 'Strawberry yogurt',
      serving_size: 120,
      per_100: expect.objectContaining({ calories: 96, protein_g: 3.5 }),
    });
    expect(result.items).toEqual([
      expect.objectContaining({
        name: 'Strawberry yogurt',
        estimated_quantity_g: 120,
        amount_source: 'visual_estimate',
        per_100g: expect.objectContaining({ calories: 96 }),
      }),
    ]);
    expect(result.follow_up_question).toBeNull();

    const stated = mockAnalysis(
      prompt({
        mode: 'food_photo',
        imageRoles: ['food', 'label'],
        description: '150 g yogurt',
      }),
    );
    expect(stated.items[0]).toMatchObject({
      estimated_quantity_g: 150,
      amount_source: 'user_stated',
    });
  });

  it('asks for the amount when only a label photo is attached', () => {
    const result = mockAnalysis(
      prompt({ mode: 'food_photo', imageRoles: ['label'] }),
    );
    expect(result.items[0]).toMatchObject({
      name: 'Strawberry yogurt',
      amount_source: 'label',
    });
    expect(result.follow_up_question).toBe('How much did you eat?');
    expect(
      followUp(
        prompt({ mode: 'food_photo', imageRoles: ['label'] }),
        'Two cups (240 g)',
      ).items[0]?.estimated_quantity_g,
    ).toBe(240);
    expect(
      mockAnalysis(
        prompt({ mode: 'nutrition_label', imageRoles: ['label', 'food'] }),
      ).items[0],
    ).toMatchObject({
      name: 'Oat & honey granola',
      amount_source: 'visual_estimate',
    });
  });

  it('falls back to a generic dish and to an empty result', () => {
    const generic = mockAnalysis(
      prompt({ description: 'grandma special stew' }),
    );
    expect(generic.items[0]?.name).toBe('grandma special stew');
    expect(generic.follow_up_options).toEqual(['Small', 'Medium', 'Large']);

    const empty = mockAnalysis(prompt({ description: 'nothing really' }));
    expect(empty.items).toEqual([]);
    expect(empty.follow_up_question).toBe('What did you eat?');
  });

  it('always produces schema-valid, consistent output', () => {
    const inputs: AnalysisPromptInput[] = [
      prompt({
        description: 'beer, salad, salmon, banana, apple, toast, oats, pasta',
      }),
      prompt({ mode: 'food_photo' }),
      prompt({ mode: 'nutrition_label' }),
      prompt({ mode: 'food_photo', imageRoles: ['food', 'label'] }),
      prompt({ mode: 'food_photo', imageRoles: ['label'] }),
      prompt({ mode: 'nutrition_label', imageRoles: ['label', 'food'] }),
      prompt({ description: 'protein shake with whole milk' }),
      prompt({ description: 'chicken burger meal with a diet pepsi' }),
      prompt({ description: "Doctor's Best Vitamin D3 125 mcg softgel" }),
      prompt({ description: 'glass of water, coffee and soy milk' }),
    ];
    for (const input of inputs) {
      const raw = mockAnalysis(input);
      expect(FoodAnalysisSchema.safeParse(raw).success).toBe(true);
      expect(raw.assumptions[0]).toBe(MOCK_NOTICE);
      expect(normalizeAnalysis(raw, { mode: input.mode }).warnings).toEqual([]);
    }
  });
});

describe('mockAnalysis vitamins, minerals and drinks', () => {
  function normalized(description: string) {
    return normalizeAnalysis(mockAnalysis(prompt({ description })), {
      mode: 'text',
    });
  }

  it('estimates micros for every item and counts the diet soda as a drink', () => {
    const result = normalized('chicken burger meal with a diet pepsi');

    expect(
      result.items.map(({ name, grams, fluidMl }) => [name, grams, fluidMl]),
    ).toEqual([
      ['Crispy chicken fillet, breaded and fried', 110, null],
      ['Burger bun', 55, null],
      ['Lettuce, shredded', 15, null],
      ['Mayonnaise', 15, null],
      ['Diet Pepsi', 330, 330],
    ]);
    expect(result.items.every((item) => item.micros !== null)).toBe(true);
    expect(result.items[4]).toMatchObject({
      count: 1,
      unit: 'can',
      nutrients: { calories: 0 },
      micros: { caffeine: 35 },
    });
    expect(result.mealName).toBe('Chicken burger & Diet Pepsi');
  });

  it('logs a vitamin D3 softgel with 125 µg per softgel', () => {
    const result = normalized("Doctor's Best Vitamin D3 125 mcg softgel");

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      grams: 1,
      count: 1,
      unit: 'softgel',
      micros: { vitaminD: 125 },
      fluidMl: null,
    });
    expect(result.totals.calories).toBe(0);
  });

  it('counts water as a drink without calories', () => {
    const result = normalized('glass of water');

    expect(result.items).toEqual([
      expect.objectContaining({
        name: 'Water',
        grams: 250,
        fluidMl: 250,
        nutrients: expect.objectContaining({ calories: 0 }),
      }),
    ]);
  });

  it('gives a red apple micros but no fluid', () => {
    const result = normalized('red apple');

    expect(result.items[0]).toMatchObject({
      grams: 180,
      fluidMl: null,
      micros: { vitaminC: 8, potassium: 193 },
    });
  });

  it('keeps the fluid in step with the grams when an answer resizes a drink', () => {
    const half = followUp(prompt({ description: 'protein shake' }), 'half');

    expect(
      half.items.map(({ name, estimated_quantity_g, fluid_ml }) => [
        name,
        estimated_quantity_g,
        fluid_ml,
      ]),
    ).toEqual([
      ['Whey protein powder', 15, null],
      ['Semi-skimmed milk', 125, 125],
    ]);
  });
});

describe('MockProvider', () => {
  it('returns zero-latency deterministic results with realistic token usage', async () => {
    const provider = new MockProvider({ latencyMs: 0 });
    const request = {
      model: 'gpt-5.6-sol',
      images: [
        { dataUrl: 'data:image/jpeg;base64,xx', detail: 'high' as const },
      ],
      prompt: prompt({ mode: 'food_photo' }),
    };
    const first = await provider.analyze(request);
    const second = await provider.analyze(request);
    expect(first.raw).toEqual(second.raw);
    expect(first.model).toBe('mock');
    expect(first.usage.inputTokens).toBeGreaterThan(2000);
    expect(first.usage.outputTokens).toBeGreaterThan(
      first.usage.reasoningTokens,
    );
    expect(first.usage.cachedInputTokens).toBe(0);
  });

  it('counts the tokens of every attached image', async () => {
    const provider = new MockProvider({ latencyMs: 0 });
    const image = { dataUrl: 'data:image/jpeg;base64,xx' };
    const single = await provider.analyze({
      model: 'gpt-5.6-sol',
      images: [{ ...image, detail: 'high' }],
      prompt: prompt({ mode: 'food_photo', imageRoles: ['food'] }),
    });
    const both = await provider.analyze({
      model: 'gpt-5.6-sol',
      images: [
        { ...image, detail: 'high' },
        { ...image, detail: 'low' },
      ],
      prompt: prompt({ mode: 'food_photo', imageRoles: ['food'] }),
    });
    expect(both.usage.inputTokens - single.usage.inputTokens).toBe(231);
  });
});
