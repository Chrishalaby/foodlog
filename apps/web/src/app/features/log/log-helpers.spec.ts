import {
  zeroNutrients,
  type AiConfigDto,
  type AnalysisItem,
  type AnalysisResult,
  type AnalyzeResponse,
  type PhotoRef,
} from '@food/shared';
import { createDraftItem } from '../../shared/ui/items-editor/items-math';
import {
  ANALYZE_TIPS,
  SOURCE_LABELS,
  analyzingProgress,
  analyzingStage,
  appendHint,
  correctionPrefix,
  deriveMealName,
  draftsFromResult,
  entrySourceFor,
  formatUsd,
  hasHint,
  analysisPhotoRefs,
  labelItemKey,
  labelPhotoHint,
  looksPackaged,
  mentionsAmount,
  modeForRole,
  modeForRoles,
  otherRole,
  primaryPhoto,
  roleForMode,
  preciseDetail,
  removeHint,
  reviewSnapshot,
  tipFor,
  toggleHint,
  usageLine,
} from './log-helpers';

function aiConfig(overrides: Partial<AiConfigDto> = {}): AiConfigDto {
  return {
    provider: 'openai',
    voice: true,
    customEndpoint: false,
    defaultModel: 'gpt-5.6-sol',
    preciseModel: 'gpt-6-astra',
    activeModel: 'gpt-5.6-sol',
    reasoningEffort: 'low',
    monthlyBudgetUsd: null,
    availableModels: [
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        description: '',
        estCostPerRequestUsd: 0.0412,
        recommended: true,
      },
      {
        id: 'gpt-6-astra',
        label: 'GPT-6 Astra',
        description: '',
        estCostPerRequestUsd: 0.103,
        recommended: false,
      },
    ],
    ...overrides,
  };
}

describe('description hints', () => {
  it('appends hints with a separator and toggles them off again', () => {
    expect(appendHint('', 'grilled')).toBe('grilled');
    expect(appendHint('chicken breast  ', 'grilled')).toBe('chicken breast, grilled');
    expect(appendHint('chicken breast,', 'grilled')).toBe('chicken breast, grilled');

    const once = toggleHint('chicken breast', 'no oil');
    expect(once).toBe('chicken breast, no oil');
    expect(hasHint(once, 'no oil')).toBe(true);
    expect(toggleHint(once, 'no oil')).toBe('chicken breast');
  });

  it('matches whole phrases only, case-insensitively', () => {
    expect(hasHint('Grilled salmon', 'grilled')).toBe(true);
    expect(hasHint('stir-fried noodles', 'fried')).toBe(false);
    expect(hasHint('panfried', 'fried')).toBe(false);
    expect(hasHint('a half portion.', 'half portion')).toBe(true);
  });

  it('removes a hint from the start, middle or end and tidies separators', () => {
    expect(removeHint('grilled, chicken', 'grilled')).toBe('chicken');
    expect(removeHint('chicken, grilled, rice', 'grilled')).toBe('chicken, rice');
    expect(removeHint('chicken grilled rice', 'grilled')).toBe('chicken rice');
    expect(removeHint('grilled', 'grilled')).toBe('');
  });
});

