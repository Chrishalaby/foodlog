import { HttpErrorResponse } from '@angular/common/http';
import type { DaySummary, EntryItemInput, EntrySource, MealIdea, MealIdeaPart } from '@food/shared';
import type { DataTopic } from '../../core/data-events.service';
import { apiErrorMessage, errorMessage } from '../../core/errors';
import { formatNumber } from '../../shared/utils/format';
import { amountLine } from '../../shared/utils/portion';
import {
  describeAnalyzeError,
  type AnalyzeFailure,
  type AnalyzeViewer,
} from '../log/analyze-errors';

export const IDEAS_FRESH_MS = 30 * 60_000;
export const IDEAS_TITLE = 'AI meal ideas';

const PROTEIN_DONE_BELOW = 0.5;
const PRODUCT_KEY_PREFIX = 'product:';

export type DayBalance = Pick<DaySummary, 'targets' | 'totals'>;

export interface DayLeft {
  calories: number;
  protein: number;
}

export interface IdeaAfter {
  text: string;
  over: boolean;
}

export type IdeaLogPlan =
  | { kind: 'quick'; key: string; servings: number; items: EntryItemInput[] }
  | { kind: 'entry'; source: EntrySource; items: EntryItemInput[] };

export function dayLeft(day: DayBalance): DayLeft {
  return {
    calories: Math.round(day.targets.calories - day.totals.calories),
    protein: Math.max(0, day.targets.protein - day.totals.protein),
  };
}

function proteinToGo(protein: number): string {
  return protein >= PROTEIN_DONE_BELOW
    ? `${formatNumber(protein)} g protein to go`
    : 'protein target hit';
}

export function leftLine(day: DayBalance): string {
  const left = dayLeft(day);
  const calories =
    left.calories >= 0
      ? `${formatNumber(left.calories)} kcal left`
      : `${formatNumber(-left.calories)} kcal over`;
  return `${calories} · ${proteinToGo(left.protein)}`;
}

export function ideasCardNote(day: DayBalance): string {
  const left = dayLeft(day);
  return left.calories > 0
    ? `From your usual foods · ${formatNumber(left.calories)} kcal left`
    : 'From your usual foods · light options';
}

export function ideaAfter(day: DayBalance, idea: Pick<MealIdea, 'totals'>): IdeaAfter {
  const left = dayLeft(day);
  const calories = left.calories - Math.round(idea.totals.calories);
  if (calories < 0) {
    return { text: `${formatNumber(-calories)} kcal over today's target`, over: true };
  }
  const protein = Math.max(0, left.protein - idea.totals.protein);
  return {
    text: `Leaves ${formatNumber(calories)} kcal · ${proteinToGo(protein)}`,
    over: false,
  };
}

export function macroLine(idea: Pick<MealIdea, 'totals'>): string {
  const { protein, carbs, fat } = idea.totals;
  return `Protein ${formatNumber(protein)} g · Carbs ${formatNumber(carbs)} g · Fat ${formatNumber(fat)} g`;
}

export function partAmount(part: Pick<MealIdeaPart, 'portion' | 'grams'>): string {
  return amountLine(part.portion, part.grams);
}

export function isNewFood(part: Pick<MealIdeaPart, 'foodKey'>): boolean {
  return part.foodKey === null;
}

export function ideaItems(idea: Pick<MealIdea, 'parts'>): EntryItemInput[] {
  return idea.parts.flatMap((part) => part.items);
}

export function ideaLogPlan(idea: Pick<MealIdea, 'parts'>): IdeaLogPlan {
  const items = ideaItems(idea);
  const [only, ...others] = idea.parts;
  if (only && others.length === 0 && only.foodKey !== null && only.servings !== null) {
    return { kind: 'quick', key: only.foodKey, servings: only.servings, items };
  }
  return {
    kind: 'entry',
    source: idea.parts.every((part) => part.foodKey !== null) ? 'copy' : 'text',
    items,
  };
}

export function ideaLogTopics(plan: IdeaLogPlan): DataTopic[] {
  const touchesProducts =
    plan.items.some((item) => !!item.productId) ||
    (plan.kind === 'quick' && plan.key.startsWith(PRODUCT_KEY_PREFIX));
  return [
    'entries',
    ...(plan.kind === 'quick' ? (['favorites'] as const) : []),
    ...(touchesProducts ? (['products'] as const) : []),
  ];
}

export function ideasBasis(date: string, day: Pick<DaySummary, 'totals' | 'entryCount'>): string {
  return `${date}|${day.entryCount}|${Math.round(day.totals.calories)}`;
}

export function isFresh(askedAt: number, now: number): boolean {
  return now - askedAt < IDEAS_FRESH_MS;
}

function aiFailure(status: number, serverMessage: string | null): AnalyzeFailure {
  return {
    kind: 'ai_failed',
    title: status === 504 ? 'The AI took too long' : "The AI couldn't finish",
    message: serverMessage ?? 'Ask again, it usually works on the next attempt.',
    retryable: true,
  };
}

export function describeIdeasError(err: unknown, viewer: AnalyzeViewer): AnalyzeFailure {
  if (!(err instanceof HttpErrorResponse)) {
    return {
      kind: 'unknown',
      title: "Couldn't get ideas",
      message: errorMessage(err),
      retryable: true,
    };
  }
  const serverMessage = apiErrorMessage(err.error);
  switch (err.status) {
    case 0:
      return {
        kind: 'offline',
        title: "You're offline",
        message: 'Ideas need a connection. Try again once you are back online.',
        retryable: true,
      };
    case 429:
      return serverMessage && /budget/i.test(serverMessage)
        ? describeAnalyzeError(err, viewer)
        : {
            kind: 'rate_limited',
            title: 'Too many AI requests',
            message: 'Wait a minute, then ask again.',
            retryable: true,
          };
    case 503:
      return serverMessage && /not configured/i.test(serverMessage)
        ? describeAnalyzeError(err, viewer)
        : {
            kind: 'ai_unavailable',
            title: 'AI temporarily unavailable',
            message: serverMessage ?? 'The AI is not responding right now. Try again in a moment.',
            retryable: true,
          };
    case 502:
    case 504:
      return aiFailure(err.status, serverMessage);
    default:
      return err.status >= 500
        ? aiFailure(err.status, null)
        : {
            kind: 'unknown',
            title: "Couldn't get ideas",
            message: errorMessage(err),
            retryable: true,
          };
  }
}
