import {
  type EntryDto,
  type EntryItemDto,
  NUTRIENT_META,
  type NutrientKey,
  type Nutrients,
  roundTo,
} from '@food/shared';
import { type CsvValue, toCsv } from './csv.js';

export const EXPORT_CSV_COLUMNS = [
  'date',
  'time',
  'meal_type',
  'entry_name',
  'item_name',
  'grams',
  'calories',
  'protein_g',
  'carbs_g',
  'fat_g',
  'sat_fat_g',
  'fiber_g',
  'sugar_g',
  'sodium_mg',
  'alcohol_g',
  'confidence',
  'source',
  'description',
  'entry_id',
] as const;

const NUTRIENT_COLUMN_ORDER: readonly NutrientKey[] = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'satFat',
  'fiber',
  'sugar',
  'sodium',
  'alcohol',
];

function nutrientCells(nutrients: Nutrients): number[] {
  return NUTRIENT_COLUMN_ORDER.map((key) =>
    roundTo(nutrients[key], NUTRIENT_META[key].decimals),
  );
}

function csvRowFor(entry: EntryDto, item: EntryItemDto | null): CsvValue[] {
  return [
    entry.localDate,
    entry.timestamp,
    entry.mealType,
    entry.name,
    item?.name ?? '',
    item ? item.grams : null,
    ...nutrientCells(item ? item.nutrients : entry.totals),
    item?.confidence ?? '',
    entry.source,
    entry.description ?? '',
    entry.id,
  ];
}

export function entryCsvRows(entry: EntryDto): CsvValue[][] {
  if (entry.items.length === 0) {
    return [csvRowFor(entry, null)];
  }
  return entry.items.map((item) => csvRowFor(entry, item));
}

export function buildEntriesCsv(entries: readonly EntryDto[]): string {
  return toCsv([EXPORT_CSV_COLUMNS, ...entries.flatMap(entryCsvRows)]);
}
