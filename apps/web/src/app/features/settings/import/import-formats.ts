import {
  API_LIMITS,
  BODY_BOUNDS,
  FLUID_KINDS,
  FLUID_LIMITS,
  MAX_ITEM_GRAMS,
  MEAL_TYPES,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  PORTION_COUNT_MAX,
  PORTION_UNIT_MAX,
  isValidLocalDate,
  isValidPortion,
  pluralizeUnit,
  roundTo,
  sanitizeMicros,
  sanitizeNutrients,
  zeroNutrients,
  type EntryItemInput,
  type FluidKind,
  type ImportEntryInput,
  type ImportFluidInput,
  type ImportSource,
  type MealType,
  type Micros,
  type MicroKey,
  type NutrientKey,
  type Nutrients,
} from '@food/shared';
import { csvTable, type CsvTable } from './csv';

export type WeightUnit = 'kg' | 'lb';

export interface RawWeight {
  date: string;
  value: number;
  bodyFatPct: number | null;
}

export interface ImportPlan {
  source: ImportSource;
  label: string;
  entries: ImportEntryInput[];
  weights: RawWeight[];
  weightUnit: WeightUnit | null;
  fluids: ImportFluidInput[];
  trainingDays: string[];
  firstDate: string | null;
  lastDate: string | null;
  skippedRows: number;
}

export const KG_PER_LB = 0.45359237;
export const UNKNOWN_FILE_MESSAGE =
  'This file is not one FoodLog can import. Use a FoodLog export, a Cronometer “Food & Recipe Entries” or biometrics export, a MyFitnessPal nutrition or measurement summary, or a CSV with date and weight columns.';

const DEFAULT_TIMES: Record<MealType, string> = {
  breakfast: '08:00',
  lunch: '13:00',
  snack: '16:00',
  dinner: '20:00',
};

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i;

export function parseImportDate(value: string): string | null {
  const text = value.trim();
  const iso = ISO_DATE.exec(text);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidLocalDate(date) ? date : null;
  }
  const us = US_DATE.exec(text);
  if (us) {
    const date = `${us[3]}-${(us[1] ?? '').padStart(2, '0')}-${(us[2] ?? '').padStart(2, '0')}`;
    return isValidLocalDate(date) ? date : null;
  }
  return null;
}

