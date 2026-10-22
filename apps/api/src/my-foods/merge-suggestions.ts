import {
  type FoodMergeSuggestion,
  type FoodMergeVariant,
  type FoodValueSource,
  type Micros,
  microsPer100From,
  type Nutrients,
  per100gFromNutrients,
  roundNutrients,
  roundTo,
  zeroNutrients,
} from '@food/shared';
import { per100Micros } from '../common/micros.js';
import type { BasisUnit } from '../products/product-data.js';
import {
  areComparableNodes,
  type GroupNode,
  groupComparableNodes,
} from './food-groups.js';
import { type FoodName, foodNameSignature, toFoodName } from './food-names.js';
import {
  areKeptApart,
  type FoodMergeDecision,
  isDecidedItem,
  toDecisionRules,
} from './merge-decisions.js';

export const SUGGESTION_RULES = {
  windowDays: 120,
  max: 5,
  minKcalPer100: 5,
  spreadRel: 0.1,
  spreadMin: 5,
} as const;

const DAY_MS = 86_400_000;
const GRAMS_DECIMALS = 1;
const HALF_KCAL = 0.5;

const SOURCE_RANK: Record<FoodValueSource, number> = {
  saved: 0,
  label: 1,
  estimate: 2,
};

export interface LoggedFoodItem {
  id: string;
  entryId: string;
  name: string;
  grams: number;
  nutrients: Nutrients;
  micros: Micros | null;
  productId: string | null;
  loggedAt: Date;
  createdAt: Date;
  fromLabel: boolean;
}

export interface SavedFoodInfo {
  id: string;
  displayName: string;
  names: readonly string[];
  basisUnit: BasisUnit;
  per100: Nutrients;
  microsPer100: Micros | null;
  servingGrams: number;
  lastUsedAt: Date;
}

interface VariantNode extends GroupNode {
  key: string;
  signature: string;
  items: LoggedFoodItem[];
  food: SavedFoodInfo | null;
}

interface BuiltVariant {
  key: string;
  variant: Omit<FoodMergeVariant, 'recommended'>;
}

