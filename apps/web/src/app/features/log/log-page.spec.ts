import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { Component } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  addDays,
  zeroNutrients,
  type AnalyzeResponse,
  type CreateEntryRequest,
  type EntryDto,
  type FoodSearchQuery,
  type FoodSearchResponse,
  type FoodSearchResult,
  type MyFoodDto,
  type SaveMyFoodRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CaptureService } from '../../core/capture.service';
import { DataEventsService } from '../../core/data-events.service';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { UnsavedWorkService } from '../../core/unsaved-work.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { PRODUCT_SKIPPED } from './barcode/barcode-flow.store';
import { CAMERA_OPENER } from './barcode/camera';
import { LibraryDraftHandoff } from './library-draft-handoff';
import { LogPage } from './log-page';
import { currentDateTimeInput } from './entry-timing';
import { ImageDecodeError, type CompressedImage } from '../../shared/utils/image-compress';
import { IMAGE_COMPRESSOR, LogStore, PHOTO_TIME_READER } from './log.store';
import { installDialogShim } from './testing/dialog-shim';
import { unsavedChangesGuard } from './unsaved-changes.guard';

const ENTRY: EntryDto = {
  portion: null,
  id: 'entry-9',
  name: 'Greek yogurt',
  description: null,
  mealType: 'breakfast',
  source: 'favorite',
  timestamp: '2026-09-28T07:00:00.000Z',
  localDate: '2026-09-28',
  items: [],
  totals: { ...zeroNutrients(), calories: 150, protein: 15 },
  photo: null,
  photos: [],
  analysisId: null,
  favoriteId: 'fav-1',
  productId: null,
  createdAt: '2026-09-28T07:00:00.000Z',
  updatedAt: '2026-09-28T07:00:00.000Z',
};

const PLATE: FoodSearchResult = {
  portion: null,
  key: 'meal:entry-2',
  kind: 'meal',
  name: 'Chicken plate',
  detail: null,
  items: [
    { name: 'Chicken', grams: 180, nutrients: { ...zeroNutrients(), calories: 390, protein: 45 } },
    { name: 'Fries', grams: 120, nutrients: { ...zeroNutrients(), calories: 370, fat: 18 } },
  ],
  totals: { ...zeroNutrients(), calories: 760, protein: 45, fat: 18 },
  grams: 300,
  mealType: 'lunch',
  photo: null,
  favoriteId: null,
  entryId: 'entry-2',
  useCount: 3,
  lastUsedAt: null,
  productId: null,
  starred: false,
};

const LIBRARY: FoodSearchResponse = { query: '', results: [PLATE] };

