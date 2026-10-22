import type {
  AmountSource,
  Confidence,
  FoodState,
  MicroKey,
  Micros,
} from '@food/shared';
import type {
  FoodMicroValues,
  FoodNutrientValues,
} from '../food-analysis.schema.js';

export type MockUnit = readonly [singular: string, plural: string];

export interface MockComponent {
  key: string;
  name: string;
  state: FoodState;
  grams: number;
  per100: FoodNutrientValues;
  micros: FoodMicroValues;
  drink?: boolean;
  amountSource?: AmountSource;
  confidence?: Confidence;
  unit?: MockUnit;
}

export interface MockFollowUp {
  question: string;
  options: string[];
}

export interface MockFood {
  title: string;
  pattern: RegExp;
  components: MockComponent[];
  followUp?: MockFollowUp;
  unit?: MockUnit;
}

export function per100(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  satFat: number,
  fiber: number,
  sugar: number,
  sodium: number,
  alcohol = 0,
): FoodNutrientValues {
  return {
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    saturated_fat_g: satFat,
    fiber_g: fiber,
    sugar_g: sugar,
    sodium_mg: sodium,
    alcohol_g: alcohol,
  };
}

function microValues(values: Micros, missing: number | null): FoodMicroValues {
  const value = (key: MicroKey): number | null => values[key] ?? missing;
  return {
    vitamin_a_ug_rae: value('vitaminA'),
    vitamin_c_mg: value('vitaminC'),
    vitamin_d_ug: value('vitaminD'),
    vitamin_e_mg: value('vitaminE'),
    vitamin_k_ug: value('vitaminK'),
    vitamin_b6_mg: value('vitaminB6'),
    vitamin_b12_ug: value('vitaminB12'),
    folate_ug_dfe: value('folate'),
    calcium_mg: value('calcium'),
    iron_mg: value('iron'),
    magnesium_mg: value('magnesium'),
    potassium_mg: value('potassium'),
    zinc_mg: value('zinc'),
    cholesterol_mg: value('cholesterol'),
    caffeine_mg: value('caffeine'),
  };
}

export function micros100(values: Micros): FoodMicroValues {
  return microValues(values, 0);
}

export function printedMicros(values: Micros): FoodMicroValues {
  return microValues(values, null);
}

export const OLIVE_OIL: MockComponent = {
  key: 'oil',
  name: 'Olive oil for cooking',
  state: 'as_served',
  grams: 10,
  per100: per100(884, 0, 0, 100, 13.8, 0, 0, 2),
  micros: micros100({
    vitaminE: 14.4,
    vitaminK: 60.2,
    calcium: 1,
    iron: 0.6,
    potassium: 1,
  }),
  amountSource: 'assumed_hidden',
  confidence: 'low',
};

export const BUTTER: MockComponent = {
  key: 'oil',
  name: 'Butter for cooking',
  state: 'as_served',
  grams: 10,
  per100: per100(717, 0.9, 0.1, 81.1, 51.4, 0, 0.1, 643),
  micros: micros100({
    vitaminA: 684,
    vitaminD: 1.5,
    vitaminE: 2.3,
    vitaminK: 7,
    vitaminB12: 0.17,
    folate: 3,
    calcium: 24,
    magnesium: 2,
    potassium: 24,
    zinc: 0.1,
    cholesterol: 215,
  }),
  amountSource: 'assumed_hidden',
  confidence: 'low',
};

export const FRIED_BREADED_CHICKEN = per100(
  260,
  24,
  10,
  13.5,
  2.5,
  0.5,
  0.3,
  450,
);
export const FRIED_BREADED_CHICKEN_MICROS = micros100({
  vitaminA: 10,
  vitaminD: 0.2,
  vitaminE: 1.5,
  vitaminK: 10,
  vitaminB6: 0.5,
  vitaminB12: 0.3,
  folate: 15,
  calcium: 20,
  iron: 1.2,
  magnesium: 26,
  potassium: 240,
  zinc: 1,
  cholesterol: 80,
});
export const WHOLE_MILK = per100(61, 3.2, 4.8, 3.3, 1.9, 0, 5.1, 43);
export const WHOLE_MILK_MICROS = micros100({
  vitaminA: 46,
  vitaminD: 1.3,
  vitaminE: 0.1,
  vitaminK: 0.3,
  vitaminB6: 0.04,
  vitaminB12: 0.45,
  folate: 5,
  calcium: 113,
  magnesium: 10,
  potassium: 132,
  zinc: 0.4,
  cholesterol: 10,
});
export const OAT_DRINK = per100(46, 1, 6.7, 1.5, 0.2, 0.8, 4, 40);
export const OAT_DRINK_MICROS = micros100({
  vitaminD: 1.1,
  vitaminE: 0.4,
  vitaminK: 0.2,
  vitaminB6: 0.02,
  vitaminB12: 0.38,
  folate: 5,
  calcium: 120,
  iron: 0.3,
  magnesium: 7,
  potassium: 150,
  zinc: 0.1,
});

