import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const HELP = `Builds FoodLog's built-in food database from USDA FoodData Central JSON downloads
(https://fdc.nal.usda.gov/download-datasets, public domain under CC0 1.0).

Usage:
  npm run catalog:build -w @food/api -- --foundation <file> --sr <file> --survey <file> [--out <file>]

  --foundation  FoodData_Central_foundation_food_json_*.json
  --sr          FoodData_Central_sr_legacy_food_json_*.json
  --survey      surveyDownload.json from FoodData_Central_survey_food_json_*.zip (FNDDS)
  --out         output file (default: catalog/usda-foods.json.gz)`;

const API_ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_OUT = resolve(API_ROOT, 'catalog/usda-foods.json.gz');
const PORTIONS_MAX = 8;
const KJ_PER_KCAL = 4.184;
const IU_PER_UG_VITAMIN_D = 40;

const NUTRIENT_SOURCES = {
  calories: [[1008], [2047], [2048], [1062, 1 / KJ_PER_KCAL]],
  protein: [[1003]],
  carbs: [[1005], [1050]],
  fat: [[1004]],
  satFat: [[1258]],
  fiber: [[1079], [2033]],
  sugar: [[2000], [1063]],
  sodium: [[1093]],
  alcohol: [[1018]],
};

const MICRO_SOURCES = {
  vitaminA: [[1106]],
  vitaminC: [[1162]],
  vitaminD: [[1114], [1110, 1 / IU_PER_UG_VITAMIN_D]],
  vitaminE: [[1109]],
  vitaminK: [[1185]],
  vitaminB6: [[1175]],
  vitaminB12: [[1178]],
  folate: [[1190], [1177]],
  calcium: [[1087]],
  iron: [[1089]],
  magnesium: [[1090]],
  potassium: [[1092]],
  zinc: [[1095]],
  cholesterol: [[1253]],
  caffeine: [[1057]],
};

const DECIMALS = {
  calories: 0,
  sodium: 0,
  vitaminA: 0,
  vitaminK: 0,
  folate: 0,
  calcium: 0,
  magnesium: 0,
  potassium: 0,
  cholesterol: 0,
  caffeine: 0,
};

const SR_GROUPS = {
  'Beef Products': 'meat',
  'Pork Products': 'meat',
  'Lamb, Veal, and Game Products': 'meat',
  'Sausages and Luncheon Meats': 'meat',
  'Poultry Products': 'poultry',
  'Finfish and Shellfish Products': 'seafood',
  'Dairy and Egg Products': 'dairy_eggs',
  'Vegetables and Vegetable Products': 'vegetables',
  'Fruits and Fruit Juices': 'fruits',
  'Cereal Grains and Pasta': 'grains',
  'Baked Products': 'grains',
  'Breakfast Cereals': 'grains',
  'Legumes and Legume Products': 'legumes_nuts',
  'Nut and Seed Products': 'legumes_nuts',
  'Meals, Entrees, and Side Dishes': 'dishes',
  'Fast Foods': 'fast_food',
  'Restaurant Foods': 'fast_food',
  Sweets: 'snacks_sweets',
  Snacks: 'snacks_sweets',
  Beverages: 'drinks',
  'Fats and Oils': 'fats_oils',
  'Soups, Sauces, and Gravies': 'sauces_soups',
  'Spices and Herbs': 'herbs_spices',
  'Baby Foods': 'baby',
  'American Indian/Alaska Native Foods': 'other',
};