const ANALYSIS: AnalyzeResponse = {
  analysisId: 'analysis-7',
  mode: 'text',
  description: 'two boiled eggs',
  result: {
    inputType: 'text',
    mealName: 'Boiled eggs',
    portion: null,
    scaleCues: '',
    items: [
      {
        count: null,
        unit: null,
        unitPlural: null,
        name: 'Boiled egg',
        grams: 100,
        nutrients: { ...zeroNutrients(), calories: 155, protein: 12.6, fat: 10.6, carbs: 1.1 },
        per100g: { ...zeroNutrients(), calories: 155, protein: 12.6, fat: 10.6, carbs: 1.1 },
        micros: null,
        microsPer100g: null,
        fluidMl: null,
        confidence: 'high',
        amountSource: 'user_stated',
        state: 'cooked',
        portionBasis: 'Two large eggs',
        flags: [],
        savedFood: null,
        suggestedFood: null,
      },
    ],
    label: null,
    totals: zeroNutrients(),
    assumptions: ['Large eggs, about 50 g each', 'Boiled without salt'],
    followUpQuestion: null,
    followUpOptions: [],
    warnings: ['Salt not included'],
  },
  photo: null,
  photos: [],
  usage: {
    model: 'mock',
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    durationMs: 800,
    attempts: 1,
  },
  precise: false,
};

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  )!;

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('LogPage', () => {
  const api = {
    analyze: vi.fn(),
    createEntry: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
    searchFoods: vi.fn<(query: FoodSearchQuery) => Promise<FoodSearchResponse>>(),
    quickLog: vi.fn(),
    deleteEntry: vi.fn(),
    getProfile: vi.fn(),
    renameFood: vi.fn(),
    createMyFood: vi.fn<(body: SaveMyFoodRequest) => Promise<MyFoodDto>>(),
    authStatus: vi.fn(),
  };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  let navigate: ReturnType<typeof vi.spyOn>;
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockReset());
    confirm.confirm.mockReset();
    confirm.confirm.mockResolvedValue(true);
    api.searchFoods.mockResolvedValue(LIBRARY);
    api.getProfile.mockRejectedValue(new Error('offline'));
    api.analyze.mockResolvedValue(ANALYSIS);
    api.createEntry.mockImplementation(async (body: CreateEntryRequest) => ({
      ...ENTRY,
      id: 'entry-new',
      name: body.name,
    }));
    api.deleteEntry.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function render(): Promise<{ fixture: ComponentFixture<LogPage>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(LogPage);
    await fixture.whenStable();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function reachReview(fixture: ComponentFixture<LogPage>, el: HTMLElement): Promise<void> {
    buttonWith(el, 'Describe').click();
    await fixture.whenStable();
    typeInto(el.querySelector<HTMLTextAreaElement>('textarea')!, 'two boiled eggs');
    await fixture.whenStable();
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
  }

  it('says a demo AI result is a simulated example, not a reading of the photo', async () => {
    api.authStatus.mockResolvedValue({
      setupRequired: false,
      authenticated: true,
      user: { id: 'demo-user', email: 'demo@demo.invalid', name: null, role: 'member' },
      demo: { enabled: true, expiresAt: '2026-10-24T09:00:00.000Z' },
    });
    await TestBed.inject(AuthService).ensureLoaded();
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    const note = el.querySelector('[data-demo-result]');
    expect(note?.textContent).toContain('Simulated example');
    expect(note?.textContent).toContain('never sends your photo');
  });

  it('shows no simulated-result note outside the demo', async () => {
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.querySelector('[data-demo-result]')).toBeNull();
  });

  it('opens on the food search with quick capture actions', async () => {
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain('Log food');
    expect(el.querySelector('#food-search')).not.toBeNull();
    expect(buttonWith(el, 'Take photo')).toBeDefined();
    expect(el.querySelector('button[aria-label="Add manually"]')).not.toBeNull();
    expect(api.searchFoods).toHaveBeenCalledWith({ limit: 20 });
    expect(el.textContent).toContain('Chicken plate');
  });

  it('asks the AI about a search that has no match, prefilled and ready to refine', async () => {
    api.searchFoods.mockResolvedValue({ query: 'x', results: [] });
    const { fixture, el } = await render();
    typeInto(el.querySelector<HTMLInputElement>('#food-search')!, 'Khoury yogurt');
    el.querySelector('form[role="search"]')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Describe your meal');
    expect(el.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Khoury yogurt');
    expect(el.textContent).toContain('Add how much');
  });

  it('consumes a capture that arrives while the page is open and runs describe → review → save', async () => {
    const { fixture, el } = await render();
    TestBed.inject(CaptureService).startText();
    await fixture.whenStable();
    expect(TestBed.inject(CaptureService).pending()).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('Describe your meal');

    const analyze = buttonWith(el, 'Analyze');
    expect(analyze.disabled).toBe(true);
    const textarea = el.querySelector<HTMLTextAreaElement>('textarea')!;
    typeInto(textarea, 'two boiled eggs');
    await fixture.whenStable();
    buttonWith(el, 'homemade').click();
    await fixture.whenStable();
    expect(textarea.value).toBe('two boiled eggs, homemade');

    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    expect(api.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'text', description: 'two boiled eggs, homemade' }),
      [],
    );
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.textContent).toContain('Salt not included');
    expect(el.textContent).toContain('Large eggs, about 50 g each');
    expect(el.textContent).toContain('mock · $0 · 0.8 s');
    expect(el.querySelector('button[data-item-row]')?.textContent).toContain('Boiled egg');
    expect(el.textContent).toContain('How much did you eat?');

    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Boiled eggs', source: 'text', analysisId: 'analysis-7' }),
    );
    expect(TestBed.inject(DataEventsService).entries()).toBe(1);
    expect(navigate).toHaveBeenCalledWith('/today');
    const saved = TestBed.inject(ToastService)
      .toasts()
      .find((toast) => toast.message === 'Saved Boiled eggs');
    expect(saved?.action?.label).toBe('View');
  });

  it('splits a described day into meals, saves one after a review and the rest together', async () => {
    const meal = (
      analysisId: string,
      mealName: string,
      timing: AnalyzeResponse['timing'],
    ): AnalyzeResponse => ({
      ...ANALYSIS,
      analysisId,
      description: `${mealName} words`,
      result: { ...ANALYSIS.result, mealName },
      timing,
    });
    api.analyze.mockResolvedValue({
      ...meal('analysis-b', 'Boiled eggs', { mealType: 'breakfast', time: '07:30', daysAgo: 1 }),
      moreMeals: [
        meal('analysis-l', 'Chicken wrap', { mealType: 'lunch', time: '13:15', daysAgo: 1 }),
        meal('analysis-d', 'Lentil soup', { mealType: 'dinner', time: '20:10', daysAgo: 1 }),
      ],
    });
    const { fixture, el } = await render();
    await reachReview(fixture, el);

    expect(api.analyze).toHaveBeenCalledWith(expect.objectContaining({ split: 'true' }), []);
    expect(el.querySelector('h1')?.textContent).toContain('3 meals found');
    const rows = (): HTMLElement[] =>
      Array.from(el.querySelectorAll<HTMLElement>('[data-testid="meal-row"]'));
    expect(
      rows().map((row) => row.querySelector<HTMLInputElement>('input[type="time"]')?.value),
    ).toEqual(['07:30', '13:15', '20:10']);
    expect(rows()[0]?.textContent).toContain('Breakfast');
    expect(rows()[0]?.textContent).not.toContain('Yesterday');
    expect(el.textContent).toContain('Eaten yesterday');
    expect(rows()[0]?.textContent).toContain('Boiled egg 100 g');
    expect(el.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe(
      addDays(todayLocalDate(), -1),
    );
    expect(buttonWith(el, 'Save 3 meals').textContent).toContain('465');

    el.querySelector<HTMLButtonElement>('button[aria-label^="Review Chicken wrap"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.textContent).toContain('Meal 2 of 3');
    expect(buttonWith(el, 'Save as draft')).toBeUndefined();

    el.querySelector<HTMLButtonElement>('button[aria-label="Back to all meals"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('3 meals found');
    expect(confirm.confirm).not.toHaveBeenCalled();

    el.querySelector<HTMLButtonElement>('button[aria-label^="Review Chicken wrap"]')!.click();
    await fixture.whenStable();
    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chicken wrap',
        mealType: 'lunch',
        analysisId: 'analysis-l',
        localDate: addDays(todayLocalDate(), -1),
      }),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(el.querySelector('h1')?.textContent).toContain('2 meals found');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .some((toast) => toast.message === 'Saved Chicken wrap · 2 meals left'),
    ).toBe(true);

    el.querySelector<HTMLButtonElement>('button[aria-label="Remove Lentil soup"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('1 meal left');

    buttonWith(el, 'Save meal').click();
    await fixture.whenStable();
    expect(api.createEntry).toHaveBeenCalledTimes(2);
    expect(api.createEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: 'Boiled eggs',
        mealType: 'breakfast',
        analysisId: 'analysis-b',
      }),
    );
    expect(navigate).toHaveBeenCalledWith('/today');
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .some((toast) => toast.message === 'Saved 1 meal'),
    ).toBe(true);
  });

  it('asks before throwing away meals that were split but not saved', async () => {
    api.analyze.mockResolvedValue({
      ...ANALYSIS,
      timing: { mealType: 'breakfast', time: null, daysAgo: 1 },
      moreMeals: [
        {
          ...ANALYSIS,
          analysisId: 'analysis-8',
          timing: { mealType: 'lunch', time: null, daysAgo: 1 },
        },
      ],
    });
    confirm.confirm.mockResolvedValueOnce(false);
    const { fixture, el } = await render();
    await reachReview(fixture, el);

    el.querySelector<HTMLButtonElement>('button[aria-label="Discard meals"]')!.click();
    await fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Discard these meals?' }),
    );
    expect(el.querySelector('h1')?.textContent).toContain('2 meals found');

    el.querySelector<HTMLButtonElement>('button[aria-label="Discard meals"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Log food');
  });

  it('offers ways to log without AI when the monthly AI budget is used up', async () => {
    api.analyze.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 429,
        error: { statusCode: 429, message: 'Your monthly AI budget is used up' },
      }),
    );
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    const card = el.querySelector('app-error-card')!;
    expect(card.textContent).toContain("You've used this month's AI budget");
    expect(card.textContent).not.toContain('AI_MONTHLY_BUDGET_USD');
    for (const label of ['Search my foods', 'Scan barcode', 'Log manually']) {
      expect(buttonWith(card as HTMLElement, label)).toBeDefined();
    }
    expect(buttonWith(card as HTMLElement, 'Try again')).toBeUndefined();

    const capture = TestBed.inject(CaptureService);
    const openSearch = vi.spyOn(capture, 'openSearch').mockImplementation(() => undefined);
    const requestBarcode = vi.spyOn(capture, 'requestBarcode').mockImplementation(() => undefined);
    buttonWith(card as HTMLElement, 'Search my foods').click();
    expect(openSearch).toHaveBeenCalledTimes(1);
    buttonWith(card as HTMLElement, 'Scan barcode').click();
    expect(requestBarcode).toHaveBeenCalledTimes(1);
  });

  it('tells a member without AI how to log instead of naming server settings', async () => {
    api.getProfile.mockResolvedValue({
      ai: {
        provider: 'unconfigured',
        defaultModel: 'gpt-5.6-sol',
        preciseModel: 'gpt-6-astra',
        activeModel: 'gpt-5.6-sol',
        reasoningEffort: 'low',
        availableModels: [],
        monthlyBudgetUsd: null,
      },
    });
    const { fixture, el } = await render();
    buttonWith(el, 'Describe').click();
    await fixture.whenStable();
    await fixture.whenStable();
    const banner = Array.from(el.querySelectorAll('[role="status"]')).find((node) =>
      node.textContent?.includes('AI is not set up.'),
    )!;
    expect(banner.textContent?.replace(/\s+/g, ' ')).toContain(
      'AI is not set up. Log from your foods, scan a barcode or enter this meal manually.',
    );
    expect(banner.textContent).not.toContain('Settings → AI');
  });

  it('halves the whole meal from the portion chips before saving', async () => {
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    el.querySelector<HTMLButtonElement>('button[aria-label="½ of the estimate"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('button[data-item-row]')?.textContent).toContain('50 g');
    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry.mock.calls[0]![0].items[0]).toMatchObject({ grams: 50 });
  });

  it('reviews the meal’s vitamins in a collapsed section and saves them with the drink ml', async () => {
    const [egg] = ANALYSIS.result.items;
    api.analyze.mockResolvedValue({
      ...ANALYSIS,
      result: {
        ...ANALYSIS.result,
        items: [
          { ...egg!, micros: { vitaminD: 2.2, vitaminB12: 1.1 }, microsPer100g: null },
          {
            ...egg!,
            name: 'Diet Pepsi',
            grams: 330,
            nutrients: { ...zeroNutrients(), sodium: 40 },
            per100g: { ...zeroNutrients(), sodium: 12 },
            micros: { caffeine: 36 },
            microsPer100g: { caffeine: 10.9 },
            fluidMl: 330,
          },
        ],
      },
    });
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    const card = el.querySelector('app-micros-card')!;
    const toggle = card.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.textContent).toContain('Vitamins & minerals');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(card.querySelector('[data-micro="vitaminB12"]')?.textContent).toContain('1.1 µg');
    expect(card.querySelector('[data-micro="caffeine"]')?.textContent).toContain('36 mg');
    expect(card.querySelector('[data-micros-disclaimer]')).not.toBeNull();

    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    const [eggs, pepsi] = api.createEntry.mock.calls[0]![0].items;
    expect(eggs).toMatchObject({ micros: { vitaminD: 2.2, vitaminB12: 1.1 } });
    expect(eggs).not.toHaveProperty('fluidMl');
    expect(pepsi).toMatchObject({ micros: { caffeine: 36 }, fluidMl: 330 });
  });

  it('saves a label without a barcode to My foods and links its item', async () => {
    const label = {
      productName: 'Crunchy granola',
      basisUnit: 'g' as const,
      per100: { ...zeroNutrients(), calories: 450, protein: 10, carbs: 60, fat: 18 },
      servingSize: 40,
      servingText: '40 g',
      packSize: 500,
    };
    api.analyze.mockResolvedValue({
      ...ANALYSIS,
      mode: 'nutrition_label',
      result: {
        ...ANALYSIS.result,
        inputType: 'nutrition_label',
        mealName: 'Granola',
        label,
        items: [
          {
            ...ANALYSIS.result.items[0]!,
            name: 'Granola',
            grams: 40,
            amountSource: 'label',
            nutrients: { ...zeroNutrients(), calories: 180, protein: 4, carbs: 24, fat: 7.2 },
            per100g: label.per100,
          },
        ],
      },
    });
    api.createMyFood.mockImplementation(async (body) => ({
      ...body,
      microsPer100: body.microsPer100 ?? null,
      id: 'food-granola',
      barcode: null,
      brand: body.brand ?? null,
      aliases: [],
      unitName: null,
      unitGrams: null,
      servingSizeG: body.servingSizeG ?? null,
      packSizeG: null,
      source: body.source ?? 'label',
      imageUrl: null,
      missingNutrients: [],
      useCount: 0,
      lastUsedAt: null,
      itemCount: 0,
    }));
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    buttonWith(el, 'Save to My foods').click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('From the label.');
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.createMyFood).toHaveBeenCalledWith({
      name: 'Crunchy granola',
      brand: null,
      basisUnit: 'g',
      per100: label.per100,
      unitName: null,
      unitGrams: null,
      servingSizeG: 40,
      source: 'label',
    });
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('In My foods as Crunchy granola');
    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry.mock.calls[0]![0].items[0]).toMatchObject({
      name: 'Crunchy granola',
      productId: 'food-granola',
      grams: 40,
    });
  });

  it('corrects the AI with a re-run that keeps the photo and description', async () => {
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    buttonWith(el, 'Correct the AI').click();
    await fixture.whenStable();
    buttonWith(el, 'I ate half').click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLTextAreaElement>('app-correct-ai-card textarea')!;
    expect(field.value).toBe('I ate half');
    expect(document.activeElement).toBe(field);
    api.analyze.mockResolvedValueOnce({ ...ANALYSIS, analysisId: 'analysis-8' });
    buttonWith(el, 'Re-estimate').click();
    await fixture.whenStable();

    expect(confirm.confirm).not.toHaveBeenCalled();
    expect(api.analyze).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'text',
        description: 'two boiled eggs',
        previousAnalysisId: 'analysis-7',
        followUpAnswer: 'I ate half',
      }),
      [],
    );
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.querySelector('app-correct-ai-card textarea')).toBeNull();
  });

  it('prefills a correction from an assumption and confirms before replacing edits', async () => {
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    el.querySelector<HTMLButtonElement>('button[aria-label="½ of the estimate"]')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Correct: Large eggs, about 50 g each"]',
    )!.click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLTextAreaElement>('app-correct-ai-card textarea')!;
    expect(field.value).toBe('Not large eggs, about 50 g each — ');
    typeInto(field, `${field.value}medium eggs`);
    await fixture.whenStable();

    confirm.confirm.mockResolvedValueOnce(false);
    buttonWith(el, 'Re-estimate').click();
    await fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Replace your edits?' }),
    );
    expect(api.analyze).toHaveBeenCalledTimes(1);

    buttonWith(el, 'Re-estimate').click();
    await fixture.whenStable();
    expect(api.analyze).toHaveBeenLastCalledWith(
      expect.objectContaining({
        followUpAnswer: 'Not large eggs, about 50 g each — medium eggs',
      }),
      [],
    );
    expect(el.querySelector('button[aria-label="All of it"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens a library food in the full editor and saves it as a copy', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[data-result-key="meal:entry-2"]')!.click();
    await fixture.whenStable();
    buttonWith(el, 'Edit before saving').click();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.textContent).toContain('From your food library');
    expect(el.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Chicken plate');
    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Chicken plate', source: 'copy', analysisId: null }),
    );
  });

  it('offers to rename past entries after starring the meal under another name', async () => {
    api.createFavoriteFromEntry.mockImplementation(
      async (_id: string, body: { name?: string }) => ({ id: 'fav-3', name: body.name }),
    );
    api.renameFood.mockResolvedValue({ matchedEntries: 2, renamedEntries: 0, renamedItems: 0 });
    confirm.confirm.mockResolvedValue(false);
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    el.querySelector<HTMLButtonElement>('button[role="switch"]')!.click();
    await fixture.whenStable();
    typeInto(el.querySelector<HTMLInputElement>('#review-favorite-name')!, 'Egg breakfast');
    await fixture.whenStable();

    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-new', {
      name: 'Egg breakfast',
    });
    expect(api.renameFood).toHaveBeenCalledWith({
      from: 'Boiled eggs',
      to: 'Egg breakfast',
      dryRun: true,
    });
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Also rename past entries?' }),
    );
  });

  it('opens a draft handed over from another page in the full editor', async () => {
    TestBed.inject(LibraryDraftHandoff).offer({
      portion: null,
      name: 'Chicken plate',
      items: PLATE.items,
      mealType: 'dinner',
      mealTypeAuto: false,
      dateTime: '2026-09-25T20:15',
      photo: null,
    });
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Chicken plate');
    expect(el.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toBe(
      '2026-09-25T20:15',
    );
    expect(TestBed.inject(LibraryDraftHandoff).take()).toBeNull();
  });

  it('reports unsaved work to the app while a meal is in progress', async () => {
    const unsaved = TestBed.inject(UnsavedWorkService);
    const { fixture, el } = await render();
    expect(unsaved.hasUnsavedWork()).toBe(false);

    await reachReview(fixture, el);
    expect(unsaved.hasUnsavedWork()).toBe(true);

    fixture.destroy();
    expect(unsaved.hasUnsavedWork()).toBe(false);
  });

  it('starts from a capture that was pending before the page was created', async () => {
    TestBed.inject(CaptureService).startText();
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain('Describe your meal');
    expect(api.searchFoods).not.toHaveBeenCalled();
  });

  it('opens a manual review with one empty item', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="Add manually"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.textContent).toContain('Manual entry');
    expect(el.querySelectorAll('input[data-item-name]')).toHaveLength(1);
    expect(el.textContent).not.toContain('How much did you eat?');

    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Item 1 needs a name.');
  });

  it('keeps focus on the save button instead of jumping to the top while saving', async () => {
    api.createEntry.mockReturnValueOnce(new Promise<EntryDto>(() => undefined));
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="Add manually"]')!.click();
    await fixture.whenStable();
    expect(document.activeElement?.textContent).toContain('Review meal');

    typeInto(el.querySelector<HTMLInputElement>('input[data-item-name]')!, 'Banana');
    await fixture.whenStable();
    const save = buttonWith(el, 'Save to log');
    save.focus();
    save.click();
    await fixture.whenStable();
    expect(api.createEntry).toHaveBeenCalled();
    expect(el.textContent).toContain('Saving');
    expect(document.activeElement).toBe(save);
  });

  it('switches to the focused search on request, asking before dropping an unsaved meal', async () => {
    const { fixture, el } = await render();
    await reachReview(fixture, el);
    confirm.confirm.mockResolvedValueOnce(false);
    TestBed.inject(CaptureService).openSearch();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Discard this meal?' }),
    );

    TestBed.inject(CaptureService).openSearch('eggs');
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Log food');
    const input = el.querySelector<HTMLInputElement>('#food-search')!;
    expect(input.value).toBe('eggs');
    expect(document.activeElement).toBe(input);
  });

  it('prefills the search from a ?q= deep link and focuses it for ?search=1', async () => {
    const { fixture, el } = await render();
    fixture.componentRef.setInput('q', ' yogurt ');
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#food-search')!;
    expect(input.value).toBe('yogurt');
    expect(document.activeElement).not.toBe(input);

    fixture.componentRef.setInput('search', '1');
    await fixture.whenStable();
    await fixture.whenStable();
    expect(document.activeElement).toBe(input);
  });
});