const CHICKEN: MockComponent = {
  key: 'chicken',
  name: 'Chicken breast, grilled',
  state: 'cooked',
  grams: 150,
  per100: per100(165, 31, 0, 3.6, 1, 0, 0, 74),
  micros: micros100({
    vitaminA: 9,
    vitaminD: 0.1,
    vitaminE: 0.3,
    vitaminK: 0.3,
    vitaminB6: 0.6,
    vitaminB12: 0.34,
    folate: 4,
    calcium: 15,
    iron: 1,
    magnesium: 29,
    potassium: 256,
    zinc: 1,
    cholesterol: 85,
  }),
};

const RICE: MockComponent = {
  key: 'rice',
  name: 'White rice, cooked',
  state: 'cooked',
  grams: 180,
  per100: per100(130, 2.7, 28.2, 0.3, 0.1, 0.4, 0.1, 1),
  micros: micros100({
    vitaminE: 0.04,
    vitaminB6: 0.09,
    folate: 58,
    calcium: 10,
    iron: 0.2,
    magnesium: 12,
    potassium: 35,
    zinc: 0.5,
  }),
};

export const MOCK_FOODS: readonly MockFood[] = [
  {
    title: 'Chicken burger',
    pattern: /\bchicken (?:burgers?|sandwich(?:es)?)\b/i,
    unit: ['burger', 'burgers'],
    components: [
      {
        key: 'chicken-fillet',
        name: 'Crispy chicken fillet, breaded and fried',
        state: 'cooked',
        grams: 110,
        per100: per100(260, 17, 14, 15, 2.5, 0.8, 0.5, 520),
        micros: micros100({
          vitaminA: 10,
          vitaminD: 0.2,
          vitaminE: 1.5,
          vitaminK: 10,
          vitaminB6: 0.45,
          vitaminB12: 0.3,
          folate: 20,
          calcium: 20,
          iron: 1.1,
          magnesium: 25,
          potassium: 250,
          zinc: 0.9,
          cholesterol: 60,
        }),
        unit: ['fillet', 'fillets'],
      },
      {
        key: 'bun',
        name: 'Burger bun',
        state: 'as_served',
        grams: 55,
        per100: per100(279, 9.8, 50.1, 3.9, 0.8, 1.8, 7.3, 494),
        micros: micros100({
          vitaminE: 0.2,
          vitaminK: 0.5,
          vitaminB6: 0.06,
          folate: 95,
          calcium: 140,
          iron: 3.3,
          magnesium: 20,
          potassium: 115,
          zinc: 0.7,
        }),
        unit: ['bun', 'buns'],
      },
      {
        key: 'lettuce',
        name: 'Lettuce, shredded',
        state: 'raw',
        grams: 15,
        per100: per100(15, 1.4, 2.9, 0.2, 0, 1.3, 0.8, 28),
        micros: micros100({
          vitaminA: 370,
          vitaminC: 9,
          vitaminE: 0.2,
          vitaminK: 126,
          vitaminB6: 0.09,
          folate: 38,
          calcium: 36,
          iron: 0.9,
          magnesium: 13,
          potassium: 194,
          zinc: 0.2,
        }),
      },
      {
        key: 'sauce',
        name: 'Mayonnaise',
        state: 'as_served',
        grams: 15,
        per100: per100(680, 1, 0.6, 75, 11.7, 0, 0.6, 635),
        micros: micros100({
          vitaminA: 20,
          vitaminD: 0.2,
          vitaminE: 4,
          vitaminK: 160,
          vitaminB12: 0.1,
          folate: 7,
          calcium: 8,
          iron: 0.2,
          magnesium: 1,
          potassium: 20,
          zinc: 0.1,
          cholesterol: 42,
        }),
        amountSource: 'assumed_hidden',
        confidence: 'low',
      },
    ],
  },
  {
    title: 'Chicken',
    pattern: /\bchicken\b/i,
    components: [CHICKEN],
  },
  {
    title: 'Eggs',
    pattern: /\beggs?\b/i,
    unit: ['egg', 'eggs'],
    components: [
      {
        key: 'egg',
        name: 'Eggs, whole',
        state: 'cooked',
        grams: 50,
        per100: per100(155, 12.6, 1.1, 10.6, 3.3, 0, 1.1, 124),
        micros: micros100({
          vitaminA: 149,
          vitaminD: 2.2,
          vitaminE: 1,
          vitaminK: 0.3,
          vitaminB6: 0.12,
          vitaminB12: 1.11,
          folate: 44,
          calcium: 50,
          iron: 1.2,
          magnesium: 10,
          potassium: 126,
          zinc: 1.1,
          cholesterol: 373,
        }),
        unit: ['egg', 'eggs'],
      },
    ],
  },
  { title: 'Rice', pattern: /\brice\b/i, components: [RICE] },
  {
    title: 'Pasta',
    pattern: /\b(pasta|spaghetti|penne|noodles)\b/i,
    components: [
      {
        key: 'pasta',
        name: 'Pasta, cooked',
        state: 'cooked',
        grams: 220,
        per100: per100(158, 5.8, 30.9, 0.9, 0.2, 1.8, 0.6, 1),
        micros: micros100({
          vitaminE: 0.06,
          vitaminK: 0.1,
          vitaminB6: 0.05,
          folate: 7,
          calcium: 7,
          iron: 0.5,
          magnesium: 18,
          potassium: 44,
          zinc: 0.5,
        }),
      },
    ],
  },
  {
    title: 'Cheeseburger',
    pattern: /\b(cheese)?burgers?\b|\bhamburgers?\b/i,
    unit: ['burger', 'burgers'],
    components: [
      {
        key: 'patty',
        name: 'Beef patty 80/20, grilled',
        state: 'cooked',
        grams: 90,
        per100: per100(270, 25.8, 0, 17.8, 6.8, 0, 0, 350),
        micros: micros100({
          vitaminD: 0.1,
          vitaminE: 0.2,
          vitaminK: 1,
          vitaminB6: 0.3,
          vitaminB12: 2.6,
          folate: 9,
          calcium: 24,
          iron: 2.6,
          magnesium: 21,
          potassium: 318,
          zinc: 6.3,
          cholesterol: 88,
        }),
        unit: ['patty', 'patties'],
      },
      {
        key: 'bun',
        name: 'Burger bun',
        state: 'as_served',
        grams: 55,
        per100: per100(279, 9.8, 50.1, 3.9, 0.8, 1.8, 7.3, 494),
        micros: micros100({
          vitaminE: 0.2,
          vitaminK: 0.5,
          vitaminB6: 0.06,
          folate: 95,
          calcium: 140,
          iron: 3.3,
          magnesium: 20,
          potassium: 115,
          zinc: 0.7,
        }),
        unit: ['bun', 'buns'],
      },
      {
        key: 'cheese',
        name: 'Cheddar cheese slice',
        state: 'as_served',
        grams: 20,
        per100: per100(403, 24.9, 1.3, 33.1, 18.9, 0, 0.5, 653),
        micros: micros100({
          vitaminA: 265,
          vitaminD: 0.6,
          vitaminE: 0.7,
          vitaminK: 2.4,
          vitaminB6: 0.07,
          vitaminB12: 1.1,
          folate: 27,
          calcium: 710,
          iron: 0.1,
          magnesium: 27,
          potassium: 76,
          zinc: 3.6,
          cholesterol: 99,
        }),
        unit: ['slice', 'slices'],
      },
      {
        key: 'sauce',
        name: 'Ketchup and mayo',
        state: 'as_served',
        grams: 15,
        per100: per100(391, 1, 14, 37.5, 5.9, 0.2, 10.9, 771),
        micros: micros100({
          vitaminA: 20,
          vitaminC: 2,
          vitaminD: 0.1,
          vitaminE: 2.5,
          vitaminK: 60,
          vitaminB6: 0.07,
          vitaminB12: 0.1,
          folate: 5,
          calcium: 10,
          iron: 0.2,
          magnesium: 6,
          potassium: 160,
          zinc: 0.1,
          cholesterol: 20,
        }),
        amountSource: 'assumed_hidden',
        confidence: 'low',
      },
    ],
    followUp: {
      question: 'How big was the patty?',
      options: ['Thin / smash (~60 g)', 'Regular (~90 g)', 'Large (~150 g)'],
    },
  },
  {
    title: 'Protein shake',
    pattern: /\bprotein shake\b|\bwhey\b|\bshake\b/i,
    components: [
      {
        key: 'whey',
        name: 'Whey protein powder',
        state: 'as_served',
        grams: 30,
        per100: per100(400, 80, 8, 6, 3, 0, 5, 300),
        micros: micros100({
          vitaminE: 0.4,
          vitaminB6: 0.3,
          vitaminB12: 1,
          folate: 10,
          calcium: 400,
          iron: 1,
          magnesium: 80,
          potassium: 600,
          zinc: 1.6,
          cholesterol: 100,
        }),
      },
      {
        key: 'milk',
        name: 'Semi-skimmed milk',
        state: 'as_served',
        grams: 250,
        per100: per100(50, 3.4, 4.8, 1.8, 1.1, 0, 5, 44),
        micros: micros100({
          vitaminA: 46,
          vitaminD: 1.1,
          vitaminE: 0.03,
          vitaminK: 0.1,
          vitaminB6: 0.04,
          vitaminB12: 0.47,
          folate: 5,
          calcium: 120,
          magnesium: 11,
          potassium: 150,
          zinc: 0.4,
          cholesterol: 8,
        }),
        drink: true,
        confidence: 'low',
      },
    ],
    followUp: {
      question: 'What was the shake mixed with?',
      options: ['Water', 'Semi-skimmed milk', 'Whole milk', 'Oat drink'],
    },
  },
  {
    title: 'Salmon',
    pattern: /\bsalmon\b/i,
    components: [
      {
        key: 'salmon',
        name: 'Salmon fillet, baked',
        state: 'cooked',
        grams: 140,
        per100: per100(206, 22.1, 0, 12.4, 2.5, 0, 0, 61),
        micros: micros100({
          vitaminA: 13,
          vitaminC: 3.7,
          vitaminD: 13.1,
          vitaminE: 1.9,
          vitaminK: 0.5,
          vitaminB6: 0.65,
          vitaminB12: 2.8,
          folate: 34,
          calcium: 15,
          iron: 0.3,
          magnesium: 30,
          potassium: 384,
          zinc: 0.4,
          cholesterol: 63,
        }),
      },
    ],
  },
  {
    title: 'Banana',
    pattern: /\bbananas?\b/i,
    unit: ['banana', 'bananas'],
    components: [
      {
        key: 'banana',
        name: 'Banana',
        state: 'raw',
        grams: 118,
        per100: per100(89, 1.1, 22.8, 0.3, 0.1, 2.6, 12.2, 1),
        micros: micros100({
          vitaminA: 3,
          vitaminC: 8.7,
          vitaminE: 0.1,
          vitaminK: 0.5,
          vitaminB6: 0.37,
          folate: 20,
          calcium: 5,
          iron: 0.3,
          magnesium: 27,
          potassium: 358,
          zinc: 0.2,
        }),
        unit: ['banana', 'bananas'],
      },
    ],
  },
  {
    title: 'Apple',
    pattern: /\bapples?\b/i,
    unit: ['apple', 'apples'],
    components: [
      {
        key: 'apple',
        name: 'Apple',
        state: 'raw',
        grams: 180,
        per100: per100(52, 0.3, 13.8, 0.2, 0, 2.4, 10.4, 1),
        micros: micros100({
          vitaminA: 3,
          vitaminC: 4.6,
          vitaminE: 0.18,
          vitaminK: 2.2,
          vitaminB6: 0.04,
          folate: 3,
          calcium: 6,
          iron: 0.1,
          magnesium: 5,
          potassium: 107,
          zinc: 0.04,
        }),
        unit: ['apple', 'apples'],
      },
    ],
  },
  {
    title: 'Bread',
    pattern: /\b(toast|bread)\b/i,
    unit: ['slice', 'slices'],
    components: [
      {
        key: 'bread',
        name: 'Wholemeal bread',
        state: 'as_served',
        grams: 40,
        per100: per100(247, 13, 41, 3.4, 0.7, 7, 6, 450),
        micros: micros100({
          vitaminE: 0.5,
          vitaminK: 7.8,
          vitaminB6: 0.2,
          folate: 42,
          calcium: 110,
          iron: 2.5,
          magnesium: 76,
          potassium: 250,
          zinc: 1.8,
        }),
        unit: ['slice', 'slices'],
      },
    ],
  },
  {
    title: 'Oats',
    pattern: /\b(oats|oatmeal|porridge)\b/i,
    components: [
      {
        key: 'oats',
        name: 'Rolled oats, dry',
        state: 'dry_uncooked',
        grams: 50,
        per100: per100(379, 13.2, 67.7, 6.5, 1.1, 10.1, 1, 6),
        micros: micros100({
          vitaminE: 0.4,
          vitaminK: 2,
          vitaminB6: 0.12,
          folate: 32,
          calcium: 52,
          iron: 4.3,
          magnesium: 138,
          potassium: 362,
          zinc: 3.6,
        }),
      },
    ],
  },
  {
    title: 'Beer',
    pattern: /\bbeers?\b/i,
    components: [
      {
        key: 'beer',
        name: 'Beer, regular',
        state: 'as_served',
        grams: 500,
        per100: per100(43, 0.5, 3.6, 0, 0, 0, 0, 4, 3.9),
        micros: micros100({
          vitaminB6: 0.05,
          vitaminB12: 0.02,
          folate: 6,
          calcium: 4,
          magnesium: 6,
          potassium: 27,
        }),
        drink: true,
      },
    ],
  },
  {
    title: 'Salad',
    pattern: /\bsalad\b/i,
    components: [
      {
        key: 'salad',
        name: 'Mixed green salad',
        state: 'raw',
        grams: 100,
        per100: per100(20, 1.5, 3.6, 0.2, 0, 1.8, 1.5, 30),
        micros: micros100({
          vitaminA: 250,
          vitaminC: 15,
          vitaminE: 0.5,
          vitaminK: 100,
          vitaminB6: 0.08,
          folate: 60,
          calcium: 40,
          iron: 1,
          magnesium: 15,
          potassium: 250,
          zinc: 0.3,
        }),
      },
      {
        key: 'dressing',
        name: 'Vinaigrette dressing',
        state: 'as_served',
        grams: 15,
        per100: per100(450, 0.2, 4, 48, 7, 0, 3.5, 800),
        micros: micros100({
          vitaminE: 3,
          vitaminK: 40,
          calcium: 5,
          iron: 0.2,
          magnesium: 1,
          potassium: 10,
          zinc: 0.05,
        }),
        amountSource: 'assumed_hidden',
        confidence: 'low',
      },
    ],
  },
  {
    title: 'Diet Pepsi',
    pattern: /\bdiet (?:pepsi|coke|cola)\b|\bpepsi max\b|\bcoke zero\b/i,
    unit: ['can', 'cans'],
    components: [
      {
        key: 'soda',
        name: 'Diet Pepsi',
        state: 'as_served',
        grams: 330,
        per100: per100(0, 0, 0, 0, 0, 0, 0, 10),
        micros: micros100({ calcium: 1, potassium: 11, caffeine: 10.6 }),
        drink: true,
        unit: ['can', 'cans'],
      },
    ],
  },
  {
    title: 'Vitamin D3',
    pattern: /\bvitamin d3?\b|\bd3\b/i,
    unit: ['softgel', 'softgels'],
    components: [
      {
        key: 'vitamin-d',
        name: 'Vitamin D3 125 mcg (5000 IU) softgel',
        state: 'as_served',
        grams: 1,
        per100: per100(0, 0, 0, 0, 0, 0, 0, 0),
        micros: micros100({ vitaminD: 12500 }),
        confidence: 'high',
        unit: ['softgel', 'softgels'],
      },
    ],
  },
  {
    title: 'Water',
    pattern: /\bwater\b/i,
    unit: ['glass', 'glasses'],
    components: [
      {
        key: 'water',
        name: 'Water',
        state: 'as_served',
        grams: 250,
        per100: per100(0, 0, 0, 0, 0, 0, 0, 0),
        micros: micros100({ calcium: 2, magnesium: 1 }),
        drink: true,
        unit: ['glass', 'glasses'],
      },
    ],
  },
  {
    title: 'Coffee',
    pattern: /\b(?:coffee|espresso|americano)\b/i,
    unit: ['cup', 'cups'],
    components: [
      {
        key: 'coffee',
        name: 'Coffee, black',
        state: 'as_served',
        grams: 240,
        per100: per100(1, 0.1, 0, 0, 0, 0, 0, 2),
        micros: micros100({
          vitaminK: 0.1,
          folate: 2,
          calcium: 2,
          magnesium: 3,
          potassium: 49,
          caffeine: 40,
        }),
        drink: true,
        unit: ['cup', 'cups'],
      },
    ],
  },
  {
    title: 'Soy milk',
    pattern: /\bsoya? ?(?:milk|drink)\b/i,
    components: [
      {
        key: 'soy-milk',
        name: 'Soy milk, fortified',
        state: 'as_served',
        grams: 250,
        per100: per100(54, 3.3, 6.3, 1.8, 0.2, 0.6, 4, 51),
        micros: micros100({
          vitaminA: 60,
          vitaminD: 1.1,
          vitaminE: 0.1,
          vitaminK: 3,
          vitaminB6: 0.08,
          vitaminB12: 0.38,
          folate: 9,
          calcium: 120,
          iron: 0.4,
          magnesium: 15,
          potassium: 120,
          zinc: 0.3,
        }),
        drink: true,
      },
    ],
  },
];

