import {
  API_LIMITS,
  NUTRIENT_KEYS,
  type AiConfigDto,
  type AiUsageSummary,
  type AnalysisMode,
  type AnalysisPhotoRef,
  type AnalysisResult,
  type AnalyzeResponse,
  type EntrySource,
  type ImageRole,
  type Portion,
} from '@food/shared';
import {
  createDraftItem,
  draftFromAnalysisItem,
  type DraftItem,
} from '../../shared/ui/items-editor/items-math';
import { formatNumber } from '../../shared/utils/format';

export const TODAY_PATH = '/today';

export const FOOD_HINTS = [
  'homemade',
  'restaurant',
  'grilled',
  'fried',
  'half portion',
  'large portion',
  'no oil',
  'whole thing',
] as const;

export const LABEL_HINTS = ['1 serving', '2 servings', 'half the pack', 'whole pack'] as const;

export const SOURCE_LABELS: Record<EntrySource, string> = {
  food_photo: 'Food photo',
  nutrition_label: 'Nutrition label',
  text: 'Description',
  favorite: 'Favorite',
  manual: 'Manual entry',
  copy: 'Food library',
  barcode: 'Barcode',
  database: 'Food database',
  import: 'Imported',
};

export const DESCRIPTION_PLACEHOLDERS: Record<AnalysisMode, string> = {
  food_photo: 'e.g. 2 beef patties ~150 g each, bun hollowed, 1 tbsp ketchup-mayo',
  nutrition_label: 'e.g. ate 2 biscuits (about 30 g), or half the bag',
  text: 'e.g. 200 g grilled chicken breast, 150 g cooked basmati rice, 1 tbsp olive oil, side salad',
};

export const DESCRIPTION_HELP: Record<AnalysisMode, string> = {
  food_photo: 'Weights, cooking method, oil and sauces, what you left over.',
  nutrition_label: "Tell us how much you ate, the label alone can't show that.",
  text: 'List each food with an amount and how it was cooked. Several meals at once are fine: say which was breakfast, lunch or dinner and they are logged separately.',
};

export const ANALYZE_TIPS = [
  'Tip: mention weights for better accuracy.',
  'Tip: oil, butter and sauces add up fast. Mention them.',
  'Tip: say "half portion" if you did not finish your plate.',
  'Tip: for packaged food, scan the nutrition label instead.',
  'Tip: shoot from about 45° with a fork or hand for scale.',
  'Tip: Precise mode is slower but better for complex plates.',
] as const;

const AMOUNT_PATTERN =
  /\d|[½¼¾⅓⅔]|\b(a|an|one|two|three|four|five|six|half|quarter|cups?|slices?|pieces?|bowls?|plates?|glass(es)?|mugs?|tbsp|tsp|tablespoons?|teaspoons?|spoons?|handfuls?|servings?|portions?|packs?|bars?|scoops?|cans?|bottles?|whole|small|medium|large)\b/i;

export function mentionsAmount(description: string): boolean {
  return AMOUNT_PATTERN.test(description);
}