export function suggestionWindowStart(now: Date): Date {
  return new Date(now.getTime() - SUGGESTION_RULES.windowDays * DAY_MS);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byRecency(a: LoggedFoodItem, b: LoggedFoodItem): number {
  return b.loggedAt.getTime() - a.loggedAt.getTime() || compareText(b.id, a.id);
}

function kcalPer100(item: LoggedFoodItem): number {
  return (item.nutrients.calories * 100) / item.grams;
}

function kcalBounds(item: LoggedFoodItem): [number, number] {
  const calories = item.nutrients.calories;
  return [
    (Math.max(0, calories - HALF_KCAL) * 100) / item.grams,
    ((calories + HALF_KCAL) * 100) / item.grams,
  ];
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function itemPer100(item: LoggedFoodItem): Nutrients {
  return roundNutrients(
    per100gFromNutrients(item.nutrients, item.grams) ?? zeroNutrients(),
  );
}

function itemMicrosPer100(item: LoggedFoodItem): Micros | null {
  return per100Micros(microsPer100From(item.micros, item.grams));
}

function nonEmptyNames(names: readonly string[]): FoodName[] {
  return names.map(toFoodName).filter((name) => name.tokens.size > 0);
}

function savedNodeId(food: SavedFoodInfo): string {
  return `saved:${food.id}`;
}

function newNode(
  id: string,
  displayName: string,
  names: readonly string[],
  food: SavedFoodInfo | null,
): VariantNode {
  const name = toFoodName(displayName);
  return {
    id,
    key: name.key,
    signature: foodNameSignature(name.tokens),
    names: nonEmptyNames(names),
    weight: 0,
    items: [],
    food,
  };
}

function savedFoodNode(food: SavedFoodInfo): VariantNode {
  return newNode(
    savedNodeId(food),
    food.displayName,
    [food.displayName, ...food.names],
    food,
  );
}

function buildNodes(
  items: readonly LoggedFoodItem[],
  foods: ReadonlyMap<string, SavedFoodInfo>,
): VariantNode[] {
  const nodes = new Map<string, VariantNode>();
  for (const item of [...items].sort(byRecency)) {
    const food = item.productId === null ? null : foods.get(item.productId);
    const id = food
      ? savedNodeId(food)
      : `name:${foodNameSignature(toFoodName(item.name).tokens)}`;
    const node =
      nodes.get(id) ??
      (food ? savedFoodNode(food) : newNode(id, item.name, [item.name], null));
    if (!food && node.signature === '') {
      continue;
    }
    node.items.push(item);
    node.weight += 1;
    nodes.set(id, node);
  }
  return [...nodes.values()];
}

function unusedSavedFoodNodes(
  nodes: readonly VariantNode[],
  foods: ReadonlyMap<string, SavedFoodInfo>,
): VariantNode[] {
  const used = new Set(nodes.map(({ id }) => id));
  return [...foods.values()]
    .filter((food) => !used.has(savedNodeId(food)))
    .map(savedFoodNode)
    .filter((node) => node.names.length > 0);
}

function entryCount(nodes: readonly VariantNode[]): number {
  return new Set(
    nodes.flatMap((node) => node.items.map((item) => item.entryId)),
  ).size;
}

function groupWeight(nodes: readonly VariantNode[]): number {
  return nodes.reduce((total, node) => total + node.weight, 0);
}

function isDismissed(
  nodes: readonly VariantNode[],
  dismissed: ReadonlySet<string>,
): boolean {
  return nodes.some((node) => dismissed.has(node.signature));
}

function withUnusedSavedFoods(
  groups: readonly VariantNode[][],
  unused: readonly VariantNode[],
  dismissed: ReadonlySet<string>,
  comparable: (a: VariantNode, b: VariantNode) => boolean,
): VariantNode[][] {
  const available = [...unused];
  const result = [...groups];
  const ranked = groups
    .map((nodes, index) => ({ nodes, index, weight: groupWeight(nodes) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { nodes, index } of ranked) {
    if (
      available.length === 0 ||
      nodes.some((node) => node.food !== null) ||
      entryCount(nodes) < 2 ||
      isDismissed(nodes, dismissed)
    ) {
      continue;
    }
    const position = available.findIndex((saved) =>
      nodes.every((node) => comparable(saved, node)),
    );
    const [saved] = position >= 0 ? available.splice(position, 1) : [];
    if (saved) {
      result[index] = [...nodes, saved];
    }
  }
  return result;
}

function valueSource(
  node: VariantNode,
  latest: LoggedFoodItem,
): FoodValueSource {
  if (node.food) {
    return 'saved';
  }
  return latest.fromLabel ? 'label' : 'estimate';
}

function nodeKcalValues(node: VariantNode): number[] {
  const values = node.items.map(kcalPer100);
  return node.food ? [...values, node.food.per100.calories] : values;
}

function unusedSavedVariant(
  food: SavedFoodInfo,
): Omit<FoodMergeVariant, 'recommended'> {
  const kcal = Math.round(food.per100.calories);
  return {
    name: food.displayName,
    productId: food.id,
    timesLogged: 0,
    typicalGrams: roundTo(food.servingGrams, GRAMS_DECIMALS),
    lastUsedAt: food.lastUsedAt.toISOString(),
    basisUnit: food.basisUnit,
    per100: { ...food.per100 },
    microsPer100: food.microsPer100 ? { ...food.microsPer100 } : null,
    kcalPer100Min: kcal,
    kcalPer100Max: kcal,
    valueSource: 'saved',
  };
}

function toVariant(node: VariantNode): BuiltVariant | null {
  const [latest] = [...node.items].sort(byRecency);
  if (latest === undefined) {
    return node.food
      ? { key: node.key, variant: unusedSavedVariant(node.food) }
      : null;
  }
  const kcal = nodeKcalValues(node);
  return {
    key: node.key,
    variant: {
      name: node.food ? node.food.displayName : latest.name,
      productId: node.food?.id ?? null,
      timesLogged: node.items.length,
      typicalGrams: roundTo(
        median(node.items.map((item) => item.grams)),
        GRAMS_DECIMALS,
      ),
      lastUsedAt: latest.loggedAt.toISOString(),
      basisUnit: node.food?.basisUnit ?? 'g',
      per100: node.food ? { ...node.food.per100 } : itemPer100(latest),
      microsPer100: node.food?.microsPer100
        ? { ...node.food.microsPer100 }
        : itemMicrosPer100(latest),
      kcalPer100Min: Math.round(Math.min(...kcal)),
      kcalPer100Max: Math.round(Math.max(...kcal)),
      valueSource: valueSource(node, latest),
    },
  };
}

function compareVariants(a: BuiltVariant, b: BuiltVariant): number {
  return (
    SOURCE_RANK[a.variant.valueSource] - SOURCE_RANK[b.variant.valueSource] ||
    b.variant.timesLogged - a.variant.timesLogged ||
    compareText(b.variant.lastUsedAt, a.variant.lastUsedAt) ||
    compareText(a.variant.name, b.variant.name)
  );
}

function groupKcal(nodes: readonly VariantNode[]): number[] {
  return nodes.flatMap(nodeKcalValues);
}

function noiseAwareSpread(nodes: readonly VariantNode[]): number {
  const bounds = nodes.flatMap((node) => {
    const itemBounds = node.items.map(kcalBounds);
    return node.food
      ? [...itemBounds, [node.food.per100.calories, node.food.per100.calories]]
      : itemBounds;
  });
  const lowest = Math.min(...bounds.map(([, high]) => high));
  const highest = Math.max(...bounds.map(([low]) => low));
  return Math.max(0, highest - lowest);
}

function loggedVariantCount(nodes: readonly VariantNode[]): number {
  return nodes.filter((node) => node.items.length > 0).length;
}

function hasInconsistentValues(nodes: readonly VariantNode[]): boolean {
  const maxKcal = Math.max(...groupKcal(nodes));
  const spread = noiseAwareSpread(nodes);
  return (
    spread >= SUGGESTION_RULES.spreadMin &&
    spread >= SUGGESTION_RULES.spreadRel * maxKcal
  );
}

function isSuggested(
  nodes: readonly VariantNode[],
  dismissed: ReadonlySet<string>,
): boolean {
  return (
    entryCount(nodes) >= 2 &&
    Math.max(...groupKcal(nodes)) >= SUGGESTION_RULES.minKcalPer100 &&
    (loggedVariantCount(nodes) >= 2 || hasInconsistentValues(nodes)) &&
    !isDismissed(nodes, dismissed)
  );
}

interface RankedSuggestion {
  suggestion: FoodMergeSuggestion;
  impact: number;
}

function keyVariant(variants: readonly BuiltVariant[]): BuiltVariant | null {
  const candidates = variants.filter(({ key }) => key !== '');
  const [shortest] = [...candidates].sort(
    (a, b) => a.key.length - b.key.length || compareText(a.key, b.key),
  );
  return shortest ?? null;
}

function toSuggestion(nodes: readonly VariantNode[]): RankedSuggestion | null {
  const built = nodes
    .map(toVariant)
    .filter((variant): variant is BuiltVariant => variant !== null)
    .sort(compareVariants);
  const key = keyVariant(built);
  if (key === null) {
    return null;
  }
  const items = nodes.flatMap((node) => node.items);
  const kcal = groupKcal(nodes);
  const kcalMin = Math.min(...kcal);
  const kcalMax = Math.max(...kcal);
  const typicalGrams = median(items.map((item) => item.grams));
  return {
    suggestion: {
      key: key.key,
      label: key.variant.name,
      variants: built.map(({ variant }, index) => ({
        ...variant,
        recommended: index === 0,
      })),
      itemCount: items.length,
      entryCount: new Set(items.map((item) => item.entryId)).size,
      kcalPer100Min: Math.round(kcalMin),
      kcalPer100Max: Math.round(kcalMax),
    },
    impact: ((kcalMax - kcalMin) * typicalGrams * items.length) / 100,
  };
}

function compareRanked(a: RankedSuggestion, b: RankedSuggestion): number {
  return (
    b.impact - a.impact ||
    b.suggestion.itemCount - a.suggestion.itemCount ||
    compareText(a.suggestion.key, b.suggestion.key)
  );
}

export function buildMergeSuggestions(
  items: readonly LoggedFoodItem[],
  foods: ReadonlyMap<string, SavedFoodInfo>,
  dismissedKeys: readonly string[],
  decisions: readonly FoodMergeDecision[] = [],
): FoodMergeSuggestion[] {
  const dismissed = new Set(
    dismissedKeys
      .map((key) => foodNameSignature(toFoodName(key).tokens))
      .filter(Boolean),
  );
  const rules = toDecisionRules(decisions);
  const comparable = (a: VariantNode, b: VariantNode): boolean =>
    areComparableNodes(a, b) && !areKeptApart(a, b, rules);
  const nodes = buildNodes(
    items.filter((item) => item.grams > 0 && !isDecidedItem(item, rules)),
    foods,
  );
  return withUnusedSavedFoods(
    groupComparableNodes(nodes, comparable),
    unusedSavedFoodNodes(nodes, foods),
    dismissed,
    comparable,
  )
    .filter((group) => isSuggested(group, dismissed))
    .flatMap((group) => {
      const ranked = toSuggestion(group);
      return ranked ? [ranked] : [];
    })
    .sort(compareRanked)
    .slice(0, SUGGESTION_RULES.max)
    .map(({ suggestion }) => suggestion);
}
