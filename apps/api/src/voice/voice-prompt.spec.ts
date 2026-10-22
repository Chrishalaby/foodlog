import {
  buildVoicePrompt,
  buildVoiceVocabulary,
  cleanVoiceTerm,
  VOICE_MEAL_NAMES_MAX,
  VOICE_PROMPT_INTRO,
  voicePromptIntro,
  VOICE_SAVED_FOODS_MAX,
  VOICE_TERM_MAX_CHARS,
  VOICE_VOCABULARY_MAX_CHARS,
  VOICE_VOCABULARY_MAX_TERMS,
} from './voice-prompt.js';

describe('buildVoiceVocabulary', () => {
  it('lists brands and saved foods in usage order, then frequent meal names', () => {
    expect(
      buildVoiceVocabulary(
        [
          { name: 'Labneh', brand: 'Khoury' },
          { name: 'Potato bun', brand: 'Sofisoft' },
          { name: 'Manakish zaatar', brand: null },
        ],
        ['Chicken shawarma wrap', 'Overnight oats'],
      ),
    ).toEqual([
      'Khoury',
      'Labneh',
      'Sofisoft',
      'Potato bun',
      'Manakish zaatar',
      'Chicken shawarma wrap',
      'Overnight oats',
    ]);
  });

  it('drops duplicates regardless of case and blank or symbol-only terms', () => {
    expect(
      buildVoiceVocabulary(
        [
          { name: 'Strawberry yogurt', brand: 'Khoury' },
          { name: 'Labneh', brand: 'khoury' },
          { name: '   ', brand: '' },
          { name: '---', brand: null },
        ],
        ['labneh', 'LABNEH', 'Fattoush'],
      ),
    ).toEqual(['Khoury', 'Strawberry yogurt', 'Labneh', 'Fattoush']);
  });

  it('keeps Arabic names and strips characters the API rejects', () => {
    expect(cleanVoiceTerm('  لبنة \n خوري ')).toBe('لبنة خوري');
    expect(cleanVoiceTerm('Heinz <b>ketchup</b>\r\n')).toBe(
      'Heinz b ketchup /b',
    );
    expect(cleanVoiceTerm(null)).toBeNull();
    expect(cleanVoiceTerm('x'.repeat(VOICE_TERM_MAX_CHARS))).toHaveLength(
      VOICE_TERM_MAX_CHARS,
    );
    expect(cleanVoiceTerm('x'.repeat(VOICE_TERM_MAX_CHARS + 1))).toBeNull();
  });

  it('reads at most the configured number of saved foods and meal names', () => {
    const foods = Array.from({ length: VOICE_SAVED_FOODS_MAX + 5 }, (_, i) => ({
      name: `f${i}`,
      brand: null,
    }));
    const meals = Array.from(
      { length: VOICE_MEAL_NAMES_MAX + 5 },
      (_, i) => `m${i}`,
    );

    const vocabulary = buildVoiceVocabulary(foods, meals);

    expect(vocabulary).toHaveLength(
      VOICE_SAVED_FOODS_MAX + VOICE_MEAL_NAMES_MAX,
    );
    expect(vocabulary).not.toContain(`f${VOICE_SAVED_FOODS_MAX}`);
    expect(vocabulary).toContain(`m${VOICE_MEAL_NAMES_MAX - 1}`);
    expect(vocabulary).not.toContain(`m${VOICE_MEAL_NAMES_MAX}`);
  });

  it('stays within the term and character budgets, keeping the most used first', () => {
    const branded = Array.from({ length: VOICE_SAVED_FOODS_MAX }, (_, i) => ({
      name: `Food number ${i}`,
      brand: `Brand ${i}`,
    }));
    const capped = buildVoiceVocabulary(branded, []);
    expect(capped).toHaveLength(VOICE_VOCABULARY_MAX_TERMS);
    expect(capped.slice(0, 2)).toEqual(['Brand 0', 'Food number 0']);

    const long = Array.from({ length: VOICE_SAVED_FOODS_MAX }, (_, i) => ({
      name: `${'long food name '.repeat(3)}${i}`,
      brand: null,
    }));
    const byChars = buildVoiceVocabulary(long, ['Never reached']);
    expect(byChars.length).toBeLessThan(VOICE_SAVED_FOODS_MAX);
    expect(byChars.join(', ').length).toBeLessThanOrEqual(
      VOICE_VOCABULARY_MAX_CHARS,
    );
    expect(byChars).not.toContain('Never reached');
  });
});

describe('buildVoicePrompt', () => {
  it('describes a food dictation in any language with digits for amounts', () => {
    expect(VOICE_PROMPT_INTRO).toContain('Food diary dictation');
    expect(VOICE_PROMPT_INTRO).toContain('may mix languages');
    expect(VOICE_PROMPT_INTRO).toContain('"2 eggs"');
    expect(VOICE_PROMPT_INTRO).toContain('"150 g"');
    expect(buildVoicePrompt([])).toBe(VOICE_PROMPT_INTRO);
  });

  it('names the speaker’s location so local dishes and languages are expected', () => {
    const intro = voicePromptIntro('Beirut, Lebanon');
    expect(intro).toContain('from someone in Beirut, Lebanon');
    expect(intro).toContain('local languages');
    expect(intro).toContain('"150 g"');
    expect(buildVoicePrompt(['Labneh'], 'Beirut, Lebanon')).toBe(
      `${intro} Foods and brands the speaker often logs: Labneh.`,
    );
    expect(voicePromptIntro('  ')).toBe(VOICE_PROMPT_INTRO);
    expect(voicePromptIntro(null)).toBe(VOICE_PROMPT_INTRO);
    expect(voicePromptIntro('<script>')).not.toContain('<');
  });

  it('appends the vocabulary as one short line', () => {
    expect(buildVoicePrompt(['Khoury', 'Labneh', 'Sofisoft'])).toBe(
      `${VOICE_PROMPT_INTRO} Foods and brands the speaker often logs: Khoury, Labneh, Sofisoft.`,
    );
  });

  it('stays far below a transcription prompt limit with a full vocabulary', () => {
    const foods = Array.from({ length: VOICE_SAVED_FOODS_MAX }, (_, i) => ({
      name: `Some reasonably long saved food ${i}`,
      brand: `Brand name ${i}`,
    }));
    const prompt = buildVoicePrompt(buildVoiceVocabulary(foods, []));
    expect(prompt.length).toBeLessThanOrEqual(
      VOICE_PROMPT_INTRO.length + VOICE_VOCABULARY_MAX_CHARS + 60,
    );
  });
});
