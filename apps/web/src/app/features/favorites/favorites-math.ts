import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  isFiniteNumber,
  roundNutrients,
  roundTo,
  sanitizeNutrients,
  scaleNutrients,
  sumNutrients,
  type EntryItemInput,
  type FavoriteDto,
  type Nutrients,
  type Portion,
} from '@food/shared';
import { localDateOf, localDateTimeToIso } from '../../core/time';
import { validateItems, type DraftItem } from '../../shared/ui/items-editor/items-math';
import { formatNumber } from '../../shared/utils/format';
import { COUNT_MIN, clampCount } from '../../shared/utils/portion';

export const SERVINGS_MIN = 0.25;
export const SERVINGS_MAX = 5;
export const SERVINGS_STEP = 0.25;
export const SERVINGS_PRESETS: readonly number[] = [0.5, 1, 1.5, 2];

export type FavoriteSort = 'most-used' | 'name';

export interface LogMoment {
  timestamp: string;
  localDate: string;
}

const FRACTION_GLYPHS: Readonly<Record<string, string>> = {
  '0.25': '¼',
  '0.5': '½',
  '0.75': '¾',
};

const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function headroom(value: number, limit: number): number {
  return isFiniteNumber(value) && value > 0 ? limit / value : Number.POSITIVE_INFINITY;
}

export function servingsLimit(items: readonly EntryItemInput[]): number {
  let limit: number = SERVINGS_MAX;
  for (const item of items) {
    limit = Math.min(limit, headroom(item.grams, MAX_ITEM_GRAMS));
    for (const key of NUTRIENT_KEYS) {
      limit = Math.min(limit, headroom(item.nutrients[key], NUTRIENT_META[key].max));
    }
  }
  return Math.max(SERVINGS_MIN, Math.floor(limit / SERVINGS_STEP) * SERVINGS_STEP);
}

export function clampServings(value: number, max: number = SERVINGS_MAX): number {
  if (!isFiniteNumber(value)) {
    return Math.min(1, max);
  }
  const snapped = roundTo(Math.round(value / SERVINGS_STEP) * SERVINGS_STEP, 2);
  return Math.min(max, Math.max(SERVINGS_MIN, snapped));
}

export function stepServings(value: number, direction: 1 | -1, max: number = SERVINGS_MAX): number {
  return clampServings(clampServings(value, max) + direction * SERVINGS_STEP, max);
}

export function formatServings(value: number): string {
  const whole = Math.floor(value);
  const fraction = roundTo(value - whole, 2);
  if (fraction === 0) {
    return String(whole);
  }
  const glyph = FRACTION_GLYPHS[String(fraction)];
  if (!glyph) {
    return formatNumber(value, 2);
  }
  return whole === 0 ? glyph : `${whole}${glyph}`;
}

export function servingsLabel(value: number): string {
  return `${formatServings(value)} ${value === 1 ? 'serving' : 'servings'}`;
}

export function unitsForServings(servings: number, portion: Pick<Portion, 'count'>): number {
  return roundTo(servings * portion.count, 2);
}

export function minUnits(portion: Pick<Portion, 'count'>): number {
  const floor = API_LIMITS.favoriteServingsMin * portion.count;
  return Math.max(COUNT_MIN, roundTo(Math.ceil(floor / COUNT_MIN - 1e-9) * COUNT_MIN, 2));
}

export function servingsForUnits(
  units: number,
  portion: Pick<Portion, 'count'>,
  max: number = SERVINGS_MAX,
): number {
  const lower = minUnits(portion);
  const upper = Math.max(lower, roundTo(max * portion.count, 2));
  const clamped = Math.min(upper, Math.max(lower, clampCount(units)));
  return roundTo(clamped / portion.count, 4);
}

export function scaledItemTotals(items: readonly EntryItemInput[], servings: number): Nutrients {
  const scaled = items.map((item) =>
    roundNutrients(sanitizeNutrients(scaleNutrients(item.nutrients, servings))),
  );
  return roundNutrients(sumNutrients(scaled));
}

export function momentAt(date: Date): LogMoment {
  return { timestamp: date.toISOString(), localDate: localDateOf(date) };
}

export function momentFromDateTimeLocal(value: string): LogMoment | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value.trim());
  if (!match) {
    return null;
  }
  const localDate = match[1];
  const timestamp = localDateTimeToIso(localDate, match[2]);
  return timestamp ? { timestamp, localDate } : null;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function filterFavorites(list: readonly FavoriteDto[], query: string): FavoriteDto[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [...list];
  }
  return list.filter((favorite) => {
    const haystack = fold([favorite.name, ...favorite.items.map((item) => item.name)].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
}

export function sortFavorites(list: readonly FavoriteDto[], sort: FavoriteSort): FavoriteDto[] {
  if (sort === 'most-used') {
    return [...list];
  }
  return [...list].sort((a, b) => nameCollator.compare(a.name, b.name));
}

export function recordUse(favorite: FavoriteDto, at: string): FavoriteDto {
  return { ...favorite, useCount: favorite.useCount + 1, lastUsedAt: at };
}

export function upsertFavorite(list: readonly FavoriteDto[], favorite: FavoriteDto): FavoriteDto[] {
  const index = list.findIndex((item) => item.id === favorite.id);
  if (index < 0) {
    return [favorite, ...list];
  }
  const next = [...list];
  next[index] = favorite;
  return next;
}

export function useCountLabel(count: number): string {
  if (count <= 0) {
    return 'Not logged yet';
  }
  return count === 1 ? 'Logged once' : `Logged ${formatNumber(count)} times`;
}

export function validateFavoriteDraft(name: string, items: readonly DraftItem[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Give this favorite a name.';
  }
  if (trimmed.length > API_LIMITS.nameMax) {
    return `The name can be at most ${API_LIMITS.nameMax} characters.`;
  }
  return validateItems(items);
}
