export const PORTION_COUNT_MAX = 100;
export const PORTION_UNIT_MAX = 40;

export interface Portion {
  count: number;
  unit: string;
  unitPlural: string;
}

const FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '0';
  }
  const whole = Math.floor(count + 1e-9);
  const rest = count - whole;
  if (rest < 0.02) {
    return String(whole);
  }
  const fraction = FRACTIONS.find(([value]) => Math.abs(rest - value) < 0.02);
  if (fraction) {
    return whole === 0 ? fraction[1] : `${whole}${fraction[1]}`;
  }
  return String(Math.round(count * 10) / 10);
}

export function pluralizeUnit(unit: string): string {
  const word = unit.trim();
  if (word === '') {
    return word;
  }
  const lower = word.toLowerCase();
  if (/(s|x|z|ch|sh)$/.test(lower)) {
    return `${word}es`;
  }
  if (/[^aeiou]y$/.test(lower)) {
    return `${word.slice(0, -1)}ies`;
  }
  return `${word}s`;
}

export function portionUnitFor(portion: Pick<Portion, 'unit' | 'unitPlural'>, count: number): string {
  return count > 1 + 1e-9 ? portion.unitPlural || pluralizeUnit(portion.unit) : portion.unit;
}

export function formatPortion(portion: Portion): string {
  return `${formatCount(portion.count)} ${portionUnitFor(portion, portion.count)}`;
}

export function scalePortion(portion: Portion, factor: number): Portion {
  const safe = Number.isFinite(factor) && factor > 0 ? factor : 0;
  return { ...portion, count: Math.round(portion.count * safe * 100) / 100 };
}

export function portionFactor(from: Pick<Portion, 'count'>, toCount: number): number {
  if (!Number.isFinite(from.count) || from.count <= 0 || !Number.isFinite(toCount) || toCount <= 0) {
    return 0;
  }
  return toCount / from.count;
}

export function isValidPortion(value: unknown): value is Portion {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  return (
    typeof p['count'] === 'number' &&
    Number.isFinite(p['count']) &&
    p['count'] > 0 &&
    p['count'] <= PORTION_COUNT_MAX &&
    typeof p['unit'] === 'string' &&
    p['unit'].trim().length > 0 &&
    p['unit'].length <= PORTION_UNIT_MAX &&
    typeof p['unitPlural'] === 'string' &&
    p['unitPlural'].trim().length > 0 &&
    p['unitPlural'].length <= PORTION_UNIT_MAX
  );
}
