import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import {
  CATALOG_SOURCES,
  type CatalogGroup,
  type CatalogPortion,
  type CatalogSource,
  isCatalogGroup,
  isFiniteNumber,
  type Micros,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  type NutrientKey,
  type Nutrients,
  sanitizeMicrosPer100,
} from '@food/shared';

export const CATALOG_PORTIONS_MAX = 8;
const NAME_MAX = 300;
const LABEL_MAX = 120;
const PORTION_GRAMS_MAX = 5000;

export interface CatalogFileFood {
  id: number;
  source: CatalogSource;
  name: string;
  category: string;
  group: CatalogGroup;
  per100: Nutrients;
  missing: NutrientKey[];
  microsPer100: Micros | null;
  portions: CatalogPortion[];
}

export interface CatalogFile {
  version: string;
  source: string;
  license: string;
  foods: CatalogFileFood[];
  rejected: number;
}

export class CatalogFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogFileError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > max ? null : trimmed;
}

function parsePer100(value: unknown): Nutrients | null {
  if (!isRecord(value)) {
    return null;
  }
  const out = {} as Nutrients;
  for (const key of NUTRIENT_KEYS) {
    const amount = value[key];
    if (!isFiniteNumber(amount) || amount < 0 || amount > NUTRIENT_META[key].max) {
      return null;
    }
    out[key] = amount;
  }
  return out;
}

export function parseCatalogPortions(value: unknown): CatalogPortion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const portions: CatalogPortion[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const label = text(entry.label, LABEL_MAX);
    const grams = entry.grams;
    if (label && isFiniteNumber(grams) && grams > 0 && grams <= PORTION_GRAMS_MAX) {
      portions.push({ label, grams });
    }
    if (portions.length === CATALOG_PORTIONS_MAX) {
      break;
    }
  }
  return portions;
}

export function parseMissing(value: unknown): NutrientKey[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return NUTRIENT_KEYS.filter((key) => value.includes(key));
}

function parseFood(value: unknown): CatalogFileFood | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id } = value;
  const name = text(value.name, NAME_MAX);
  const category = text(value.category, NAME_MAX) ?? 'Other';
  const per100 = parsePer100(value.per100);
  const source = value.source;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !name ||
    !per100 ||
    !(CATALOG_SOURCES as readonly unknown[]).includes(source)
  ) {
    return null;
  }
  return {
    id,
    source: source as CatalogSource,
    name,
    category,
    group: isCatalogGroup(value.group) ? value.group : 'other',
    per100,
    missing: parseMissing(value.missing),
    microsPer100: sanitizeMicrosPer100(value.microsPer100),
    portions: parseCatalogPortions(value.portions),
  };
}

export function parseCatalogFile(raw: unknown): CatalogFile {
  if (!isRecord(raw) || !Array.isArray(raw.foods)) {
    throw new CatalogFileError('The food catalog file has no foods list');
  }
  const version = text(raw.version, 100);
  if (!version) {
    throw new CatalogFileError('The food catalog file has no version');
  }
  const seen = new Set<number>();
  const foods: CatalogFileFood[] = [];
  let rejected = 0;
  for (const entry of raw.foods) {
    const food = parseFood(entry);
    if (!food || seen.has(food.id)) {
      rejected += 1;
      continue;
    }
    seen.add(food.id);
    foods.push(food);
  }
  return {
    version,
    source: text(raw.source, 300) ?? 'Unknown source',
    license: text(raw.license, 300) ?? 'Unknown license',
    foods,
    rejected,
  };
}

export async function readCatalogFile(path: string): Promise<CatalogFile> {
  const compressed = await readFile(path);
  const json = path.endsWith('.gz') ? gunzipSync(compressed).toString('utf8') : compressed.toString('utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new CatalogFileError(`The food catalog file ${path} is not valid JSON`);
  }
  return parseCatalogFile(raw);
}