@Component({ template: '<p>Elsewhere</p>' })
class Elsewhere {}

describe('LogPage leave guard', () => {
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  const api = {
    searchFoods: vi.fn(),
    getProfile: vi.fn(),
  };

  beforeEach(() => {
    confirm.confirm.mockReset();
    api.searchFoods.mockResolvedValue({ query: '', results: [] });
    api.getProfile.mockRejectedValue(new Error('offline'));
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'log', component: LogPage, canDeactivate: [unsavedChangesGuard] },
            { path: 'today', component: Elsewhere },
            { path: 'login', component: Elsewhere },
          ],
          withComponentInputBinding(),
        ),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
  });

  async function openManualMeal(harness: RouterTestingHarness): Promise<void> {
    const el = harness.routeNativeElement!;
    el.querySelector<HTMLButtonElement>('button[aria-label="Add manually"]')!.click();
    await harness.fixture.whenStable();
    typeInto(el.querySelector<HTMLInputElement>('input[data-item-name]')!, 'Banana');
    await harness.fixture.whenStable();
  }

  it('asks before a nav tab throws away an unsaved meal', async () => {
    await openManualMeal(await RouterTestingHarness.create('/log'));
    const router = TestBed.inject(Router);

    confirm.confirm.mockResolvedValueOnce(false);
    expect(await router.navigateByUrl('/today')).toBe(false);
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Discard this meal?' }),
    );
    expect(router.url).toBe('/log');

    confirm.confirm.mockResolvedValueOnce(true);
    expect(await router.navigateByUrl('/today')).toBe(true);
    expect(router.url).toBe('/today');
  });

  it('leaves without asking when nothing was entered or the session expired', async () => {
    const harness = await RouterTestingHarness.create('/log');
    const router = TestBed.inject(Router);
    expect(await router.navigateByUrl('/today')).toBe(true);

    await harness.navigateByUrl('/log');
    await openManualMeal(harness);
    expect(await router.navigateByUrl('/login?next=%2Flog')).toBe(true);
    expect(confirm.confirm).not.toHaveBeenCalled();
  });

  it('asks once when a search link arrives while a meal is unsaved', async () => {
    const harness = await RouterTestingHarness.create('/log');
    await openManualMeal(harness);
    confirm.confirm.mockResolvedValue(false);
    expect(await TestBed.inject(Router).navigateByUrl('/log?search=1')).toBe(true);
    await harness.fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledTimes(1);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('Review meal');

    confirm.confirm.mockResolvedValue(true);
    await harness.navigateByUrl('/log?q=banana');
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement!;
    expect(el.querySelector('h1')?.textContent).toContain('Log food');
    expect(el.querySelector<HTMLInputElement>('#food-search')?.value).toBe('banana');
  });
});

