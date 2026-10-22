import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  API_LIMITS,
  type CreateEntryRequest,
  type EntryDto,
  type MealIdea,
  type MealIdeaPart,
  type MealIdeasRequest,
  type MealIdeasResponse,
  type QuickLogRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { SessionScope } from '../../core/session-scope';
import { IDEAS_FRESH_MS } from './meal-ideas-model';
import { MealIdeasStore, type IdeasContext } from './meal-ideas.store';
import { makeEntry, nutrients } from './today-fixtures';

const DATE = '2026-10-11';
const NOW = new Date(2026, 9, 11, 19, 30);
const CONTEXT: IdeasContext = { date: DATE, basis: `${DATE}|1|450` };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function part(overrides: Partial<MealIdeaPart> = {}): MealIdeaPart {
  return {
    name: 'Chicken wrap',
    foodKey: 'meal:1',
    servings: 1,
    grams: 320,
    portion: null,
    nutrients: nutrients({ calories: 640, protein: 40 }),
    items: [{ name: 'Chicken wrap', grams: 320, nutrients: nutrients({ calories: 640 }) }],
    ...overrides,
  };
}

function idea(title: string, parts: MealIdeaPart[] = [part()]): MealIdea {
  return {
    title,
    mealType: 'dinner',
    reason: 'Fits',
    parts,
    totals: nutrients({ calories: 640, protein: 40 }),
    grams: 320,
  };
}

