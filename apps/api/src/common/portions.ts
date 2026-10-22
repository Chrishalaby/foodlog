import {
  isFiniteNumber,
  isValidPortion,
  pluralizeUnit,
  type Portion,
  PORTION_COUNT_MAX,
  PORTION_UNIT_MAX,
  roundTo,
  scalePortion,
} from '@food/shared';

export const PORTION_COUNT_MIN = 0.01;

const COUNT_DECIMALS = 2;

export interface PortionColumns {
  portionCount: number | null;
  portionUnit: string | null;
  portionUnitPlural: string | null;
}

export interface ItemCount {
  count: number | null;
  unit: string | null;
  unitPlural: string | null;
}

export interface ItemCountInput {
  count?: number | null;
  unit?: string | null;
  unitPlural?: string | null;
}

const NO_ITEM_COUNT: ItemCount = {
  count: null,
  unit: null,
  unitPlural: null,
};

const NO_PORTION_COLUMNS: PortionColumns = {
  portionCount: null,
  portionUnit: null,
  portionUnitPlural: null,
};

function cleanUnit(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, PORTION_UNIT_MAX).trim();
}

export function toPortion(
  count: unknown,
  unit: unknown,
  unitPlural: unknown,
): Portion | null {
  const singular = cleanUnit(unit);
  if (!isFiniteNumber(count) || count <= 0 || singular === '') {
    return null;
  }
  const portion: Portion = {
    count: roundTo(count, COUNT_DECIMALS),
    unit: singular,
    unitPlural: cleanUnit(unitPlural) || cleanUnit(pluralizeUnit(singular)),
  };
  return isValidPortion(portion) ? portion : null;
}

function normalizePortion(portion: Portion | null | undefined): Portion | null {
  return portion
    ? toPortion(portion.count, portion.unit, portion.unitPlural)
    : null;
}

export function portionColumns(
  portion: Portion | null | undefined,
): PortionColumns {
  const normalized = normalizePortion(portion);
  return normalized
    ? {
        portionCount: normalized.count,
        portionUnit: normalized.unit,
        portionUnitPlural: normalized.unitPlural,
      }
    : { ...NO_PORTION_COLUMNS };
}

export function portionUpdateColumns(
  portion: Portion | null | undefined,
): Partial<PortionColumns> {
  return portion === undefined ? {} : portionColumns(portion);
}

export function portionFromColumns(row: PortionColumns): Portion | null {
  return toPortion(row.portionCount, row.portionUnit, row.portionUnitPlural);
}

export function itemPortion(item: ItemCountInput): Portion | null {
  return toPortion(item.count, item.unit, item.unitPlural);
}

export function itemCount(portion: Portion | null): ItemCount {
  return portion
    ? {
        count: portion.count,
        unit: portion.unit,
        unitPlural: portion.unitPlural,
      }
    : { ...NO_ITEM_COUNT };
}

export function normalizeItemCount(item: ItemCountInput): ItemCount {
  return itemCount(itemPortion(item));
}

export function scaledPortion(
  portion: Portion | null,
  factor: number,
): Portion | null {
  if (portion === null || factor === 1) {
    return portion;
  }
  const scaled = scalePortion(portion, factor);
  return toPortion(scaled.count, scaled.unit, scaled.unitPlural);
}

export function withScaledCount<T extends ItemCountInput>(
  item: T,
  factor: number,
): T {
  const portion = itemPortion(item);
  return portion === null
    ? item
    : { ...item, ...itemCount(scaledPortion(portion, factor)) };
}

export function clampedPortion(
  count: number | null,
  unit: string | null,
  unitPlural: string | null,
): Portion | null {
  return isFiniteNumber(count)
    ? toPortion(Math.min(count, PORTION_COUNT_MAX), unit, unitPlural)
    : null;
}