describe('review helpers', () => {
  const result: AnalysisResult = {
    portion: null,
    inputType: 'nutrition_label',
    mealName: 'Biscuits',
    scaleCues: '',
    items: [],
    label: null,
    totals: zeroNutrients(),
    assumptions: [],
    followUpQuestion: null,
    followUpOptions: [],
    warnings: [],
  };

  it('maps analysis modes to entry sources and falls back to manual', () => {
    expect(entrySourceFor('food_photo')).toBe('food_photo');
    expect(entrySourceFor('nutrition_label')).toBe('nutrition_label');
    expect(entrySourceFor('text')).toBe('text');
    expect(entrySourceFor(null)).toBe('manual');
  });

  it('names every entry source so that "Logged via …" reads naturally', () => {
    expect(SOURCE_LABELS.copy).toBe('Food library');
    for (const label of Object.values(SOURCE_LABELS)) {
      expect(label).not.toMatch(/^logged/i);
    }
  });

  it('seeds one empty item when the model returns none', () => {
    const drafts = draftsFromResult(result);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.name).toBe('');
  });

  it('links saved foods from photo and text analyses but never from a label', () => {
    const saved = {
      id: 'food-ketchup',
      name: 'Heinz tomato ketchup',
      brand: null,
      basisUnit: 'g' as const,
      per100: { ...zeroNutrients(), calories: 110 },
      microsPer100: null,
      unitName: null,
      unitGrams: null,
    };
    const labelItem: AnalysisItem = {
      name: 'Heinz tomato ketchup',
      grams: 20,
      count: null,
      unit: null,
      unitPlural: null,
      nutrients: { ...zeroNutrients(), calories: 22 },
      per100g: { ...zeroNutrients(), calories: 110 },
      micros: null,
      microsPer100g: null,
      fluidMl: null,
      confidence: 'high',
      amountSource: 'label',
      state: 'as_served',
      portionBasis: 'label',
      flags: [],
      savedFood: saved,
      suggestedFood: saved,
    };
    const [fromLabel] = draftsFromResult({ ...result, items: [labelItem] });
    expect(fromLabel).toMatchObject({ productId: null, savedFood: null, suggestedFood: null });
    const [fromText] = draftsFromResult({ ...result, inputType: 'text', items: [labelItem] });
    expect(fromText).toMatchObject({ productId: 'food-ketchup', savedFood: saved });
  });

  it('prefers the label-sourced item for label portions', () => {
    const plain = createDraftItem({ name: 'Milk' });
    const fromLabel = createDraftItem({ name: 'Cereal', hints: { amountSource: 'label' } });
    expect(labelItemKey([plain, fromLabel])).toBe(fromLabel.key);
    expect(labelItemKey([plain])).toBe(plain.key);
    expect(labelItemKey([])).toBeNull();
  });

  it('derives a meal name from item names when left blank', () => {
    const items = ['Rice', 'Chicken', 'Salad', 'Sauce'].map((name) => createDraftItem({ name }));
    expect(deriveMealName('  Lunch bowl ', items)).toBe('Lunch bowl');
    expect(deriveMealName('', items.slice(0, 2))).toBe('Rice & Chicken');
    expect(deriveMealName('', items)).toBe('Rice, Chicken +2 more');
    expect(deriveMealName(' ', [createDraftItem()])).toBe('');
  });

  it('produces snapshots that ignore draft keys but notice edits', () => {
    const a = [createDraftItem({ name: 'Rice', grams: 100 })];
    const b = [createDraftItem({ name: 'Rice', grams: 100 })];
    expect(reviewSnapshot('Bowl', a)).toBe(reviewSnapshot('Bowl ', b));
    expect(reviewSnapshot('Bowl', a)).not.toBe(
      reviewSnapshot('Bowl', [createDraftItem({ name: 'Rice', grams: 120 })]),
    );
    expect(reviewSnapshot('Bowl', a)).not.toBe(
      reviewSnapshot('Bowl', [{ ...a[0]!, productId: 'food-rice' }]),
    );
  });
});

describe('usage and precise copy', () => {
  it('formats costs compactly', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.0004)).toBe('<$0.001');
    expect(formatUsd(0.0123)).toBe('$0.012');
    expect(formatUsd(0.25)).toBe('$0.25');
  });

  it('summarises model, cost, duration and retries', () => {
    const usage = {
      model: 'gpt-5.6-sol',
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0.0231,
      durationMs: 14_250,
      attempts: 2,
    };
    expect(usageLine(usage)).toBe('gpt-5.6-sol · $0.023 · 14.3 s · 2 attempts');
    expect(usageLine({ ...usage, attempts: 1 })).toBe('gpt-5.6-sol · $0.023 · 14.3 s');
  });

  it('compares the precise model with the active one', () => {
    expect(preciseDetail(aiConfig())).toBe(
      'Uses GPT-6 Astra: slower, about 2.5× the cost (~$0.10 vs ~$0.041 per analysis).',
    );
    expect(preciseDetail(aiConfig({ activeModel: 'gpt-6-astra' }))).toBe(
      'GPT-6 Astra is already your default model.',
    );
    expect(preciseDetail(aiConfig({ provider: 'mock' }))).toContain('Mock AI is free.');
    expect(preciseDetail(null)).toContain('Slower');
  });
});