function response(...titles: string[]): MealIdeasResponse {
  return {
    summary: 'Protein is the gap to close.',
    ideas: titles.map((title) => idea(title)),
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

describe('MealIdeasStore', () => {
  let api: {
    mealIdeas: ReturnType<typeof vi.fn<(body: MealIdeasRequest) => Promise<MealIdeasResponse>>>;
    quickLog: ReturnType<typeof vi.fn<(body: QuickLogRequest) => Promise<EntryDto>>>;
    createEntry: ReturnType<typeof vi.fn<(body: CreateEntryRequest) => Promise<EntryDto>>>;
  };
  let store: MealIdeasStore;

  beforeEach(() => {
    api = {
      mealIdeas: vi.fn(async () => response('Chicken wrap', 'Yogurt bowl')),
      quickLog: vi.fn(async () => makeEntry({ id: 'quick', localDate: DATE })),
      createEntry: vi.fn(async () => makeEntry({ id: 'created', localDate: DATE })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { isAdmin: () => false } },
      ],
    });
    setDayStartHour(0, null);
    store = TestBed.inject(MealIdeasStore);
  });

  afterEach(() => {
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
  });

  it('asks for the day with the device clock when first opened', async () => {
    expect(store.status()).toBe('idle');

    const opening = store.open(CONTEXT, NOW);
    expect(store.status()).toBe('loading');
    await opening;

    expect(api.mealIdeas).toHaveBeenCalledWith({
      localDate: DATE,
      localTime: '2026-10-11T19:30',
    });
    expect(store.status()).toBe('ready');
    expect(store.summary()).toBe('Protein is the gap to close.');
    expect(store.ideas().map((i) => i.title)).toEqual(['Chicken wrap', 'Yogurt bowl']);
  });

  it('keeps the ideas when reopened soon on an unchanged day, without asking again', async () => {
    await store.open(CONTEXT, NOW);
    await store.open(CONTEXT, new Date(NOW.getTime() + IDEAS_FRESH_MS - 1));

    expect(api.mealIdeas).toHaveBeenCalledTimes(1);
  });

  it('asks again once the day has changed or the ideas are old', async () => {
    await store.open(CONTEXT, NOW);
    await store.open({ date: DATE, basis: `${DATE}|2|1090` }, NOW);
    expect(api.mealIdeas).toHaveBeenCalledTimes(2);

    await store.open(
      { date: DATE, basis: `${DATE}|2|1090` },
      new Date(NOW.getTime() + IDEAS_FRESH_MS),
    );
    expect(api.mealIdeas).toHaveBeenCalledTimes(3);
  });

  it('does not ask twice while the first answer is on its way', async () => {
    const pending = deferred<MealIdeasResponse>();
    api.mealIdeas.mockReturnValueOnce(pending.promise);

    const first = store.open(CONTEXT, NOW);
    await store.open(CONTEXT, NOW);
    pending.resolve(response('Chicken wrap'));
    await first;

    expect(api.mealIdeas).toHaveBeenCalledTimes(1);
    expect(store.status()).toBe('ready');
  });

  it('asks for other ideas with the note, leaving out everything already shown', async () => {
    await store.open(CONTEXT, NOW);
    api.mealIdeas.mockResolvedValueOnce(response('Tuna salad'));
    store.setNote('  eating out tonight ');

    await store.ask(CONTEXT, { different: true }, NOW);

    expect(api.mealIdeas).toHaveBeenLastCalledWith({
      localDate: DATE,
      localTime: '2026-10-11T19:30',
      note: 'eating out tonight',
      exclude: ['Chicken wrap', 'Yogurt bowl'],
    });
    expect(store.ideas().map((i) => i.title)).toEqual(['Tuna salad']);

    await store.ask(CONTEXT, { different: true }, NOW);
    expect(api.mealIdeas.mock.lastCall?.[0].exclude).toEqual([
      'Chicken wrap',
      'Yogurt bowl',
      'Tuna salad',
    ]);
  });

  it('starts over with nothing excluded on a fresh open, and caps what it excludes', async () => {
    for (let round = 0; round < API_LIMITS.mealIdeaExcludeMax; round += 1) {
      api.mealIdeas.mockResolvedValueOnce(response(`A${round}`, `B${round}`));
      await store.ask(CONTEXT, { different: true }, NOW);
    }
    await store.ask(CONTEXT, { different: true }, NOW);
    expect(api.mealIdeas.mock.lastCall?.[0].exclude).toHaveLength(API_LIMITS.mealIdeaExcludeMax);
    expect(api.mealIdeas.mock.lastCall?.[0].exclude?.at(-1)).toBe(
      `B${API_LIMITS.mealIdeaExcludeMax - 1}`,
    );

    await store.open({ date: DATE, basis: 'another day' }, NOW);
    expect(api.mealIdeas.mock.lastCall?.[0].exclude).toBeUndefined();
  });

  it('cuts the note at the limit', () => {
    store.setNote('x'.repeat(API_LIMITS.mealIdeaNoteMax + 20));
    expect(store.note()).toHaveLength(API_LIMITS.mealIdeaNoteMax);
  });

  it('shows why asking failed and can ask again', async () => {
    api.mealIdeas.mockRejectedValueOnce(
      new HttpErrorResponse({
        status: 429,
        error: { message: 'Your monthly AI budget is used up' },
      }),
    );
    await store.open(CONTEXT, NOW);
    expect(store.status()).toBe('error');
    expect(store.failure()).toMatchObject({ kind: 'budget', retryable: false });

    await store.open(CONTEXT, NOW);
    expect(store.status()).toBe('ready');
    expect(store.failure()).toBeNull();
  });

  it('ignores an answer that arrives after a newer question', async () => {
    const slow = deferred<MealIdeasResponse>();
    api.mealIdeas.mockReturnValueOnce(slow.promise);
    const first = store.ask(CONTEXT, {}, NOW);
    api.mealIdeas.mockResolvedValueOnce(response('Newer idea'));
    await store.ask(CONTEXT, { note: 'something sweet' }, NOW);

    slow.resolve(response('Stale idea'));
    await first;

    expect(store.ideas().map((i) => i.title)).toEqual(['Newer idea']);
    expect(store.note()).toBe('something sweet');
  });

  it('logs a single usual food through quick log, for now, as the suggested meal', async () => {
    const notify = vi.spyOn(TestBed.inject(DataEventsService), 'notify');
    const pending = deferred<EntryDto>();
    api.quickLog.mockReturnValueOnce(pending.promise);

    const logging = store.log(idea('Chicken wrap', [part({ servings: 1.5 })]), DATE, NOW);
    expect(store.logging()).toBe('Chicken wrap');
    pending.resolve(makeEntry({ id: 'quick', localDate: DATE }));
    const entry = await logging;

    expect(entry.id).toBe('quick');
    expect(api.quickLog).toHaveBeenCalledWith({
      key: 'meal:1',
      servings: 1.5,
      timestamp: NOW.toISOString(),
      localDate: DATE,
      mealType: 'dinner',
    });
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('entries', 'favorites');
    expect(store.logging()).toBeNull();
  });

  it('logs a mix as one entry named after the idea', async () => {
    const mix = idea('Wrap with eggs', [
      part(),
      part({
        name: 'Boiled eggs',
        foodKey: null,
        servings: null,
        items: [{ name: 'Boiled eggs', grams: 100, nutrients: nutrients({ calories: 155 }) }],
      }),
    ]);

    await store.log(mix, DATE, NOW);

    expect(api.quickLog).not.toHaveBeenCalled();
    expect(api.createEntry).toHaveBeenCalledWith({
      name: 'Wrap with eggs',
      source: 'text',
      items: [...mix.parts[0]!.items, ...mix.parts[1]!.items],
      timestamp: NOW.toISOString(),
      localDate: DATE,
      mealType: 'dinner',
    });
  });

  it('still logs the food from its values when it has left the library', async () => {
    api.quickLog.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    const usual = idea('Chicken wrap');

    const entry = await store.log(usual, DATE, NOW);

    expect(entry.id).toBe('created');
    expect(api.createEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Chicken wrap',
        source: 'copy',
        items: usual.parts[0]!.items,
      }),
    );
  });

  it('reports a failed log and asks afresh the next time the sheet opens after a log', async () => {
    await store.open(CONTEXT, NOW);
    api.quickLog.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    await expect(store.log(idea('Chicken wrap'), DATE, NOW)).rejects.toBeInstanceOf(
      HttpErrorResponse,
    );
    expect(store.logging()).toBeNull();
    await store.open(CONTEXT, NOW);
    expect(api.mealIdeas).toHaveBeenCalledTimes(1);

    await store.log(idea('Chicken wrap'), DATE, NOW);
    await store.open(CONTEXT, NOW);
    expect(api.mealIdeas).toHaveBeenCalledTimes(2);
  });

  it('forgets everything when the session ends', async () => {
    store.setNote('eating out');
    await store.open(CONTEXT, NOW);

    TestBed.inject(SessionScope).reset();

    expect(store.status()).toBe('idle');
    expect(store.ideas()).toEqual([]);
    expect(store.summary()).toBe('');
    expect(store.note()).toBe('');
  });
});
