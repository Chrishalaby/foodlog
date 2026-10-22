import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  DEFAULT_BASE_TARGETS,
  type CreateEntryRequest,
  type DaySummary,
  type EntryDto,
  type MealIdea,
  type MealIdeaPart,
  type MealIdeasRequest,
  type MealIdeasResponse,
  type QuickLogRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { MealIdeasSheet } from './meal-ideas-sheet';
import { installDialogShim, makeEntry, nutrients } from './today-fixtures';

const DATE = '2026-10-11';

function day(calories = 1300, protein = 90): DaySummary {
  return {
    date: DATE,
    trainingDay: false,
    targets: { ...DEFAULT_BASE_TARGETS, calories: 2200, protein: 170 },
    totals: nutrients({ calories, protein }),
    entryCount: 2,
    micros: {},
    microsCoverage: { items: 0, withMicros: 0 },
    fluidsMl: 0,
    fluidTargetMl: 2500,
  };
}

function part(overrides: Partial<MealIdeaPart> = {}): MealIdeaPart {
  return {
    name: 'Chicken wrap',
    foodKey: 'meal:1',
    servings: 1,
    grams: 320,
    portion: { count: 1, unit: 'wrap', unitPlural: 'wraps' },
    nutrients: nutrients({ calories: 640, protein: 40 }),
    items: [{ name: 'Chicken wrap', grams: 320, nutrients: nutrients({ calories: 640 }) }],
    ...overrides,
  };
}

const USUAL: MealIdea = {
  title: 'Your usual wrap',
  mealType: 'dinner',
  reason: 'Close to your usual dinner',
  parts: [part()],
  totals: nutrients({ calories: 640, protein: 40, carbs: 60, fat: 24 }),
  grams: 320,
};

const BIG: MealIdea = {
  title: 'Wrap with eggs',
  mealType: 'dinner',
  reason: 'Plenty of protein',
  parts: [
    part(),
    part({
      name: 'Boiled eggs',
      foodKey: null,
      servings: null,
      grams: 200,
      portion: { count: 4, unit: 'egg', unitPlural: 'eggs' },
      items: [{ name: 'Boiled eggs', grams: 200, nutrients: nutrients({ calories: 310 }) }],
    }),
  ],
  totals: nutrients({ calories: 950, protein: 66, carbs: 62, fat: 46 }),
  grams: 520,
};

function response(ideas: MealIdea[] = [USUAL, BIG]): MealIdeasResponse {
  return {
    summary: 'Protein is the gap to close.',
    ideas,
    usage: {
      model: 'mock',
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      costUsd: 0,
      durationMs: 1,
      attempts: 1,
    },
  };
}