export function hintsFor(mode: AnalysisMode): readonly string[] {
  return mode === 'nutrition_label' ? LABEL_HINTS : FOOD_HINTS;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasHint(description: string, hint: string): boolean {
  return new RegExp(`(^|[\\s,;.])${escapeRegExp(hint)}(?=$|[\\s,;.])`, 'i').test(description);
}

export function appendHint(description: string, hint: string): string {
  const base = description.trimEnd();
  if (base === '') {
    return hint;
  }
  const joined = /[,;.:]$/.test(base) ? `${base} ${hint}` : `${base}, ${hint}`;
  return joined.slice(0, API_LIMITS.descriptionMax);
}

export function removeHint(description: string, hint: string): string {
  const pattern = new RegExp(`(^|[,;]\\s*|\\s+)${escapeRegExp(hint)}(?=$|[\\s,;.])`, 'gi');
  return description
    .replace(pattern, '')
    .replace(/^\s*[,;]\s*/, '')
    .replace(/\s*([,;])\s*[,;]/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function toggleHint(description: string, hint: string): string {
  return hasHint(description, hint) ? removeHint(description, hint) : appendHint(description, hint);
}

export function entrySourceFor(mode: AnalysisMode | null): EntrySource {
  return mode ?? 'manual';
}

export function draftsFromResult(result: AnalysisResult): DraftItem[] {
  const linkable = result.inputType !== 'nutrition_label';
  const drafts = result.items
    .slice(0, API_LIMITS.itemsMax)
    .map((item) =>
      draftFromAnalysisItem(linkable ? item : { ...item, savedFood: null, suggestedFood: null }),
    );
  return drafts.length > 0 ? drafts : [createDraftItem()];
}

export function labelItemKey(items: readonly DraftItem[]): string | null {
  const fromLabel = items.find((item) => item.hints?.amountSource === 'label');
  return (fromLabel ?? items[0])?.key ?? null;
}

export function deriveMealName(name: string, items: readonly DraftItem[]): string {
  const trimmed = name.trim();
  if (trimmed) {
    return trimmed.slice(0, API_LIMITS.nameMax);
  }
  const names = items.map((item) => item.name.trim()).filter((itemName) => itemName.length > 0);
  if (names.length === 0) {
    return '';
  }
  const joined =
    names.length <= 2 ? names.join(' & ') : `${names[0]}, ${names[1]} +${names.length - 2} more`;
  return joined.slice(0, API_LIMITS.nameMax);
}

export function itemsSignature(items: readonly DraftItem[]): unknown[] {
  return items.map((item) => [
    item.name.trim(),
    item.grams,
    NUTRIENT_KEYS.map((key) => item.nutrients[key]),
    [item.count, item.unit, item.unitPlural],
    item.productId,
    item.fluidMl,
  ]);
}

export function portionSignature(portion: Portion | null): unknown {
  return portion ? [portion.count, portion.unit, portion.unitPlural] : null;
}

export function reviewSnapshot(
  name: string,
  items: readonly DraftItem[],
  portion: Portion | null = null,
): string {
  return JSON.stringify([name.trim(), itemsSignature(items), portionSignature(portion)]);
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0';
  }
  if (value < 0.001) {
    return '<$0.001';
  }
  return `$${value < 0.1 ? value.toFixed(3) : value.toFixed(2)}`;
}

export function usageLine(usage: AiUsageSummary): string {
  const parts = [
    usage.model,
    formatUsd(usage.costUsd),
    `${formatNumber(usage.durationMs / 1000, 1)} s`,
  ];
  if (usage.attempts > 1) {
    parts.push(`${usage.attempts} attempts`);
  }
  return parts.join(' · ');
}

export function preciseDetail(ai: AiConfigDto | null): string {
  if (!ai) {
    return 'Uses the most accurate model. Slower, and costs more per analysis.';
  }
  const precise = ai.availableModels.find((model) => model.id === ai.preciseModel);
  const active = ai.availableModels.find((model) => model.id === ai.activeModel);
  const label = precise?.label ?? ai.preciseModel;
  if (ai.preciseModel === ai.activeModel) {
    return `${label} is already your default model.`;
  }
  const mockNote = ai.provider === 'mock' ? ' Mock AI is free.' : '';
  if (precise && active && active.estCostPerRequestUsd > 0) {
    const ratio = precise.estCostPerRequestUsd / active.estCostPerRequestUsd;
    return `Uses ${label}: slower, about ${formatNumber(ratio, 1)}× the cost (~${formatUsd(precise.estCostPerRequestUsd)} vs ~${formatUsd(active.estCostPerRequestUsd)} per analysis).${mockNote}`;
  }
  return `Uses ${label}: slower, and costs more per analysis.${mockNote}`;
}

export type AnalyzeRunKind = 'initial' | 'follow_up' | 'recheck' | 'correction' | 'label';

export const CORRECTION_CHIPS = [
  'It was homemade',
  'Restaurant portion',
  'No oil used',
  'I ate half',
] as const;

export function correctionPrefix(assumption: string): string {
  const text = assumption.trim().replace(/[.!\s]+$/, '');
  if (!text) {
    return '';
  }
  const keepCase = /^\p{Lu}{2}/u.test(text) || /^I\b/.test(text);
  const lead = keepCase ? text : text[0].toLowerCase() + text.slice(1);
  return `Not ${lead} — `.slice(0, API_LIMITS.followUpAnswerMax);
}

const FIRST_STAGES: Partial<Record<AnalyzeRunKind, string>> = {
  follow_up: 'Updating with your answer…',
  recheck: 'Re-checking with the precise model…',
  correction: 'Applying your correction…',
  label: 'Uploading the label photo…',
};

export function analyzingStage(
  seconds: number,
  mode: AnalysisMode,
  kind: AnalyzeRunKind,
  photoCount = 1,
): string {
  const label = mode === 'nutrition_label' || kind === 'label';
  if (seconds < 4) {
    const first = FIRST_STAGES[kind];
    if (first) {
      return first;
    }
    if (mode === 'text') {
      return 'Reading your description…';
    }
    return photoCount > 1 ? 'Uploading photos…' : 'Uploading photo…';
  }
  if (seconds < 9) {
    return label ? 'Reading the label…' : 'Identifying foods…';
  }
  if (seconds < 17) {
    return label ? 'Working out your portion…' : 'Estimating portions…';
  }
  if (seconds < 32) {
    return 'Calculating nutrients…';
  }
  return 'Taking a little longer than usual…';
}

export function analyzingProgress(seconds: number): number {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return Math.min(95, Math.round((1 - Math.exp(-safe / 10)) * 100));
}

export function tipFor(seconds: number): string {
  const index = Math.floor(Math.max(0, seconds) / 5) % ANALYZE_TIPS.length;
  return ANALYZE_TIPS[index] ?? ANALYZE_TIPS[0];
}

export function roleForMode(mode: Exclude<AnalysisMode, 'text'>): ImageRole {
  return mode === 'nutrition_label' ? 'label' : 'food';
}

export function modeForRole(role: ImageRole): Exclude<AnalysisMode, 'text'> {
  return role === 'label' ? 'nutrition_label' : 'food_photo';
}

export function modeForRoles(roles: readonly ImageRole[]): Exclude<AnalysisMode, 'text'> {
  return roles.length === 0 || roles.includes('food') ? 'food_photo' : 'nutrition_label';
}

export function otherRole(role: ImageRole): ImageRole {
  return role === 'food' ? 'label' : 'food';
}

export function primaryPhoto<T extends { role: ImageRole }>(photos: readonly T[]): T | null {
  return photos.find((photo) => photo.role === 'food') ?? photos[0] ?? null;
}

export function draftUploadPhotos<T extends { role: ImageRole }>(
  photos: readonly T[],
  max: number = API_LIMITS.analyzeImagesMax,
): T[] {
  if (photos.length <= max) {
    return [...photos];
  }
  const firstFood = photos.find((photo) => photo.role === 'food');
  const others = photos.filter((photo) => photo !== firstFood);
  const newest = (count: number): T[] => (count > 0 ? others.slice(-count) : []);
  const kept = new Set(firstFood ? [firstFood, ...newest(max - 1)] : newest(max));
  return photos.filter((photo) => kept.has(photo));
}

export function analysisPhotoRefs(analysis: AnalyzeResponse | null): AnalysisPhotoRef[] {
  if (!analysis) {
    return [];
  }
  const photos = analysis.photos ?? [];
  if (photos.length > 0) {
    return photos;
  }
  return analysis.photo && analysis.mode !== 'text'
    ? [{ photo: analysis.photo, role: roleForMode(analysis.mode) }]
    : [];
}

export type LabelPhotoHint = 'low_confidence' | 'packaged';

export const LABEL_HINT_TEXT: Record<LabelPhotoHint, string> = {
  low_confidence: 'Some items are a guess. A label photo gives exact values.',
  packaged: 'Looks packaged. A photo of its label gives exact values.',
};

const PACKAGED_PATTERN =
  /\b(packag(e|ed|ing)|packs?|packets?|labels?|brand(ed|s)?|bottled?|bottles|jars?|tubs?|cartons?|wrappers?|sachets?|pouch(es)?|tins?|canned|store[- ]bought|supermarket)\b/i;

export function looksPackaged(analysis: AnalyzeResponse): boolean {
  const { result } = analysis;
  const texts = [
    analysis.description ?? '',
    result.mealName,
    result.scaleCues,
    ...result.assumptions,
    ...result.items.map((item) => `${item.name} ${item.portionBasis}`),
  ];
  return texts.some((text) => PACKAGED_PATTERN.test(text));
}

export function labelPhotoHint(analysis: AnalyzeResponse): LabelPhotoHint | null {
  const hasLabel =
    analysis.result.label !== null ||
    analysisPhotoRefs(analysis).some((photo) => photo.role === 'label');
  if (hasLabel) {
    return null;
  }
  if (analysis.result.items.some((item) => item.confidence === 'low')) {
    return 'low_confidence';
  }
  return looksPackaged(analysis) ? 'packaged' : null;
}
