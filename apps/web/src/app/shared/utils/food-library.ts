import type { FoodSearchResult } from '@food/shared';
import { formatNumber } from './format';
import { amountLine } from './portion';

type ResultKind = Pick<FoodSearchResult, 'kind'>;

export function canRenameResult(result: ResultKind): boolean {
  return result.kind === 'meal';
}

export function isProductResult(result: Pick<FoodSearchResult, 'kind' | 'productId'>): boolean {
  return result.kind === 'product' && result.productId !== null;
}

export function hasLibraryMenu(result: Pick<FoodSearchResult, 'kind' | 'productId'>): boolean {
  return result.kind === 'meal' || result.kind === 'food' || isProductResult(result);
}

export function cleanFoodName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '?';
}

export function entriesNoun(count: number): string {
  return count === 1 ? 'entry' : 'entries';
}

export function renamedMessage(count: number, to: string): string {
  if (count <= 0) {
    return 'No entries were renamed';
  }
  return `Renamed ${formatNumber(count)} ${entriesNoun(count)} to “${to}”`;
}

export function renameScope(result: Pick<FoodSearchResult, 'name' | 'useCount'>): string {
  const count = Math.max(1, result.useCount);
  return count === 1
    ? `Changes the name of the entry called “${result.name}”.`
    : `Changes the name of all ${formatNumber(count)} entries called “${result.name}”.`;
}

export function hiddenMessage(name: string): string {
  return `Removed “${name}” from suggestions. Your logs are kept.`;
}

function useCountText(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1 ? 'logged once' : `logged ${formatNumber(count)} times`;
}

export function foodUseSummary(
  result: Pick<FoodSearchResult, 'kind' | 'detail' | 'totals' | 'useCount'> &
    Partial<Pick<FoodSearchResult, 'portion' | 'grams'>>,
): string {
  const detail = result.detail?.trim() || null;
  const source =
    result.kind === 'product' ? detail : result.kind === 'food' && detail ? `from ${detail}` : null;
  return [
    source,
    amountLine(result.portion, result.grams ?? 0) || null,
    `${formatNumber(result.totals.calories)} kcal`,
    useCountText(result.useCount),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}