describe('analyzing progress', () => {
  it('walks through stages by elapsed time and run kind', () => {
    expect(analyzingStage(1, 'food_photo', 'initial')).toBe('Uploading photo…');
    expect(analyzingStage(1, 'text', 'initial')).toBe('Reading your description…');
    expect(analyzingStage(1, 'food_photo', 'follow_up')).toBe('Updating with your answer…');
    expect(analyzingStage(1, 'food_photo', 'recheck')).toBe('Re-checking with the precise model…');
    expect(analyzingStage(5, 'nutrition_label', 'initial')).toBe('Reading the label…');
    expect(analyzingStage(12, 'food_photo', 'initial')).toBe('Estimating portions…');
    expect(analyzingStage(20, 'text', 'initial')).toBe('Calculating nutrients…');
    expect(analyzingStage(40, 'text', 'initial')).toBe('Taking a little longer than usual…');
  });

  it('talks about photos and labels for multi-photo and label runs', () => {
    expect(analyzingStage(1, 'food_photo', 'initial', 3)).toBe('Uploading photos…');
    expect(analyzingStage(1, 'food_photo', 'label')).toBe('Uploading the label photo…');
    expect(analyzingStage(1, 'food_photo', 'correction')).toBe('Applying your correction…');
    expect(analyzingStage(5, 'food_photo', 'label')).toBe('Reading the label…');
    expect(analyzingStage(12, 'food_photo', 'label')).toBe('Working out your portion…');
    expect(analyzingStage(5, 'food_photo', 'initial', 2)).toBe('Identifying foods…');
  });

  it('eases progress towards but never reaches 100', () => {
    expect(analyzingProgress(0)).toBe(0);
    expect(analyzingProgress(10)).toBe(63);
    expect(analyzingProgress(600)).toBe(95);
    expect(analyzingProgress(-3)).toBe(0);
  });

  it('rotates tips every five seconds', () => {
    expect(tipFor(0)).toBe(ANALYZE_TIPS[0]);
    expect(tipFor(5)).toBe(ANALYZE_TIPS[1]);
    expect(tipFor(5 * ANALYZE_TIPS.length)).toBe(ANALYZE_TIPS[0]);
  });
});

describe('correctionPrefix', () => {
  it('turns an assumption into the start of a correction', () => {
    expect(correctionPrefix('Rice is plain, no butter.')).toBe('Not rice is plain, no butter — ');
    expect(correctionPrefix('  Large eggs, about 50 g each ')).toBe(
      'Not large eggs, about 50 g each — ',
    );
  });

  it('keeps acronyms and "I" capitalized and ignores blank text', () => {
    expect(correctionPrefix('USDA values for raw weight')).toBe(
      'Not USDA values for raw weight — ',
    );
    expect(correctionPrefix('I ate the whole plate')).toBe('Not I ate the whole plate — ');
    expect(correctionPrefix('  ')).toBe('');
  });
});

describe('mentionsAmount', () => {
  it('detects numbers, fractions and common portion words', () => {
    expect(mentionsAmount('150 g chicken')).toBe(true);
    expect(mentionsAmount('½ avocado')).toBe(true);
    expect(mentionsAmount('a bowl of soup')).toBe(true);
    expect(mentionsAmount('two slices of toast')).toBe(true);
    expect(mentionsAmount('Khoury strawberry yogurt')).toBe(false);
    expect(mentionsAmount('grilled chicken with rice')).toBe(false);
  });
});

describe('analyzingStage for corrections', () => {
  it('says the correction is being applied first', () => {
    expect(analyzingStage(1, 'food_photo', 'correction')).toBe('Applying your correction…');
    expect(analyzingStage(5, 'food_photo', 'correction')).toBe('Identifying foods…');
  });
});