const SURVEY_GROUP_RULES = [
  [/^baby|formula|human milk/i, 'baby'],
  [/burgers|pizza|nachos|french fries|chicken patties|frankfurter sandwiches/i, 'fast_food'],
  [/soups|ramen/i, 'sauces_soups'],
  [/mixed dishes|stir-fry|fried rice|egg rolls|macaroni and cheese|legume dishes|vegetable dishes|mexican|burritos|sandwich|coleslaw|vegetables on a sandwich/i, 'dishes'],
  [/^milk, |^cheese$|cottage|cream cheese|yogurt|cream and cream|eggs and omelets/i, 'dairy_eggs'],
  [/water|coffee|^tea$|juice|soft drinks|sport and energy|diet drinks|fruit drinks|beer|wine|liquor|smoothies|nutritional beverages|milk shakes|plant-based milk|flavored milk|nutritional powders/i, 'drinks'],
  [/chicken|turkey|poultry/i, 'poultry'],
  [/fish|shellfish|seafood/i, 'seafood'],
  [/beef|pork|lamb|bacon|sausages|frankfurters|cold cuts|organ meats/i, 'meat'],
  [/butter|margarine|mayonnaise|dressings and vegetable oils/i, 'fats_oils'],
  [/chips|popcorn|pretzels|cereal bars|nutrition bars|cake|cookie|candy|doughnut|ice cream|pudding|gelatin|jams|sugars|sugar substitutes/i, 'snacks_sweets'],
  [/fruit|apple|banana|berries|citrus|grapes|mango|melon|peach|pear|pineapple|strawberr/i, 'fruits'],
  [/vegetable|broccoli|cabbage|carrot|corn$|lettuce|onion|spinach|string beans|tomatoes|potato|olives/i, 'vegetables'],
  [/beans, peas|nuts and seeds|soy and meat-alternative/i, 'legumes_nuts'],
  [/bread|bagels|biscuits|rolls and buns|tortillas|^rice$|pasta, noodles|grits|oatmeal|cereal|pancakes|crackers|turnovers/i, 'grains'],
  [/condiments|dips|sauces|gravies/i, 'sauces_soups'],
];

function fail(message) {
  console.error(`catalog:build: ${message}`);
  process.exit(1);
}

function readFoods(file, key) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const foods = data[key];
  if (!Array.isArray(foods)) {
    fail(`${file} has no "${key}" array`);
  }
  return foods.filter((food) => food && typeof food === 'object');
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function amountsById(food) {
  const amounts = new Map();
  for (const entry of food.foodNutrients ?? []) {
    const id = entry?.nutrient?.id;
    const amount = entry?.amount;
    if (typeof id === 'number' && typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
      amounts.set(id, amount);
    }
  }
  return amounts;
}

function pick(amounts, sources) {
  for (const [id, factor = 1] of sources) {
    if (amounts.has(id)) {
      return amounts.get(id) * factor;
    }
  }
  return null;
}

function extractNutrients(amounts) {
  const per100 = {};
  const missing = [];
  for (const [key, sources] of Object.entries(NUTRIENT_SOURCES)) {
    const value = pick(amounts, sources);
    if (value === null) {
      missing.push(key);
      per100[key] = 0;
    } else {
      per100[key] = round(value, DECIMALS[key] ?? 2);
    }
  }
  return { per100, missing };
}

function extractMicros(amounts) {
  const micros = {};
  for (const [key, sources] of Object.entries(MICRO_SOURCES)) {
    const value = pick(amounts, sources);
    if (value !== null) {
      micros[key] = round(value, DECIMALS[key] ?? 2);
    }
  }
  return Object.keys(micros).length > 0 ? micros : null;
}

function formatAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return '1';
  }
  return String(round(amount, 2));
}

function cleanLabel(label) {
  return label.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
}

function portionLabel(portion, dataset) {
  if (dataset === 'survey') {
    const description = (portion.portionDescription ?? '').trim();
    if (description === '' || /^guideline amount/i.test(description)) {
      return null;
    }
    if (/^quantity not specified$/i.test(description)) {
      return { label: '1 serving', isDefault: true };
    }
    return { label: cleanLabel(description), isDefault: false };
  }
  const unit = (portion.measureUnit?.name ?? '').trim();
  const modifier = (portion.modifier ?? '').trim();
  if (unit === 'RACC') {
    return { label: '1 serving', isDefault: true };
  }
  const amount = formatAmount(portion.amount ?? portion.value);
  if (unit === '' || unit === 'undetermined') {
    if (modifier === '' || /^\d+$/.test(modifier)) {
      return null;
    }
    return { label: cleanLabel(`${amount} ${modifier}`), isDefault: false };
  }
  const tail = modifier !== '' && !/^\d+$/.test(modifier) ? `, ${modifier}` : '';
  return { label: cleanLabel(`${amount} ${unit}${tail}`), isDefault: false };
}