describe('LogPage barcode scanning', () => {
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  const api = {
    searchFoods: vi.fn(),
    getProfile: vi.fn(),
    analyze: vi.fn(),
    createEntry: vi.fn(),
    upsertProduct: vi.fn(),
  };
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    confirm.confirm.mockReset();
    Object.values(api).forEach((mock) => mock.mockReset());
    api.searchFoods.mockResolvedValue({ query: '', results: [] });
    api.getProfile.mockRejectedValue(new Error('offline'));
    api.analyze.mockResolvedValue(ANALYSIS);
    api.createEntry.mockImplementation(async (body: CreateEntryRequest) => ({
      ...ENTRY,
      id: 'entry-new',
      name: body.name,
    }));
    api.upsertProduct.mockResolvedValue({});
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: 'log', component: LogPage, canDeactivate: [unsavedChangesGuard] },
            { path: 'today', component: Elsewhere },
          ],
          withComponentInputBinding(),
        ),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
        { provide: CAMERA_OPENER, useValue: () => new Promise<MediaStream>(() => undefined) },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  it('opens the scanner from ?scan=1 and drops the parameter when it closes', async () => {
    const harness = await RouterTestingHarness.create('/log?scan=1');
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement!;
    expect(el.querySelector('dialog.scanner')?.hasAttribute('open')).toBe(true);

    el.querySelector<HTMLButtonElement>('button[aria-label="Close scanner"]')!.click();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(el.querySelector('app-barcode-scanner')).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/log');
  });

  it('goes back to the page the scanner was opened from when it is closed without a scan', async () => {
    const harness = await RouterTestingHarness.create('/today');
    const router = TestBed.inject(Router);
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    TestBed.inject(CaptureService).requestBarcode();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(router.url).toBe('/log?scan=1');
    const el = harness.routeNativeElement!;
    expect(el.querySelector('dialog.scanner')?.hasAttribute('open')).toBe(true);

    el.querySelector<HTMLButtonElement>('button[aria-label="Close scanner"]')!.click();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(back).toHaveBeenCalledTimes(1);
    expect(router.url).toBe('/log?scan=1');
  });

  it('stays on the log page when the scanner was opened there', async () => {
    const harness = await RouterTestingHarness.create('/today');
    await harness.navigateByUrl('/log');
    const back = vi.spyOn(TestBed.inject(Location), 'back');
    const el = harness.routeNativeElement!;
    buttonWith(el, 'Scan barcode').click();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/log?scan=1');

    el.querySelector<HTMLButtonElement>('button[aria-label="Close scanner"]')!.click();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(back).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/log');
  });

  it('opens the scanner from the capture home button', async () => {
    const harness = await RouterTestingHarness.create('/log');
    const el = harness.routeNativeElement!;
    buttonWith(el, 'Scan barcode').click();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(el.querySelector('app-barcode-scanner')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/log?scan=1');
  });

  it('asks before a scan request drops an unsaved meal', async () => {
    const harness = await RouterTestingHarness.create('/log');
    const el = harness.routeNativeElement!;
    el.querySelector<HTMLButtonElement>('button[aria-label="Add manually"]')!.click();
    await harness.fixture.whenStable();
    typeInto(el.querySelector<HTMLInputElement>('input[data-item-name]')!, 'Banana');
    await harness.fixture.whenStable();

    confirm.confirm.mockResolvedValueOnce(false);
    TestBed.inject(CaptureService).requestBarcode();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledTimes(1);
    expect(el.querySelector('app-barcode-scanner')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('input[data-item-name]')?.value).toBe('Banana');

    confirm.confirm.mockResolvedValueOnce(true);
    TestBed.inject(CaptureService).requestBarcode();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
    expect(el.querySelector('app-barcode-scanner')).not.toBeNull();
  });

  it('confirms that the barcode was remembered after saving the entry', async () => {
    const harness = await RouterTestingHarness.create('/log');
    const el = harness.routeNativeElement!;
    const store = harness.routeDebugElement!.injector.get(LogStore);
    store.start({ file: null, mode: 'text', source: 'text', barcode: '5281234567896' });
    await harness.fixture.whenStable();
    expect(el.textContent).toContain('Barcode 5 281234 567896');
    typeInto(el.querySelector<HTMLTextAreaElement>('textarea')!, 'two boiled eggs');
    await harness.fixture.whenStable();
    buttonWith(el, 'Analyze').click();
    await harness.fixture.whenStable();
    expect(el.textContent).toContain('Saved with this food, so the next scan is instant.');
    buttonWith(el, 'Save to log').click();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();

    expect(api.upsertProduct).toHaveBeenCalledWith(
      '5281234567896',
      expect.objectContaining({ name: 'Boiled eggs', source: 'manual' }),
    );
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
      'Saved — next time just scan the barcode',
    );
  });

  it('explains when a barcode is not remembered because its per-100 values look wrong', async () => {
    const pinch = ANALYSIS.result.items[0]!;
    api.analyze.mockResolvedValue({
      ...ANALYSIS,
      result: {
        ...ANALYSIS.result,
        mealName: 'Sugar',
        items: [
          {
            ...pinch,
            name: 'Sugar',
            grams: 0.5,
            nutrients: { ...zeroNutrients(), calories: 20, carbs: 5 },
            per100g: { ...zeroNutrients(), calories: 4000, carbs: 1000 },
          },
        ],
      },
    });
    const harness = await RouterTestingHarness.create('/log');
    const el = harness.routeNativeElement!;
    const store = harness.routeDebugElement!.injector.get(LogStore);
    store.start({ file: null, mode: 'text', source: 'text', barcode: '5281234567896' });
    await harness.fixture.whenStable();
    typeInto(el.querySelector<HTMLTextAreaElement>('textarea')!, 'a pinch of sugar');
    await harness.fixture.whenStable();
    buttonWith(el, 'Analyze').click();
    await harness.fixture.whenStable();
    expect(el.textContent).toContain(
      "The per-100 values look off, so this barcode won't be remembered.",
    );

    buttonWith(el, 'Save to log').click();
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();

    expect(api.createEntry).toHaveBeenCalledTimes(1);
    expect(api.upsertProduct).not.toHaveBeenCalled();
    const toasts = TestBed.inject(ToastService).toasts();
    expect(toasts.map((toast) => toast.message)).toEqual(['Saved Sugar', PRODUCT_SKIPPED]);
    expect(toasts.at(-1)?.kind).toBe('info');
  });
});

