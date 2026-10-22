import { isFiniteNumber, type Portion } from '@food/shared';
import { toPortion } from '../common/portions.js';
import type {
  AnsweredQuestion,
  PreviousEstimate,
  PreviousEstimateItem,
} from './prompt.js';

export const MAX_ANSWER_CHAIN = 5;

export interface AnalysisChainLink {
  previousAnalysisId: string | null;
  followUpAnswer: string | null;
}

export interface AnalysisChainParent extends AnalysisChainLink {
  result: unknown;
}

export type AnalysisParentLoader = (
  id: string,
) => Promise<AnalysisChainParent | null>;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function stringOr<T>(value: unknown, fallback: T): string | T {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toPreviousItem(value: unknown): PreviousEstimateItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = stringOr(value.name, null);
  if (!name) {
    return null;
  }
  const nutrients = isRecord(value.nutrients) ? value.nutrients : {};
  return {
    name,
    grams: numberOr(value.grams, 0),
    calories: numberOr(nutrients.calories, 0),
    ...portionField(toPortion(value.count, value.unit, value.unitPlural)),
  };
}

function portionField(portion: Portion | null): { portion?: Portion } {
  return portion ? { portion } : {};
}

function storedPortion(value: unknown): Portion | null {
  return isRecord(value)
    ? toPortion(value.count, value.unit, value.unitPlural)
    : null;
}

export function summarizePreviousResult(result: unknown): PreviousEstimate {
  const record = isRecord(result) ? result : {};
  const items = Array.isArray(record.items)
    ? record.items.flatMap((raw) => {
        const item = toPreviousItem(raw);
        return item ? [item] : [];
      })
    : [];
  const totals = isRecord(record.totals) ? record.totals : {};
  return {
    mealName: stringOr(record.mealName, ''),
    ...portionField(storedPortion(record.portion)),
    items,
    totalCalories: numberOr(
      totals.calories,
      items.reduce((sum, item) => sum + item.calories, 0),
    ),
    question: followUpQuestionOf(record),
  };
}

export function followUpQuestionOf(result: unknown): string | null {
  return isRecord(result) ? stringOr(result.followUpQuestion, null) : null;
}

export async function collectAnsweredQuestions(
  link: AnalysisChainLink,
  loadParent: AnalysisParentLoader,
  depth = MAX_ANSWER_CHAIN,
): Promise<AnsweredQuestion[]> {
  if (depth <= 0) {
    return [];
  }
  const parent = link.previousAnalysisId
    ? await loadParent(link.previousAnalysisId)
    : null;
  const earlier = parent
    ? await collectAnsweredQuestions(parent, loadParent, depth - 1)
    : [];
  const answer = link.followUpAnswer?.trim();
  if (!answer) {
    return earlier;
  }
  return [
    ...earlier,
    { question: parent ? followUpQuestionOf(parent.result) : null, answer },
  ];
}
