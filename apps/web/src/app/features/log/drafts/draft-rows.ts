import {
  API_LIMITS,
  CONFIDENCE_LEVELS,
  sanitizeNutrients,
  sumNutrients,
  type AnalysisMode,
  type Confidence,
  type DraftDto,
  type EntryItemInput,
  type MealType,
  type Portion,
} from '@food/shared';
import type { LocalDraft } from '../../../core/offline-drafts.store';
import { localClockTime, localDateOf, relativeDayLabel, todayLocalDate } from '../../../core/time';
import { formatNumber } from '../../../shared/utils/format';
import { itemExtras } from '../../../shared/utils/micros';
import { productIdField } from '../../../shared/utils/saved-foods';
import {
  amountLine,
  itemCountFields,
  itemPortion,
  parsePortionJson,
  sumGrams,
  toPortion,
} from '../../../shared/utils/portion';

export type DraftSource =
  | { readonly kind: 'server'; readonly draft: DraftDto }
  | { readonly kind: 'local'; readonly draft: LocalDraft };

export type DraftUploadState = 'saved' | 'waiting' | 'uploading' | 'failed';

export interface DraftRow {
  readonly key: string;
  readonly source: DraftSource;
  readonly title: string;
  readonly detail: string | null;
  readonly when: string;
  readonly thumbs: readonly string[];
  readonly photoCount: number;
  readonly mode: AnalysisMode;
  readonly analysed: boolean;
  readonly calories: number | null;
  readonly amount: string | null;
  readonly upload: DraftUploadState;
  readonly failure: string | null;
  readonly sortAt: number;
}

export interface DraftFacts {
  mode: AnalysisMode;
  name: string | null;
  description: string | null;
  mealType: MealType | null;
  timestamp: string;
  items: EntryItemInput[] | null;
  portion: Portion | null;
  analysisId: string | null;
}

export const DRAFT_MODE_TITLES: Record<AnalysisMode, string> = {
  food_photo: 'Food photo',
  nutrition_label: 'Nutrition label',
  text: 'Description',
};

export const DRAFT_STATE_LABELS = {
  pending: 'Not analysed',
  analysed: 'Analysed',
  waiting: 'Waiting to upload',
  uploading: 'Uploading…',
  failed: "Couldn't upload",
} as const;

const TITLE_MAX = 80;

function isItem(value: unknown): value is EntryItemInput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const confidence = item['confidence'];
  const productId = item['productId'];
  return (
    typeof item['name'] === 'string' &&
    typeof item['grams'] === 'number' &&
    Number.isFinite(item['grams']) &&
    typeof item['nutrients'] === 'object' &&
    item['nutrients'] !== null &&
    (confidence === undefined ||
      confidence === null ||
      CONFIDENCE_LEVELS.includes(confidence as Confidence)) &&
    (productId === undefined || productId === null || typeof productId === 'string')
  );
}

export function parseDraftItems(json: string | undefined | null): EntryItemInput[] | null {
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isItem)) {
    return null;
  }
  return parsed.slice(0, API_LIMITS.itemsMax).map((item) => ({
    name: item.name,
    grams: item.grams,
    nutrients: sanitizeNutrients(item.nutrients),
    confidence: item.confidence ?? null,
    ...itemCountFields(itemPortion(item)),
    ...productIdField(item.productId),
    ...itemExtras(item),
  }));
}

export function draftFacts(source: DraftSource): DraftFacts {
  if (source.kind === 'server') {
    const { draft } = source;
    return {
      mode: draft.mode,
      name: draft.name,
      description: draft.description,
      mealType: draft.mealType,
      timestamp: draft.timestamp,
      items: draft.items && draft.items.length > 0 ? draft.items : null,
      portion: toPortion(draft.portion),
      analysisId: draft.analysisId,
    };
  }
  const { fields } = source.draft;
  return {
    mode: fields.mode,
    name: fields.name?.trim() || null,
    description: fields.description?.trim() || null,
    mealType: fields.mealType ?? null,
    timestamp: fields.timestamp,
    items: parseDraftItems(fields.items),
    portion: parsePortionJson(fields.portion),
    analysisId: fields.analysisId ?? null,
  };
}