describe('LogPage photo time', () => {
  const [takenYear, takenMonth, takenDay] = addDays(todayLocalDate(), -1)
    .split('-')
    .map(Number) as [number, number, number];
  const taken = new Date(takenYear, takenMonth - 1, takenDay, 13, 5, 0, 0);
  const api = {
    analyze: vi.fn(),
    searchFoods: vi.fn(),
    getProfile: vi.fn(),
  };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockReset());
    api.searchFoods.mockResolvedValue(LIBRARY);
    api.getProfile.mockRejectedValue(new Error('offline'));
    api.analyze.mockResolvedValue({ ...ANALYSIS, mode: 'food_photo' });
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: { confirm: vi.fn(async () => true) } },
        { provide: PHOTO_TIME_READER, useValue: vi.fn(async () => taken) },
        {
          provide: IMAGE_COMPRESSOR,
          useValue: vi.fn(async (blob: Blob) => ({ blob, width: 1, height: 1 })),
        },
      ],
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  const note = (el: HTMLElement): string =>
    el.querySelector('app-photo-time-note')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('shows the photo time while composing, lets it be changed and carries it into the review', async () => {
    const fixture = TestBed.createComponent(LogPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const store = fixture.debugElement.injector.get(LogStore);
    store.start({
      file: new File(['jpeg'], 'IMG_0042.jpg', { type: 'image/jpeg' }),
      mode: 'food_photo',
      source: 'library',
    });
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Food photo');
    expect(note(el)).toContain('Time from photo · Yesterday 13:05');

    buttonWith(el.querySelector('app-photo-time-note')!, 'Change').click();
    await fixture.whenStable();
    const time = el.querySelector<HTMLInputElement>('#compose-time')!;
    expect(document.activeElement).toBe(time);
    expect(time.value).toBe(currentDateTimeInput(taken));
    typeInto(time, `${currentDateTimeInput(taken).slice(0, 10)}T20:30`);
    await fixture.whenStable();
    expect(store.mealType()).toBe('dinner');
    expect(note(el)).toContain('Use photo time · Yesterday 13:05');

    buttonWith(el, 'Use photo time').click();
    await fixture.whenStable();
    expect(store.dateTime()).toBe(currentDateTimeInput(taken));
    expect(store.mealType()).toBe('lunch');

    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.analyze.mock.calls[0]![0]).toMatchObject({
      localTime: currentDateTimeInput(taken),
      mealType: 'lunch',
    });
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toBe(
      currentDateTimeInput(taken),
    );
    expect(note(el)).toContain('Time from photo · Yesterday 13:05');
  });

  it('keeps the current time for camera photos', async () => {
    const fixture = TestBed.createComponent(LogPage);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    fixture.debugElement.injector.get(LogStore).start({
      file: new File(['jpeg'], 'camera.jpg', { type: 'image/jpeg' }),
      mode: 'food_photo',
      source: 'camera',
    });
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('app-photo-time-note')).toBeNull();
    expect(TestBed.inject(PHOTO_TIME_READER)).not.toHaveBeenCalled();
  });
});