describe('MealIdeasSheet', () => {
  let restoreDialog: () => void;
  let api: {
    mealIdeas: ReturnType<typeof vi.fn<(body: MealIdeasRequest) => Promise<MealIdeasResponse>>>;
    quickLog: ReturnType<typeof vi.fn<(body: QuickLogRequest) => Promise<EntryDto>>>;
    createEntry: ReturnType<typeof vi.fn<(body: CreateEntryRequest) => Promise<EntryDto>>>;
  };

  beforeEach(() => {
    restoreDialog = installDialogShim();
    api = {
      mealIdeas: vi.fn(async () => response()),
      quickLog: vi.fn(async () =>
        makeEntry({ id: 'quick', name: 'Chicken wrap', localDate: DATE }),
      ),
      createEntry: vi.fn(async () => makeEntry({ id: 'created', localDate: DATE })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { isAdmin: () => false } },
      ],
    });
  });

  afterEach(() => {
    restoreDialog();
  });

  async function render(summary: DaySummary = day()): Promise<{
    fixture: ComponentFixture<MealIdeasSheet>;
    el: HTMLElement;
    logged: EntryDto[];
  }> {
    const fixture = TestBed.createComponent(MealIdeasSheet);
    const logged: EntryDto[] = [];
    fixture.componentInstance.logged.subscribe((entry) => logged.push(entry));
    fixture.componentRef.setInput('date', DATE);
    fixture.componentRef.setInput('day', summary);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, logged };
  }

  function text(node: Element | null | undefined): string {
    return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function cards(el: HTMLElement): HTMLElement[] {
    return Array.from(el.querySelectorAll<HTMLElement>('ul[aria-label="Meal ideas"] > li'));
  }

  function failureCard(el: HTMLElement): HTMLElement | null {
    return el.querySelector<HTMLElement>('.card[role="alert"]');
  }

  function button(scope: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll('button')).find((b) => text(b) === label);
    if (!found) {
      throw new Error(`No button "${label}"`);
    }
    return found;
  }

  it('asks as soon as it opens and shows what is left, the summary and each idea', async () => {
    const { el } = await render();

    expect(api.mealIdeas).toHaveBeenCalledTimes(1);
    expect(api.mealIdeas.mock.calls[0]?.[0].localDate).toBe(DATE);
    expect(text(el.querySelector('h2'))).toBe('AI meal ideas');
    expect(text(el)).toContain('900 kcal left · 80 g protein to go');
    expect(text(el)).toContain('Protein is the gap to close.');
    const [usual] = cards(el);
    expect(text(usual?.querySelector('h3'))).toBe('Your usual wrap');
    expect(text(usual)).toContain('Dinner');
    expect(text(usual)).toContain('640kcal');
    expect(text(usual)).toContain('Protein 40 g · Carbs 60 g · Fat 24 g');
    expect(text(usual)).toContain('Chicken wrap 1 wrap · 320 g');
    expect(text(usual)).toContain('Close to your usual dinner');
    expect(text(usual)).toContain('Leaves 260 kcal · 40 g protein to go');
    expect(text(usual)).not.toContain('New');
  });

  it('marks foods that are not the user’s own and warns when an idea goes over', async () => {
    const { el } = await render();
    const [, big] = cards(el);

    const eggs = Array.from(big?.querySelectorAll('li') ?? []).find((row) =>
      text(row).startsWith('Boiled eggs'),
    );
    expect(text(eggs?.querySelector('.chip'))).toBe('New');
    expect(text(eggs)).toContain('4 eggs · 200 g');
    const over = Array.from(big?.querySelectorAll('p') ?? []).find((p) =>
      text(p).includes('over today'),
    );
    expect(text(over)).toBe("50 kcal over today's target");
    expect(over?.classList.contains('text-warn')).toBe(true);
  });

  it('logs an idea, closes and hands the entry to the page', async () => {
    const { fixture, el, logged } = await render();

    button(cards(el)[0]!, 'Log this').click();
    await fixture.whenStable();

    expect(api.quickLog).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'meal:1', servings: 1, localDate: DATE, mealType: 'dinner' }),
    );
    expect(logged.map((entry) => entry.id)).toEqual(['quick']);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('stays open and says so when logging fails', async () => {
    api.createEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const error = vi.spyOn(TestBed.inject(ToastService), 'error');
    const { fixture, el, logged } = await render();

    button(cards(el)[1]!, 'Log this').click();
    await fixture.whenStable();

    expect(error).toHaveBeenCalledTimes(1);
    expect(logged).toEqual([]);
    expect(fixture.componentInstance.open()).toBe(true);
    expect(button(cards(el)[1]!, 'Log this').disabled).toBe(false);
  });

  it('asks again with what was typed, leaving out the ideas already shown', async () => {
    const { fixture, el } = await render();
    api.mealIdeas.mockResolvedValueOnce(response([{ ...USUAL, title: 'Grilled fish plate' }]));
    const note = el.querySelector<HTMLTextAreaElement>('#meal-ideas-note')!;
    note.value = 'eating out tonight';
    note.dispatchEvent(new Event('input'));

    button(el, 'Ask again').click();
    await fixture.whenStable();

    expect(api.mealIdeas).toHaveBeenLastCalledWith(
      expect.objectContaining({
        note: 'eating out tonight',
        exclude: ['Your usual wrap', 'Wrap with eggs'],
      }),
    );
    expect(cards(el).map((card) => text(card.querySelector('h3')))).toEqual(['Grilled fish plate']);
    expect(note.value).toBe('eating out tonight');
  });

  it('shows a busy state while the AI is thinking', async () => {
    api.mealIdeas.mockReturnValueOnce(new Promise(() => undefined));
    const { el } = await render();

    expect(text(el.querySelector('[role="status"]'))).toContain('Looking at what you usually eat');
    expect(cards(el)).toEqual([]);
    expect(button(el, 'Ask again').disabled).toBe(true);
  });

  it('offers a retry for failures that can pass', async () => {
    api.mealIdeas.mockRejectedValueOnce(new HttpErrorResponse({ status: 502 }));
    const { fixture, el } = await render();
    const alert = failureCard(el)!;
    expect(text(alert)).toContain("The AI couldn't finish");

    button(alert, 'Try again').click();
    await fixture.whenStable();

    expect(failureCard(el)).toBeNull();
    expect(cards(el)).toHaveLength(2);
  });

  it('offers no retry when the AI budget is used up', async () => {
    api.mealIdeas.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 429,
        error: { message: 'Your monthly AI budget is used up' },
      }),
    );
    const { el } = await render();
    const alert = failureCard(el)!;

    expect(text(alert)).toContain("You've used this month's AI budget");
    expect(Array.from(alert.querySelectorAll('button'))).toEqual([]);
  });

  it('does not ask before the day is known', async () => {
    const fixture = TestBed.createComponent(MealIdeasSheet);
    fixture.componentRef.setInput('date', DATE);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();

    expect(api.mealIdeas).not.toHaveBeenCalled();
  });
});
