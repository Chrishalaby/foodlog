export const VOICE_SAVED_FOODS_MAX = 40;
export const VOICE_MEAL_NAMES_MAX = 20;
export const VOICE_MEAL_NAMES_DAYS = 90;
export const VOICE_VOCABULARY_MAX_TERMS = 60;
export const VOICE_VOCABULARY_MAX_CHARS = 900;
export const VOICE_TERM_MAX_CHARS = 60;

export const VOICE_PROMPT_INTRO =
  'Food diary dictation that may mix languages and include dish and brand names; write numbers, weights and units as digits, like "2 eggs" and "150 g".';

export function voicePromptIntro(location: string | null | undefined): string {
  const place = cleanVoiceTerm(location);
  return place
    ? `Food diary dictation from someone in ${place}; it may mix English with the local languages and include local dishes and brand names; write numbers, weights and units as digits, like "2 eggs" and "150 g".`
    : VOICE_PROMPT_INTRO;
}

export interface VoiceSavedFood {
  name: string;
  brand: string | null;
}

const UNSAFE_TERM_CHARACTERS = /[<>\p{Cc}\p{Cs}]/gu;
const WHITESPACE = /\s+/gu;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function cleanVoiceTerm(
  value: string | null | undefined,
): string | null {
  const term = (value ?? '')
    .replace(UNSAFE_TERM_CHARACTERS, ' ')
    .replace(WHITESPACE, ' ')
    .trim();
  const length = Array.from(term).length;
  return length > 0 &&
    length <= VOICE_TERM_MAX_CHARS &&
    WORD_CHARACTER.test(term)
    ? term
    : null;
}

export function buildVoiceVocabulary(
  savedFoods: readonly VoiceSavedFood[],
  mealNames: readonly string[],
): string[] {
  const candidates = [
    ...savedFoods
      .slice(0, VOICE_SAVED_FOODS_MAX)
      .flatMap(({ brand, name }) => [brand, name]),
    ...mealNames.slice(0, VOICE_MEAL_NAMES_MAX),
  ];
  const seen = new Set<string>();
  const terms: string[] = [];
  let chars = 0;
  for (const candidate of candidates) {
    const term = cleanVoiceTerm(candidate);
    const key = term?.toLowerCase();
    if (!term || !key || seen.has(key)) {
      continue;
    }
    if (
      terms.length >= VOICE_VOCABULARY_MAX_TERMS ||
      chars + term.length > VOICE_VOCABULARY_MAX_CHARS
    ) {
      break;
    }
    seen.add(key);
    terms.push(term);
    chars += term.length + 2;
  }
  return terms;
}

export function buildVoicePrompt(
  vocabulary: readonly string[],
  location: string | null = null,
): string {
  const intro = voicePromptIntro(location);
  return vocabulary.length === 0
    ? intro
    : `${intro} Foods and brands the speaker often logs: ${vocabulary.join(', ')}.`;
}