describe('LogPage photos and label photos', () => {
  const api = {
    analyze: vi.fn(),
    searchFoods: vi.fn(),
    getProfile: vi.fn(),
    createEntry: vi.fn(),
  };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let restoreDialog: () => void;
  let camera: HTMLInputElement;
  let library: HTMLInputElement;

  const PHOTO = (id: string) => ({
    id,
    url: `/api/photos/${id}`,
    thumbUrl: `/api/photos/${id}/thumb`,
    width: 10,
    height: 10,
  });

  const PHOTO_ANALYSIS: AnalyzeResponse = {
    ...ANALYSIS,
    analysisId: 'analysis-photo',
    mode: 'food_photo',
    description: null,
    result: {
      ...ANALYSIS.result,
      inputType: 'food_photo',
      mealName: 'Labneh plate',
      assumptions: ['Full-fat labneh'],
      warnings: [],
    },
    photo: PHOTO('p1'),
    photos: [
      { photo: PHOTO('p1'), role: 'food' },
      { photo: PHOTO('p2'), role: 'label' },
    ],
  };

  function fileInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    vi.spyOn(input, 'click').mockImplementation(() => undefined);
    return input;
  }

  function choose(input: HTMLInputElement, names: string[]): void {
    const files = names.map((name) => new File([name], name, { type: 'image/jpeg' }));
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: { item: (index: number) => files[index] ?? null, length: files.length },
    });
    input.dispatchEvent(new Event('change'));
  }

  const chips = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('app-compose-panel li button[aria-label^="Photo "]')).map(
      (button) => button.textContent?.trim() ?? '',
    );

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockReset());
    confirm.confirm.mockReset();
    confirm.confirm.mockResolvedValue(true);
    api.searchFoods.mockResolvedValue(LIBRARY);
    api.getProfile.mockRejectedValue(new Error('offline'));
    api.analyze.mockResolvedValue(PHOTO_ANALYSIS);
    URL.createObjectURL = vi.fn((blob: Blob) => `blob:${(blob as File).name}`);
    URL.revokeObjectURL = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
        { provide: PHOTO_TIME_READER, useValue: vi.fn(async () => null) },
        {
          provide: IMAGE_COMPRESSOR,
          useValue: vi.fn(async (blob: Blob) => ({ blob, width: 1, height: 1 })),
        },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    camera = fileInput();
    library = fileInput();
    TestBed.inject(CaptureService).attachInputs({ camera, library });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function composeWith(
    name: string,
  ): Promise<{ fixture: ComponentFixture<LogPage>; el: HTMLElement; store: LogStore }> {
    const fixture = TestBed.createComponent(LogPage);
    await fixture.whenStable();
    const store = fixture.debugElement.injector.get(LogStore);
    store.start({
      file: new File([name], name, { type: 'image/jpeg' }),
      mode: 'food_photo',
      source: 'camera',
    });
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, store };
  }

  it('adds a label photo before the first analysis and sends both photos with their roles', async () => {
    const { fixture, el } = await composeWith('labneh.jpg');
    expect(el.textContent).toContain('Add a label photo');
    expect(el.querySelector('app-segmented-control')).not.toBeNull();

    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Add a photo with the camera"]',
    )!.click();
    expect(camera.click).toHaveBeenCalled();
    choose(camera, ['label.jpg']);
    await fixture.whenStable();

    expect(el.querySelector('h1')?.textContent).toContain('Food & label');
    expect(chips(el)).toEqual(['Food', 'Label']);
    expect(el.querySelector('app-segmented-control')).toBeNull();
    expect(el.querySelector('app-compose-panel')?.textContent).toContain('2/3');

    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    const [fields, images] = api.analyze.mock.calls[0]!;
    expect(fields).toMatchObject({ mode: 'food_photo' });
    expect(images.map((image: { role: string }) => image.role)).toEqual(['food', 'label']);
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    const thumbs = el.querySelectorAll('app-photo-strip li button');
    expect(Array.from(thumbs).map((button) => button.getAttribute('aria-label'))).toEqual([
      'View photo 1 of 2, food, cover',
      'View photo 2 of 2, label',
    ]);
    expect(el.querySelector('app-photo-strip')?.textContent).toContain('Label');
    expect(el.querySelector('app-label-photo-card li')).toBeNull();
  });

  it('lets each photo switch between food and label, removes photos and caps them at three', async () => {
    const { fixture, el, store } = await composeWith('front.jpg');
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Add a photo from the library"]',
    )!.click();
    expect(library.multiple).toBe(true);
    choose(library, ['back.jpg', 'side.jpg', 'extra.jpg']);
    await fixture.whenStable();
    expect(chips(el)).toEqual(['Food', 'Label', 'Label']);
    expect(el.querySelector('button[aria-label="Add a photo with the camera"]')).toBeNull();
    expect(TestBed.inject(ToastService).toasts()[0]).toMatchObject({
      kind: 'info',
      message: 'A meal takes up to 3 photos, so 1 photo was left out.',
    });

    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Photo 1: Food. Mark as label"]',
    )!.click();
    await fixture.whenStable();
    expect(chips(el)).toEqual(['Label', 'Label', 'Label']);
    expect(el.querySelector('h1')?.textContent).toContain('Nutrition label');

    el.querySelector<HTMLButtonElement>('button[aria-label="Remove photo 2"]')!.click();
    await fixture.whenStable();
    expect(store.photos().map((photo) => photo.file.name)).toEqual(['front.jpg', 'side.jpg']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:back.jpg');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove photo 2');

    el.querySelector<HTMLButtonElement>('button[aria-label="Remove photo 2"]')!.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(el.querySelector('app-compose-panel h1'));
    expect(chips(el)).toEqual([]);
    expect(el.querySelector('img[alt="Selected photo"]')?.getAttribute('src')).toBe(
      'blob:front.jpg',
    );
    expect(el.querySelector('app-segmented-control')).not.toBeNull();
    expect(el.textContent).toContain('Add another photo');
  });

  it('asks before a new capture replaces several photos', async () => {
    const { fixture, store } = await composeWith('a.jpg');
    store.addPhotos([new File(['b'], 'b.jpg', { type: 'image/jpeg' })], 'camera');
    await fixture.whenStable();
    confirm.confirm.mockResolvedValueOnce(false);
    TestBed.inject(CaptureService).requestCamera();
    choose(camera, ['c.jpg']);
    await fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Discard this meal?',
        message: 'Your photos and description will be lost.',
      }),
    );
    expect(store.photos()).toHaveLength(2);
  });

  it('adds a label photo from the review and re-runs the estimate with it', async () => {
    const { fixture, el } = await composeWith('labneh.jpg');
    api.analyze.mockResolvedValueOnce({
      ...PHOTO_ANALYSIS,
      photos: PHOTO_ANALYSIS.photos.slice(0, 1),
    });
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('app-photo-strip')).toBeNull();

    el.querySelector<HTMLButtonElement>('button[aria-label="Take a label photo"]')!.click();
    expect(camera.click).toHaveBeenCalled();
    expect(camera.multiple).toBe(false);
    api.analyze.mockResolvedValueOnce({ ...PHOTO_ANALYSIS, analysisId: 'analysis-label' });
    choose(camera, ['pack.jpg']);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(confirm.confirm).not.toHaveBeenCalled();
    const [fields, images] = api.analyze.mock.calls[1]!;
    expect(fields).toMatchObject({ previousAnalysisId: 'analysis-photo', mode: 'food_photo' });
    expect(images).toEqual([{ blob: expect.any(File), role: 'label' }]);
    expect((images[0].blob as File).name).toBe('pack.jpg');
    expect(el.querySelector('h1')?.textContent).toContain('Review meal');
    expect(el.querySelectorAll('app-photo-strip li')).toHaveLength(2);
  });

  it('confirms before a label photo replaces edited items', async () => {
    const { fixture, el } = await composeWith('labneh.jpg');
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="½ of the estimate"]')!.click();
    await fixture.whenStable();

    confirm.confirm.mockResolvedValueOnce(false);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Choose a label photo from the library"]',
    )!.click();
    expect(library.multiple).toBe(false);
    choose(library, ['pack.jpg']);
    await fixture.whenStable();
    await fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Replace your edits?' }),
    );
    expect(api.analyze).toHaveBeenCalledTimes(1);
    expect(el.querySelector('button[data-item-row]')?.textContent).toContain('50 g');
  });

  it('hints at a label photo when the estimate is unsure', async () => {
    api.analyze.mockResolvedValueOnce({
      ...PHOTO_ANALYSIS,
      photos: PHOTO_ANALYSIS.photos.slice(0, 1),
      result: {
        ...PHOTO_ANALYSIS.result,
        items: [{ ...PHOTO_ANALYSIS.result.items[0]!, confidence: 'low' }],
      },
    });
    const { fixture, el } = await composeWith('mystery.jpg');
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('app-label-photo-card')?.textContent).toContain(
      'Some items are a guess',
    );
  });

  it('marks a photo that cannot be read and lets the user drop it', async () => {
    const compress = vi.mocked(TestBed.inject(IMAGE_COMPRESSOR));
    compress.mockImplementation(async (blob: Blob) => {
      if ((blob as File).name === 'raw.heic') {
        throw new ImageDecodeError(blob, new Error('heic'));
      }
      return { blob, width: 1, height: 1 } as unknown as CompressedImage;
    });
    const { fixture, el, store } = await composeWith('plate.jpg');
    store.addPhotos([new File(['x'], 'raw.heic', { type: 'image/heic' })], 'library');
    await fixture.whenStable();
    await fixture.whenStable();
    const tiles = el.querySelectorAll('app-compose-panel li');
    expect(tiles[1]?.textContent).toContain("Can't read");
    expect(tiles[0]?.textContent).not.toContain("Can't read");
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("Can't read this photo");
    expect(buttonWith(el, 'New photo')).toBeUndefined();

    el.querySelector<HTMLButtonElement>('button[aria-label="Remove photo 2"]')!.click();
    await fixture.whenStable();
    expect(el.textContent).not.toContain("Can't read");
    expect(buttonWith(el, 'Analyze').disabled).toBe(false);
  });

  it('opens a tapped analysis photo in the viewer', async () => {
    const { fixture, el } = await composeWith('labneh.jpg');
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="View photo 2 of 2, label"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-photo-viewer img')?.getAttribute('src')).toBe('/api/photos/p2');
    expect(el.querySelector('app-photo-viewer img')?.getAttribute('alt')).toBe(
      'Label photo of Labneh plate',
    );

    el.querySelector<HTMLButtonElement>(
      'app-photo-viewer button[aria-label="Close photo"]',
    )!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="View photo"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-photo-viewer img')?.getAttribute('src')).toBe('/api/photos/p1');
    expect(el.querySelector('app-photo-viewer dialog')?.hasAttribute('open')).toBe(true);
  });

  it('shows the phone preview when the meal has a single local photo', async () => {
    api.analyze.mockResolvedValueOnce({ ...PHOTO_ANALYSIS, photos: [], photo: null });
    const { fixture, el } = await composeWith('labneh.jpg');
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="View photo"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-photo-viewer img')?.getAttribute('src')).toBe('blob:labneh.jpg');
    expect(buttonWith(el, 'Set as cover')).toBeUndefined();
  });

  it('logs the first food photo as the cover unless another one is picked', async () => {
    api.createEntry.mockResolvedValue(ENTRY);
    const { fixture, el } = await composeWith('labneh.jpg');
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();

    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId: 'analysis-photo', photoId: 'p1', coverPhotoId: 'p1' }),
    );
  });

  it('lets the label photo become the cover before saving', async () => {
    api.createEntry.mockResolvedValue(ENTRY);
    const { fixture, el } = await composeWith('labneh.jpg');
    buttonWith(el, 'Analyze').click();
    await fixture.whenStable();
    await fixture.whenStable();
    const thumb = (): string | null | undefined =>
      el.querySelector('app-entry-form button[aria-label="View photo"] img')?.getAttribute('src');
    expect(thumb()).toBe('blob:labneh.jpg');

    el.querySelector<HTMLButtonElement>('button[aria-label="View photo 2 of 2, label"]')!.click();
    await fixture.whenStable();
    const viewer = el.querySelector<HTMLElement>('app-photo-viewer')!;
    expect(viewer.textContent).toContain('2 / 2 · Label');
    buttonWith(viewer, 'Set as cover').click();
    await fixture.whenStable();

    expect(viewer.textContent).toContain('2 / 2 · Label · Cover');
    expect(buttonWith(viewer, 'Cover photo').getAttribute('aria-disabled')).toBe('true');
    expect(viewer.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(
      Array.from(el.querySelectorAll('app-photo-strip li button')).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['View photo 1 of 2, food', 'View photo 2 of 2, label, cover']);
    expect(thumb()).toBe('/api/photos/p2/thumb');

    viewer.querySelector<HTMLButtonElement>('button[aria-label="Close photo"]')!.click();
    await fixture.whenStable();
    buttonWith(el, 'Save to log').click();
    await fixture.whenStable();
    expect(api.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({ analysisId: 'analysis-photo', photoId: 'p2', coverPhotoId: 'p2' }),
    );
  });
});
