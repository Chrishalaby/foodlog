import type { Prisma } from '../generated/prisma/client.js';
import {
  type FoodName,
  foodNameSignature,
  normalizeFoodKey,
  toFoodName,
} from './food-names.js';

export const FOOD_MERGE_DECISIONS_MAX = 200;

export interface FoodMergeDecision {
  names: string[];
  keptApart: string[];
  productId: string | null;
  at: string;
}

export interface MergeDecisionRule {
  names: ReadonlySet<string>;
  keptApart: ReadonlySet<string>;
  productId: string | null;
  at: number;
}

export interface DecidedItem {
  name: string;
  createdAt: Date;
}

export interface DecisionNode {
  names: readonly FoodName[];
  food: { id: string } | null;
}

function nameSignature(name: string): string {
  return foodNameSignature(toFoodName(name).tokens);
}

function signatures(names: readonly string[]): Set<string> {
  return new Set(names.map(nameSignature).filter((key) => key !== ''));
}

export function normalizedFoodNames(names: readonly string[]): string[] {
  return [...new Set(names.map(normalizeFoodKey).filter((key) => key !== ''))];
}

export function newMergeDecision(
  mergedNames: readonly string[],
  keptApart: readonly string[],
  productId: string,
  at: Date,
): FoodMergeDecision {
  const names = normalizedFoodNames(mergedNames);
  const merged = signatures(names);
  return {
    names,
    keptApart: normalizedFoodNames(keptApart).filter(
      (name) => !merged.has(nameSignature(name)),
    ),
    productId,
    at: at.toISOString(),
  };
}

export function withoutKeptApart(
  names: readonly string[],
  mergedNames: readonly string[],
  keptApart: readonly string[],
): string[] {
  const merged = signatures(mergedNames);
  const apart = signatures(keptApart);
  return names.filter((name) => {
    const signature = nameSignature(name);
    return merged.has(signature) || !apart.has(signature);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === 'string')
    ? [...value]
    : null;
}

function parseDecision(value: unknown): FoodMergeDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  const names = stringList(value['names']);
  const keptApart = stringList(value['keptApart']);
  const at = value['at'];
  const productId = value['productId'];
  if (
    names === null ||
    keptApart === null ||
    typeof at !== 'string' ||
    Number.isNaN(Date.parse(at))
  ) {
    return null;
  }
  return {
    names,
    keptApart,
    productId: typeof productId === 'string' ? productId : null,
    at,
  };
}

export function parseMergeDecisions(value: unknown): FoodMergeDecision[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    const decision = parseDecision(entry);
    return decision ? [decision] : [];
  });
}

export function withMergeDecision(
  current: readonly FoodMergeDecision[],
  decision: FoodMergeDecision,
): FoodMergeDecision[] {
  return [...current, decision].slice(-FOOD_MERGE_DECISIONS_MAX);
}

export function mergeDecisionsJson(
  decisions: readonly FoodMergeDecision[],
): Prisma.InputJsonValue {
  return decisions.map(({ names, keptApart, productId, at }) => ({
    names: [...names],
    keptApart: [...keptApart],
    productId,
    at,
  }));
}

function sharesFood(a: MergeDecisionRule, b: MergeDecisionRule): boolean {
  return (
    (a.productId !== null && a.productId === b.productId) ||
    [...a.names].some((key) => b.names.has(key))
  );
}

function stillKeptApart(
  rule: MergeDecisionRule,
  later: readonly MergeDecisionRule[],
): Set<string> {
  return new Set(
    [...rule.keptApart].filter(
      (key) =>
        !later.some((next) => next.names.has(key) && sharesFood(rule, next)),
    ),
  );
}

export function toDecisionRules(
  decisions: readonly FoodMergeDecision[],
): MergeDecisionRule[] {
  const rules = decisions.map((decision) => ({
    names: signatures(decision.names),
    keptApart: signatures(decision.keptApart),
    productId: decision.productId,
    at: Date.parse(decision.at),
  }));
  return rules.map((rule, index) => ({
    ...rule,
    keptApart: stillKeptApart(rule, rules.slice(index + 1)),
  }));
}

export function isDecidedItem(
  item: DecidedItem,
  rules: readonly MergeDecisionRule[],
): boolean {
  const signature = nameSignature(item.name);
  return (
    signature !== '' &&
    rules.some(
      (rule) =>
        item.createdAt.getTime() <= rule.at &&
        (rule.names.has(signature) || rule.keptApart.has(signature)),
    )
  );
}

function nodeSignatures(node: DecisionNode): string[] {
  return node.names.map((name) => foodNameSignature(name.tokens));
}

function isInDecision(node: DecisionNode, rule: MergeDecisionRule): boolean {
  return (
    (node.food !== null && node.food.id === rule.productId) ||
    nodeSignatures(node).some((key) => rule.names.has(key))
  );
}

function isKeptApartBy(node: DecisionNode, rule: MergeDecisionRule): boolean {
  return (
    !isInDecision(node, rule) &&
    nodeSignatures(node).some((key) => rule.keptApart.has(key))
  );
}

export function areKeptApart(
  a: DecisionNode,
  b: DecisionNode,
  rules: readonly MergeDecisionRule[],
): boolean {
  return rules.some(
    (rule) =>
      (isKeptApartBy(a, rule) && isInDecision(b, rule)) ||
      (isKeptApartBy(b, rule) && isInDecision(a, rule)),
  );
}
