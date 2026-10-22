import type { MealType } from '@food/shared';
import type { MealSplitOutput } from '../meal-split.schema.js';
import type { AnalysisPromptInput } from '../prompt.js';
import { mockAnalysis } from './mock-analysis.js';

const MEAL_WORDS: Readonly<Record<string, MealType>> = {
  breakfast: 'breakfast',
  brunch: 'lunch',
  lunch: 'lunch',
  dinner: 'dinner',
  supper: 'dinner',
  snack: 'snack',
};

const MEAL_WORD_PATTERN = /\b(breakfast|brunch|lunch|dinner|supper|snack)\b/gi;
const TRAILING_CONNECTORS =
  /(?:[\s,;.]+|\b(?:and|then|later|for|at|a|my)\b)+$/i;
const YESTERDAY_PATTERN = /\byesterday\b/i;

export interface MockMealSegment {
  text: string;
  mealType: MealType | null;
}

function mealTypeOf(word: string): MealType | null {
  return MEAL_WORDS[word.toLowerCase()] ?? null;
}

export function splitMockDescription(description: string): MockMealSegment[] {
  const matches = [...description.matchAll(MEAL_WORD_PATTERN)];
  const [first] = matches;
  if (matches.length < 2 || !first) {
    return [
      {
        text: description,
        mealType: first ? mealTypeOf(first[1] ?? '') : null,
      },
    ];
  }
  return matches.map((match, index) => {
    const start = index === 0 ? 0 : match.index;
    const end = matches[index + 1]?.index ?? description.length;
    return {
      text: description
        .slice(start, end)
        .replace(TRAILING_CONNECTORS, '')
        .trim(),
      mealType: mealTypeOf(match[1] ?? ''),
    };
  });
}

export function mockMealSplit(prompt: AnalysisPromptInput): MealSplitOutput {
  const description = prompt.description ?? '';
  const daysAgo = YESTERDAY_PATTERN.test(description) ? 1 : 0;
  return {
    meals: splitMockDescription(description).map(({ text, mealType }) => ({
      description: text,
      meal_type: mealType,
      eaten_at: null,
      days_ago: daysAgo,
      ...mockAnalysis({ ...prompt, description: text, mealType }),
    })),
  };
}