export const PHOTO_PLATE: readonly MockComponent[] = [
  { ...CHICKEN, amountSource: 'visual_estimate', confidence: 'medium' },
  { ...RICE, amountSource: 'visual_estimate', confidence: 'medium' },
  {
    key: 'broccoli',
    name: 'Broccoli, steamed',
    state: 'cooked',
    grams: 90,
    per100: per100(35, 2.4, 7.2, 0.4, 0.1, 3.3, 1.4, 41),
    micros: micros100({
      vitaminA: 77,
      vitaminC: 65,
      vitaminE: 1.5,
      vitaminK: 141,
      vitaminB6: 0.2,
      folate: 108,
      calcium: 40,
      iron: 0.7,
      magnesium: 21,
      potassium: 293,
      zinc: 0.5,
    }),
    amountSource: 'visual_estimate',
    confidence: 'medium',
  },
  OLIVE_OIL,
];

export const PHOTO_FOLLOW_UP: MockFollowUp = {
  question: 'How was the chicken cooked?',
  options: ['Grilled, no oil', 'Pan-fried in oil', 'Deep-fried, breaded'],
};

export const GENERIC_DISH: FoodNutrientValues = per100(
  160,
  7,
  18,
  6.5,
  2,
  2,
  3,
  380,
);

export const GENERIC_DISH_MICROS: FoodMicroValues = micros100({
  vitaminA: 40,
  vitaminC: 5,
  vitaminD: 0.2,
  vitaminE: 0.8,
  vitaminK: 10,
  vitaminB6: 0.15,
  vitaminB12: 0.3,
  folate: 20,
  calcium: 40,
  iron: 1.2,
  magnesium: 20,
  potassium: 220,
  zinc: 1,
  cholesterol: 25,
});