export function parseImportTime(value: string | undefined): string | null {
  const match = TIME.exec((value ?? '').trim());
  if (!match) {
    return null;
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '');
  if (meridiem === 'pm' && hours < 12) {
    hours += 12;
  } else if (meridiem === 'am' && hours === 12) {
    hours = 0;
  }
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function localTimestamp(localDate: string, time: string): string {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

export function mealTypeFrom(label: string, time: string | null = null): MealType {
  const text = label.toLowerCase();
  if (/breakfast|morning/.test(text)) {
    return 'breakfast';
  }
  if (/lunch|midday/.test(text)) {
    return 'lunch';
  }
  if (/dinner|supper|evening/.test(text)) {
    return 'dinner';
  }
  if (/snack/.test(text) || !time) {
    return 'snack';
  }
  const hour = Number(time.slice(0, 2));
  return hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
}

function number(value: string | undefined): number {
  const parsed = Number((value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clampNutrients(nutrients: Nutrients): Nutrients {
  const out = sanitizeNutrients(nutrients);
  for (const key of NUTRIENT_KEYS) {
    out[key] = roundTo(Math.min(out[key], NUTRIENT_META[key].max), NUTRIENT_META[key].decimals);
  }
  return out;
}

function shortName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  return trimmed.slice(0, API_LIMITS.nameMax).trim() || 'Imported food';
}

export function entryNameFor(items: readonly EntryItemInput[], fallback: string): string {
  const names = items.map((item) => item.name);
  if (names.length === 1) {
    return shortName(names[0] ?? fallback);
  }
  if (names.length === 2) {
    return shortName(`${names[0]} and ${names[1]}`);
  }
  if (names.length > 2) {
    return shortName(`${names[0]}, ${names[1]} and ${names.length - 2} more`);
  }
  return shortName(fallback);
}

function findHeader(table: CsvTable, pattern: RegExp): string | null {
  return table.headers.find((header) => pattern.test(header)) ?? null;
}

function hasHeaders(table: CsvTable, names: readonly string[]): boolean {
  const lower = new Set(table.headers.map((header) => header.toLowerCase()));
  return names.every((name) => lower.has(name.toLowerCase()));
}

function dateSpan(dates: readonly string[]): { firstDate: string | null; lastDate: string | null } {
  const sorted = [...dates].sort();
  return { firstDate: sorted[0] ?? null, lastDate: sorted[sorted.length - 1] ?? null };
}

function plan(partial: Partial<ImportPlan> & Pick<ImportPlan, 'source' | 'label'>): ImportPlan {
  const entries = partial.entries ?? [];
  const weights = partial.weights ?? [];
  const fluids = partial.fluids ?? [];
  return {
    entries,
    weights,
    weightUnit: partial.weightUnit ?? null,
    fluids,
    trainingDays: partial.trainingDays ?? [],
    skippedRows: partial.skippedRows ?? 0,
    ...dateSpan([
      ...entries.map((entry) => entry.localDate),
      ...weights.map((weight) => weight.date),
      ...fluids.map((fluid) => fluid.localDate),
    ]),
    source: partial.source,
    label: partial.label,
  };
}

const CRONOMETER_NUTRIENTS: Partial<Record<NutrientKey, string>> = {
  calories: 'Energy (kcal)',
  protein: 'Protein (g)',
  carbs: 'Carbs (g)',
  fat: 'Fat (g)',
  satFat: 'Saturated (g)',
  fiber: 'Fiber (g)',
  sugar: 'Sugars (g)',
  sodium: 'Sodium (mg)',
  alcohol: 'Alcohol (g)',
};

const CRONOMETER_MICROS: Partial<Record<MicroKey, [string, number]>> = {
  vitaminC: ['Vitamin C (mg)', 1],
  vitaminD: ['Vitamin D (IU)', 1 / 40],
  vitaminE: ['Vitamin E (mg)', 1],
  vitaminK: ['Vitamin K (µg)', 1],
  vitaminB6: ['B6 (Pyridoxine) (mg)', 1],
  vitaminB12: ['B12 (Cobalamin) (µg)', 1],
  folate: ['Folate (µg)', 1],
  calcium: ['Calcium (mg)', 1],
  iron: ['Iron (mg)', 1],
  magnesium: ['Magnesium (mg)', 1],
  potassium: ['Potassium (mg)', 1],
  zinc: ['Zinc (mg)', 1],
  cholesterol: ['Cholesterol (mg)', 1],
  caffeine: ['Caffeine (mg)', 1],
};

function cronometerAmount(
  value: string,
): Pick<EntryItemInput, 'grams' | 'count' | 'unit' | 'unitPlural'> {
  const match = /^([\d.,]+)\s*(.*)$/.exec(value.trim());
  const quantity = match ? number(match[1]) : 0;
  const unit = (match?.[2] ?? '').trim().toLowerCase();
  if (quantity > 0 && /^(g|gram|grams)$/.test(unit)) {
    return {
      grams: roundTo(Math.min(quantity, MAX_ITEM_GRAMS), 1),
      count: null,
      unit: null,
      unitPlural: null,
    };
  }
  const portion = { count: roundTo(quantity, 2), unit, unitPlural: pluralizeUnit(unit) };
  return isValidPortion(portion) &&
    portion.count <= PORTION_COUNT_MAX &&
    unit.length <= PORTION_UNIT_MAX
    ? { grams: 0, ...portion }
    : { grams: 0, count: null, unit: null, unitPlural: null };
}

function cronometerItem(row: Record<string, string>): EntryItemInput {
  const nutrients = zeroNutrients();
  for (const [key, header] of Object.entries(CRONOMETER_NUTRIENTS) as [NutrientKey, string][]) {
    nutrients[key] = number(row[header]);
  }
  const micros: Micros = {};
  for (const [key, [header, factor]] of Object.entries(CRONOMETER_MICROS) as [
    MicroKey,
    [string, number],
  ][]) {
    const value = row[header];
    if (value !== undefined && value.trim() !== '') {
      micros[key] = roundTo(number(value) * factor, 2);
    }
  }
  return {
    name: shortName(row['Food Name'] ?? ''),
    ...cronometerAmount(row['Amount'] ?? ''),
    nutrients: clampNutrients(nutrients),
    confidence: null,
    micros: sanitizeMicros(micros),
  };
}

export function cronometerServings(table: CsvTable): ImportPlan {
  const groups = new Map<
    string,
    { date: string; group: string; time: string | null; items: EntryItemInput[] }
  >();
  let skippedRows = 0;
  for (const row of table.rows) {
    const date = parseImportDate(row['Day'] ?? '');
    if (!date || !(row['Food Name'] ?? '').trim()) {
      skippedRows++;
      continue;
    }
    const group = (row['Group'] ?? '').trim() || 'Uncategorized';
    const key = `${date}|${group}`;
    const time = parseImportTime(row['Time']);
    const current = groups.get(key) ?? { date, group, time, items: [] };
    if (time && (!current.time || time < current.time)) {
      current.time = time;
    }
    if (current.items.length < API_LIMITS.itemsMax) {
      current.items.push(cronometerItem(row));
    }
    groups.set(key, current);
  }
  const entries = [...groups.values()].map((group) => {
    const mealType = mealTypeFrom(group.group, group.time);
    const time = group.time ?? DEFAULT_TIMES[mealType];
    return {
      name: entryNameFor(group.items, group.group),
      mealType,
      timestamp: localTimestamp(group.date, time),
      localDate: group.date,
      items: group.items,
    };
  });
  return plan({ source: 'cronometer', label: 'Cronometer food log', entries, skippedRows });
}

export function cronometerBiometrics(table: CsvTable): ImportPlan {
  const byDate = new Map<string, RawWeight>();
  let unit: WeightUnit | null = null;
  let skippedRows = 0;
  for (const row of table.rows) {
    const date = parseImportDate(row['Day'] ?? '');
    const metric = (row['Metric'] ?? '').toLowerCase();
    const amount = number(row['Amount']);
    if (!date || amount <= 0) {
      skippedRows++;
      continue;
    }
    const current = byDate.get(date) ?? { date, value: 0, bodyFatPct: null };
    if (/weight/.test(metric)) {
      current.value = amount;
      unit = /lb/i.test(row['Unit'] ?? '') ? 'lb' : 'kg';
    } else if (/body ?fat/.test(metric)) {
      current.bodyFatPct = amount;
    } else {
      continue;
    }
    byDate.set(date, current);
  }
  return plan({
    source: 'cronometer',
    label: 'Cronometer biometrics',
    weights: [...byDate.values()].filter((weight) => weight.value > 0),
    weightUnit: unit,
    skippedRows,
  });
}

const MFP_COLUMNS: Array<[NutrientKey, RegExp]> = [
  ['calories', /^calories/i],
  ['fat', /^fat\b/i],
  ['satFat', /^saturated fat/i],
  ['sodium', /^sodium/i],
  ['carbs', /^carbohydrates/i],
  ['fiber', /^fiber/i],
  ['sugar', /^sugar/i],
  ['protein', /^protein/i],
];

export function myFitnessPalNutrition(table: CsvTable): ImportPlan {
  const columns = MFP_COLUMNS.map(([key, pattern]) => [key, findHeader(table, pattern)] as const);
  const cholesterol = findHeader(table, /^cholesterol/i);
  const potassium = findHeader(table, /^potassium/i);
  const timeHeader = findHeader(table, /^time$/i);
  const noteHeader = findHeader(table, /^note/i);
  const entries: ImportEntryInput[] = [];
  let skippedRows = 0;
  for (const row of table.rows) {
    const date = parseImportDate(row['Date'] ?? '');
    const meal = (row['Meal'] ?? '').trim() || 'Meal';
    if (!date) {
      skippedRows++;
      continue;
    }
    const nutrients = zeroNutrients();
    for (const [key, header] of columns) {
      if (header) {
        nutrients[key] = number(row[header]);
      }
    }
    const time = parseImportTime(timeHeader ? row[timeHeader] : undefined);
    const mealType = mealTypeFrom(meal, time);
    const micros = sanitizeMicros({
      ...(cholesterol ? { cholesterol: number(row[cholesterol]) } : {}),
      ...(potassium ? { potassium: number(row[potassium]) } : {}),
    });
    entries.push({
      name: shortName(meal),
      description: noteHeader
        ? (row[noteHeader] ?? '').slice(0, API_LIMITS.descriptionMax) || null
        : null,
      mealType,
      timestamp: localTimestamp(date, time ?? DEFAULT_TIMES[mealType]),
      localDate: date,
      items: [
        {
          name: shortName(`${meal} (MyFitnessPal)`),
          grams: 0,
          nutrients: clampNutrients(nutrients),
          confidence: null,
          micros,
        },
      ],
    });
  }
  return plan({
    source: 'myfitnesspal',
    label: 'MyFitnessPal nutrition summary',
    entries,
    skippedRows,
  });
}

export function weightTable(table: CsvTable, source: ImportSource, label: string): ImportPlan {
  const dateHeader = findHeader(table, /^(date|day)$/i);
  const weightHeader = findHeader(table, /^weight/i);
  const fatHeader = findHeader(table, /body ?fat/i);
  if (!dateHeader || !weightHeader) {
    return plan({ source, label });
  }
  const unit: WeightUnit | null = /\b(lb|lbs|pounds?)\b/i.test(weightHeader)
    ? 'lb'
    : /\bkg\b|kilo/i.test(weightHeader)
      ? 'kg'
      : null;
  const byDate = new Map<string, RawWeight>();
  let skippedRows = 0;
  for (const row of table.rows) {
    const date = parseImportDate(row[dateHeader] ?? '');
    const value = number(row[weightHeader]);
    if (!date || value <= 0) {
      skippedRows++;
      continue;
    }
    const fat = fatHeader ? number(row[fatHeader]) : 0;
    byDate.set(date, { date, value, bodyFatPct: fat > 0 ? fat : null });
  }
  return plan({ source, label, weights: [...byDate.values()], weightUnit: unit, skippedRows });
}

const FOODLOG_CSV_NUTRIENTS: Record<NutrientKey, string> = {
  calories: 'calories',
  protein: 'protein_g',
  carbs: 'carbs_g',
  fat: 'fat_g',
  satFat: 'sat_fat_g',
  fiber: 'fiber_g',
  sugar: 'sugar_g',
  sodium: 'sodium_mg',
  alcohol: 'alcohol_g',
};

export function foodLogCsv(table: CsvTable): ImportPlan {
  const groups = new Map<string, { row: Record<string, string>; items: EntryItemInput[] }>();
  let skippedRows = 0;
  for (const row of table.rows) {
    const id = row['entry_id'] ?? '';
    if (!id || !parseImportDate(row['date'] ?? '')) {
      skippedRows++;
      continue;
    }
    const nutrients = zeroNutrients();
    for (const key of NUTRIENT_KEYS) {
      nutrients[key] = number(row[FOODLOG_CSV_NUTRIENTS[key]]);
    }
    const confidence = row['confidence'];
    const group = groups.get(id) ?? { row, items: [] };
    if (group.items.length < API_LIMITS.itemsMax) {
      group.items.push({
        name: shortName(row['item_name'] ?? ''),
        grams: roundTo(Math.min(number(row['grams']), MAX_ITEM_GRAMS), 1),
        nutrients: clampNutrients(nutrients),
        confidence:
          confidence === 'low' || confidence === 'medium' || confidence === 'high'
            ? confidence
            : null,
      });
    }
    groups.set(id, group);
  }
  const entries = [...groups.values()].map(({ row, items }) => {
    const date = parseImportDate(row['date'] ?? '') ?? '';
    const mealType = (MEAL_TYPES as readonly string[]).includes(row['meal_type'] ?? '')
      ? (row['meal_type'] as MealType)
      : 'snack';
    return {
      name: shortName(row['entry_name'] ?? ''),
      description: (row['description'] ?? '').slice(0, API_LIMITS.descriptionMax) || null,
      mealType,
      timestamp: localTimestamp(date, parseImportTime(row['time']) ?? DEFAULT_TIMES[mealType]),
      localDate: date,
      items,
    };
  });
  return plan({ source: 'foodlog', label: 'FoodLog CSV export', entries, skippedRows });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonItem(value: unknown): EntryItemInput | null {
  if (!isRecord(value) || typeof value['name'] !== 'string') {
    return null;
  }
  const portion = {
    count: value['count'],
    unit: value['unit'],
    unitPlural: value['unitPlural'],
  };
  const counted = isValidPortion(portion);
  const confidence = value['confidence'];
  const fluidMl = value['fluidMl'];
  return {
    name: shortName(value['name']),
    grams: roundTo(Math.min(number(String(value['grams'] ?? 0)), MAX_ITEM_GRAMS), 1),
    nutrients: clampNutrients(
      sanitizeNutrients(isRecord(value['nutrients']) ? value['nutrients'] : null),
    ),
    confidence:
      confidence === 'low' || confidence === 'medium' || confidence === 'high' ? confidence : null,
    count: counted ? portion.count : null,
    unit: counted ? portion.unit : null,
    unitPlural: counted ? portion.unitPlural : null,
    micros: sanitizeMicros(value['micros']),
    fluidMl:
      typeof fluidMl === 'number' && fluidMl > 0
        ? Math.min(fluidMl, FLUID_LIMITS.logMaxMl * 10)
        : null,
  };
}

function jsonEntry(value: unknown): ImportEntryInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const { name, mealType, timestamp, localDate, description, portion } = value;
  const items = Array.isArray(value['items'])
    ? value['items'].map(jsonItem).filter((item): item is EntryItemInput => item !== null)
    : [];
  if (
    typeof name !== 'string' ||
    !(MEAL_TYPES as readonly unknown[]).includes(mealType) ||
    typeof timestamp !== 'string' ||
    Number.isNaN(Date.parse(timestamp)) ||
    !isValidLocalDate(localDate) ||
    items.length === 0
  ) {
    return null;
  }
  return {
    name: shortName(name),
    description:
      typeof description === 'string' ? description.slice(0, API_LIMITS.descriptionMax) : null,
    mealType: mealType as MealType,
    timestamp: new Date(timestamp).toISOString(),
    localDate,
    items: items.slice(0, API_LIMITS.itemsMax),
    portion: isValidPortion(portion) ? portion : null,
  };
}

export function foodLogJson(data: Record<string, unknown>): ImportPlan {
  const rawEntries = Array.isArray(data['entries']) ? data['entries'] : [];
  const entries = rawEntries
    .map(jsonEntry)
    .filter((entry): entry is ImportEntryInput => entry !== null);
  const weights = (Array.isArray(data['weights']) ? data['weights'] : []).flatMap(
    (value): RawWeight[] =>
      isRecord(value) &&
      isValidLocalDate(value['date']) &&
      typeof value['weightKg'] === 'number' &&
      value['weightKg'] >= BODY_BOUNDS.weightKg.min &&
      value['weightKg'] <= BODY_BOUNDS.weightKg.max
        ? [
            {
              date: value['date'],
              value: value['weightKg'],
              bodyFatPct: typeof value['bodyFatPct'] === 'number' ? value['bodyFatPct'] : null,
            },
          ]
        : [],
  );
  const fluids = (Array.isArray(data['fluids']) ? data['fluids'] : []).flatMap(
    (value): ImportFluidInput[] =>
      isRecord(value) &&
      isValidLocalDate(value['localDate']) &&
      typeof value['timestamp'] === 'string' &&
      !Number.isNaN(Date.parse(value['timestamp'])) &&
      typeof value['ml'] === 'number' &&
      value['ml'] >= FLUID_LIMITS.logMinMl &&
      value['ml'] <= FLUID_LIMITS.logMaxMl &&
      (FLUID_KINDS as readonly unknown[]).includes(value['kind'])
        ? [
            {
              localDate: value['localDate'],
              timestamp: new Date(value['timestamp']).toISOString(),
              ml: value['ml'],
              kind: value['kind'] as FluidKind,
            },
          ]
        : [],
  );
  const trainingDays = (Array.isArray(data['days']) ? data['days'] : []).flatMap(
    (value): string[] =>
      isRecord(value) && value['trainingDay'] === true && isValidLocalDate(value['date'])
        ? [value['date']]
        : [],
  );
  return plan({
    source: 'foodlog',
    label: 'FoodLog backup',
    entries,
    weights,
    weightUnit: 'kg',
    fluids,
    trainingDays,
    skippedRows: rawEntries.length - entries.length,
  });
}

export function detectImport(fileName: string, text: string): ImportPlan | null {
  const trimmed = text.trim();
  if (/\.json$/i.test(fileName) || trimmed.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(trimmed);
      return isRecord(data) && Array.isArray(data['entries']) ? foodLogJson(data) : null;
    } catch {
      return null;
    }
  }
  const table = csvTable(text);
  if (!table) {
    return null;
  }
  if (hasHeaders(table, ['entry_id', 'entry_name', 'item_name'])) {
    return foodLogCsv(table);
  }
  if (hasHeaders(table, ['Day', 'Food Name', 'Energy (kcal)'])) {
    return cronometerServings(table);
  }
  if (hasHeaders(table, ['Day', 'Metric', 'Amount'])) {
    return cronometerBiometrics(table);
  }
  if (hasHeaders(table, ['Date', 'Meal', 'Calories'])) {
    return myFitnessPalNutrition(table);
  }
  if (findHeader(table, /^(date|day)$/i) && findHeader(table, /^weight/i)) {
    const fromMfp = /measurement/i.test(fileName);
    return weightTable(
      table,
      fromMfp ? 'myfitnesspal' : 'csv',
      fromMfp ? 'MyFitnessPal measurements' : 'Weight log',
    );
  }
  return null;
}

export function weightsInKg(plan: ImportPlan, unit: WeightUnit) {
  const factor = (plan.weightUnit ?? unit) === 'lb' ? KG_PER_LB : 1;
  return plan.weights
    .map((weight) => ({
      date: weight.date,
      weightKg: roundTo(weight.value * factor, 2),
      bodyFatPct:
        weight.bodyFatPct !== null &&
        weight.bodyFatPct >= BODY_BOUNDS.bodyFatPct.min &&
        weight.bodyFatPct <= BODY_BOUNDS.bodyFatPct.max
          ? weight.bodyFatPct
          : null,
    }))
    .filter(
      (weight) =>
        weight.weightKg >= BODY_BOUNDS.weightKg.min && weight.weightKg <= BODY_BOUNDS.weightKg.max,
    );
}