describe('photo roles', () => {
  const photo = (id: string): PhotoRef => ({
    id,
    url: `/api/photos/${id}`,
    thumbUrl: `/api/photos/${id}/thumb`,
    width: 10,
    height: 10,
  });

  function item(overrides: Partial<AnalysisItem> = {}): AnalysisItem {
    return {
      count: null,
      unit: null,
      unitPlural: null,
      name: 'Rice',
      grams: 150,
      nutrients: zeroNutrients(),
      per100g: zeroNutrients(),
      micros: null,
      microsPer100g: null,
      fluidMl: null,
      confidence: 'high',
      amountSource: 'visual_estimate',
      state: 'cooked',
      portionBasis: 'One cup',
      flags: [],
      savedFood: null,
      suggestedFood: null,
      ...overrides,
    };
  }

  function analysis(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
    return {
      analysisId: 'a1',
      mode: 'food_photo',
      description: 'rice bowl',
      result: {
        portion: null,
        inputType: 'food_photo',
        mealName: 'Rice bowl',
        scaleCues: 'Fork for scale',
        items: [item()],
        label: null,
        totals: zeroNutrients(),
        assumptions: ['No added oil'],
        followUpQuestion: null,
        followUpOptions: [],
        warnings: [],
      },
      photo: photo('p1'),
      photos: [{ photo: photo('p1'), role: 'food' }],
      usage: {
        model: 'mock',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        durationMs: 0,
        attempts: 1,
      },
      precise: false,
      ...overrides,
    };
  }

  it('maps analysis modes and photo roles both ways', () => {
    expect(roleForMode('food_photo')).toBe('food');
    expect(roleForMode('nutrition_label')).toBe('label');
    expect(modeForRole('food')).toBe('food_photo');
    expect(modeForRole('label')).toBe('nutrition_label');
    expect(otherRole('food')).toBe('label');
    expect(otherRole('label')).toBe('food');
  });

  it('treats a set of photos as a food photo unless they are all labels', () => {
    expect(modeForRoles(['label', 'food'])).toBe('food_photo');
    expect(modeForRoles(['label', 'label'])).toBe('nutrition_label');
    expect(modeForRoles([])).toBe('food_photo');
  });

  it('picks the first food photo as the primary one, like the server', () => {
    expect(
      primaryPhoto([
        { role: 'label', id: 1 },
        { role: 'food', id: 2 },
      ])?.id,
    ).toBe(2);
    expect(
      primaryPhoto([
        { role: 'label', id: 1 },
        { role: 'label', id: 2 },
      ])?.id,
    ).toBe(1);
    expect(primaryPhoto([])).toBeNull();
  });

  it('lists the analysis photos and falls back to the single photo', () => {
    expect(analysisPhotoRefs(null)).toEqual([]);
    const both = [
      { photo: photo('p1'), role: 'food' as const },
      { photo: photo('p2'), role: 'label' as const },
    ];
    expect(analysisPhotoRefs(analysis({ photos: both }))).toEqual(both);
    expect(analysisPhotoRefs(analysis({ mode: 'nutrition_label', photos: [] }))).toEqual([
      { photo: photo('p1'), role: 'label' },
    ]);
    expect(analysisPhotoRefs(analysis({ mode: 'text', photo: null, photos: [] }))).toEqual([]);
  });

  it('spots packaged products from the description and the estimate', () => {
    expect(looksPackaged(analysis())).toBe(false);
    expect(looksPackaged(analysis({ description: 'Khoury labneh from the tub' }))).toBe(true);
    const base = analysis().result;
    expect(looksPackaged(analysis({ result: { ...base, scaleCues: 'Yogurt jar' } }))).toBe(true);
    expect(
      looksPackaged(analysis({ result: { ...base, assumptions: ['Typical brand recipe'] } })),
    ).toBe(true);
    expect(
      looksPackaged(
        analysis({ result: { ...base, items: [item({ portionBasis: 'Half the packet' })] } }),
      ),
    ).toBe(true);
    expect(looksPackaged(analysis({ description: 'labneh with olive oil' }))).toBe(false);
  });

  it('suggests a label photo for uncertain or packaged food without a label yet', () => {
    const base = analysis().result;
    expect(labelPhotoHint(analysis())).toBeNull();
    expect(
      labelPhotoHint(analysis({ result: { ...base, items: [item({ confidence: 'low' })] } })),
    ).toBe('low_confidence');
    expect(labelPhotoHint(analysis({ description: 'Almarai laban bottle' }))).toBe('packaged');
    expect(
      labelPhotoHint(
        analysis({
          description: 'Almarai laban bottle',
          photos: [
            { photo: photo('p1'), role: 'food' },
            { photo: photo('p2'), role: 'label' },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      labelPhotoHint(
        analysis({
          result: {
            ...base,
            items: [item({ confidence: 'low' })],
            label: {
              productName: 'Laban',
              basisUnit: 'ml',
              per100: zeroNutrients(),
              microsPer100: null,
              servingSize: null,
              servingText: null,
              packSize: null,
            },
          },
        }),
      ),
    ).toBeNull();
  });
});