export const GENERIC_FOLLOW_UP: MockFollowUp = {
  question: 'Roughly how big was the portion?',
  options: ['Small', 'Medium', 'Large'],
};

export interface MockLabel {
  productName: string;
  per100: FoodNutrientValues;
  micros: FoodMicroValues;
  printedMicros: FoodMicroValues;
  servingSize: number;
  servingText: string;
  packSize: number;
  amountOptions: string[];
}

export const MOCK_LABEL: MockLabel = {
  productName: 'Oat & honey granola',
  per100: per100(450, 9, 64, 16, 3.5, 7, 22, 200),
  micros: micros100({
    vitaminE: 1.2,
    vitaminK: 3,
    vitaminB6: 0.15,
    folate: 35,
    calcium: 50,
    iron: 3.6,
    magnesium: 105,
    potassium: 380,
    zinc: 2.4,
  }),
  printedMicros: printedMicros({
    iron: 3.6,
    magnesium: 105,
    potassium: 380,
  }),
  servingSize: 30,
  servingText: '30 g (about 1/2 cup)',
  packSize: 500,
  amountOptions: [
    'One serving (30 g)',
    'Two servings (60 g)',
    'Half the pack (250 g)',
  ],
};

export const MOCK_PACKAGING_LABEL: MockLabel = {
  productName: 'Strawberry yogurt',
  per100: per100(96, 3.5, 13.8, 3, 1.9, 0.2, 12.5, 45),
  micros: micros100({
    vitaminA: 27,
    vitaminC: 1,
    vitaminD: 0.1,
    vitaminE: 0.05,
    vitaminK: 0.2,
    vitaminB6: 0.04,
    vitaminB12: 0.37,
    folate: 9,
    calcium: 120,
    iron: 0.05,
    magnesium: 12,
    potassium: 155,
    zinc: 0.6,
    cholesterol: 12,
  }),
  printedMicros: printedMicros({ calcium: 120 }),
  servingSize: 120,
  servingText: '1 cup (120 g)',
  packSize: 120,
  amountOptions: ['Half a cup (60 g)', 'One cup (120 g)', 'Two cups (240 g)'],
};