function extractPortions(food, dataset) {
  const sorted = [...(food.foodPortions ?? [])].sort(
    (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
  );
  const seen = new Set();
  const portions = [];
  let defaultIndex = null;
  for (const portion of sorted) {
    const grams = portion.gramWeight;
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0 || grams > 5000) {
      continue;
    }
    const described = portionLabel(portion, dataset);
    if (!described) {
      continue;
    }
    const key = described.label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (described.isDefault && defaultIndex === null) {
      defaultIndex = portions.length;
    }
    portions.push({ label: described.label, grams: round(grams, 1) });
  }
  if (defaultIndex !== null && defaultIndex > 0) {
    const [preferred] = portions.splice(defaultIndex, 1);
    portions.unshift(preferred);
  }
  return portions.slice(0, PORTIONS_MAX);
}

function surveyGroup(category) {
  for (const [pattern, group] of SURVEY_GROUP_RULES) {
    if (pattern.test(category)) {
      return group;
    }
  }
  return 'other';
}

function normalizeName(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

function cleanName(description) {
  return description
    .replace(/\s*\(Includes foods for USDA's [^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCatalogFood(food, dataset) {
  const name = typeof food.description === 'string' ? cleanName(food.description) : '';
  if (name === '' || typeof food.fdcId !== 'number') {
    return null;
  }
  const amounts = amountsById(food);
  const { per100, missing } = extractNutrients(amounts);
  const coreMissing = ['calories', 'protein', 'carbs', 'fat'].filter((key) => missing.includes(key));
  if (coreMissing.length > 0) {
    return null;
  }
  const category =
    dataset === 'survey'
      ? (food.wweiaFoodCategory?.wweiaFoodCategoryDescription ?? 'Other')
      : (food.foodCategory?.description ?? 'Other');
  const group = dataset === 'survey' ? surveyGroup(category) : (SR_GROUPS[category] ?? 'other');
  return {
    id: food.fdcId,
    source: dataset,
    name,
    category: category === 'Not included in a food category' ? 'Other' : category,
    group,
    per100,
    missing: missing.filter((key) => key !== 'alcohol'),
    microsPer100: extractMicros(amounts),
    portions: extractPortions(food, dataset),
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      foundation: { type: 'string' },
      sr: { type: 'string' },
      survey: { type: 'string' },
      out: { type: 'string', default: DEFAULT_OUT },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values.foundation || !values.sr || !values.survey) {
    fail(`--foundation, --sr and --survey are required\n\n${HELP}`);
  }
  const inputs = [
    ['foundation', readFoods(values.foundation, 'FoundationFoods')],
    ['sr_legacy', readFoods(values.sr, 'SRLegacyFoods')],
    ['survey', readFoods(values.survey, 'SurveyFoods')],
  ];
  const byName = new Map();
  const skipped = { invalid: 0, duplicate: 0 };
  for (const [dataset, foods] of inputs) {
    for (const food of foods) {
      const item = toCatalogFood(food, dataset);
      if (!item) {
        skipped.invalid += 1;
        continue;
      }
      const key = normalizeName(item.name);
      if (byName.has(key)) {
        skipped.duplicate += 1;
        continue;
      }
      byName.set(key, item);
    }
  }
  const foods = [...byName.values()].sort((a, b) => a.id - b.id);
  const catalog = {
    version: 'usda-fdc-2026-04-30.1',
    source: 'USDA FoodData Central (Foundation Foods 2026-04, SR Legacy 2018-04, FNDDS 2021-2023)',
    license: 'CC0 1.0 Universal (public domain)',
    foods,
  };
  const json = JSON.stringify(catalog);
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, gzipSync(json, { level: 9 }));
  const groups = new Map();
  for (const food of foods) {
    groups.set(food.group, (groups.get(food.group) ?? 0) + 1);
  }
  console.log(
    `catalog:build: ${foods.length} foods (${skipped.invalid} incomplete, ${skipped.duplicate} duplicate names skipped) -> ${values.out}`,
  );
  console.log(
    [...groups].sort((a, b) => b[1] - a[1]).map(([group, count]) => `${group}: ${count}`).join(', '),
  );
}

main();