function firstLine(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .find((part) => part.trim().length > 0)
      ?.trim() ?? '';
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}

export function draftTitle(facts: DraftFacts): { title: string; detail: string | null } {
  const name = facts.name?.trim() ?? '';
  const description = facts.description?.trim() ?? '';
  if (name) {
    return { title: name, detail: description ? firstLine(description) : null };
  }
  if (description) {
    return { title: firstLine(description), detail: null };
  }
  return { title: DRAFT_MODE_TITLES[facts.mode], detail: null };
}

export function draftWhen(timestamp: string, today: string = todayLocalDate()): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const localDate = localDateOf(date);
  const time = localClockTime(date);
  return localDate === today ? `Today ${time}` : `${relativeDayLabel(localDate, today)} ${time}`;
}

export function draftCalories(items: readonly EntryItemInput[] | null): number | null {
  if (!items || items.length === 0) {
    return null;
  }
  return Math.round(sumNutrients(items.map((item) => item.nutrients)).calories);
}

export function draftAmount(facts: Pick<DraftFacts, 'items' | 'portion'>): string | null {
  if (!facts.items || facts.items.length === 0) {
    return null;
  }
  return amountLine(facts.portion, sumGrams(facts.items)) || null;
}

export function draftStateLabel(
  row: Pick<DraftRow, 'analysed' | 'upload' | 'calories'> & Partial<Pick<DraftRow, 'amount'>>,
): string {
  switch (row.upload) {
    case 'waiting':
      return DRAFT_STATE_LABELS.waiting;
    case 'uploading':
      return DRAFT_STATE_LABELS.uploading;
    case 'failed':
      return DRAFT_STATE_LABELS.failed;
    default:
      if (!row.analysed) {
        return DRAFT_STATE_LABELS.pending;
      }
      if (row.calories === null) {
        return DRAFT_STATE_LABELS.analysed;
      }
      return [DRAFT_STATE_LABELS.analysed, row.amount ?? null, `${formatNumber(row.calories)} kcal`]
        .filter((part): part is string => part !== null)
        .join(' · ');
  }
}

export function serverDraftRow(draft: DraftDto, today?: string): DraftRow {
  const facts = draftFacts({ kind: 'server', draft });
  const { title, detail } = draftTitle(facts);
  const calories = draftCalories(facts.items);
  return {
    key: `server:${draft.id}`,
    source: { kind: 'server', draft },
    title,
    detail,
    when: draftWhen(draft.timestamp, today),
    thumbs: draft.photos.map((photo) => photo.photo.thumbUrl),
    photoCount: draft.photos.length,
    mode: draft.mode,
    analysed: facts.items !== null,
    calories,
    amount: draftAmount(facts),
    upload: 'saved',
    failure: null,
    sortAt: Date.parse(draft.updatedAt) || Date.parse(draft.createdAt) || 0,
  };
}

export function localDraftRow(
  draft: LocalDraft,
  thumbs: readonly string[],
  uploading: boolean,
  today?: string,
): DraftRow {
  const facts = draftFacts({ kind: 'local', draft });
  const { title, detail } = draftTitle(facts);
  return {
    key: `local:${draft.localId}`,
    source: { kind: 'local', draft },
    title,
    detail,
    when: draftWhen(draft.fields.timestamp, today),
    thumbs,
    photoCount: draft.images.length,
    mode: draft.fields.mode,
    analysed: facts.items !== null,
    calories: draftCalories(facts.items),
    amount: draftAmount(facts),
    upload: draft.failure !== null ? 'failed' : uploading ? 'uploading' : 'waiting',
    failure: draft.failure,
    sortAt: Date.parse(draft.createdAt) || 0,
  };
}

export function sortDraftRows(rows: readonly DraftRow[]): DraftRow[] {
  return [...rows].sort((a, b) => b.sortAt - a.sortAt);
}
