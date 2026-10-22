import { toLocalDate, type EntryItemDto } from '@food/shared';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { TEST_TARGETS, makeDashboard, makeEntry, makeFood, nutrients } from './today-fixtures';
import {
  adjacentDate,
  daySubtitle,
  emptyDayTitle,
  groupEntriesByMeal,
  logMomentFor,
  loggedDayNote,
  offersFoodActions,
  orderQuickAdd,
  quickLogMessage,
  resolveViewDate,
  withEntry,
  withFoodAt,
  withFoodName,
  withTrainingDay,
  withoutEntry,
  withoutFood,
} from './today-view';

const TODAY = '2026-09-28';

describe('resolveViewDate', () => {
  it('uses a valid past date from the query string', () => {
    expect(resolveViewDate('2026-09-20', TODAY)).toBe('2026-09-20');
  });

  it('falls back to today for missing, malformed, impossible or future dates', () => {
    expect(resolveViewDate(undefined, TODAY)).toBe(TODAY);
    expect(resolveViewDate('yesterday', TODAY)).toBe(TODAY);
    expect(resolveViewDate('2026-02-30', TODAY)).toBe(TODAY);
    expect(resolveViewDate('2026-09-29', TODAY)).toBe(TODAY);
  });
});

describe('adjacentDate', () => {
  it('steps across month boundaries and blocks the future', () => {
    expect(adjacentDate('2026-10-01', -1, '2026-10-05')).toBe('2026-09-30');
    expect(adjacentDate('2026-09-27', 1, TODAY)).toBe(TODAY);
    expect(adjacentDate(TODAY, 1, TODAY)).toBeNull();
  });
});

describe('day labels', () => {
  it('describes today, yesterday and older days', () => {
    expect(daySubtitle(TODAY, TODAY)).toBe('Mon 28 Sep');
    expect(daySubtitle('2026-09-27', TODAY)).toBe('Sun 27 Sep');
    expect(daySubtitle('2026-09-21', TODAY)).toBe('7 days ago');
    expect(emptyDayTitle(TODAY, TODAY)).toBe('Nothing logged yet today');
    expect(emptyDayTitle('2026-09-27', TODAY)).toBe('Nothing logged yesterday');
    expect(emptyDayTitle('2026-09-21', TODAY)).toBe('Nothing logged on Mon 21 Sep');
  });
});

describe('loggedDayNote', () => {
  it('names the day an entry went to unless it is the day being viewed today', () => {
    expect(loggedDayNote(TODAY, TODAY, TODAY)).toBe('');
    expect(loggedDayNote(TODAY, '2026-09-20', TODAY)).toBe(' for today');
    expect(loggedDayNote('2026-09-27', '2026-09-27', TODAY)).toBe(' for yesterday');
    expect(loggedDayNote('2026-09-20', '2026-09-20', TODAY)).toBe(' for Sun 20 Sep');
  });
});

describe('groupEntriesByMeal', () => {
  it('orders entries by time and merges consecutive entries of the same meal type', () => {
    const groups = groupEntriesByMeal([
      makeEntry({ id: 'd', mealType: 'dinner', timestamp: '2026-09-28T18:30:00.000Z' }),
      makeEntry({ id: 'b2', mealType: 'breakfast', timestamp: '2026-09-28T08:15:00.000Z' }),
      makeEntry({ id: 'b1', mealType: 'breakfast', timestamp: '2026-09-28T07:45:00.000Z' }),
      makeEntry({
        id: 's',
        mealType: 'snack',
        timestamp: '2026-09-28T10:00:00.000Z',
        totals: nutrients({ calories: 120.4 }),
      }),
      makeEntry({ id: 'b3', mealType: 'breakfast', timestamp: '2026-09-28T11:00:00.000Z' }),
    ]);
    expect(groups.map((g) => [g.mealType, g.entries.map((e) => e.id)])).toEqual([
      ['breakfast', ['b1', 'b2']],
      ['snack', ['s']],
      ['breakfast', ['b3']],
      ['dinner', ['d']],
    ]);
    expect(groups[0].calories).toBe(800);
    expect(groups[1].calories).toBe(120);
    expect(groups[0].id).toBe('b1');
  });

  it('returns no groups for an empty day', () => {
    expect(groupEntriesByMeal([])).toEqual([]);
  });
});

describe('orderQuickAdd', () => {
  const star = (key: string) => makeFood({ key, kind: 'favorite', starred: true });

  it('puts starred results first and keeps the server order within each group', () => {
    const ordered = orderQuickAdd([
      makeFood({ key: 'm1' }),
      star('f1'),
      makeFood({ key: 'm2' }),
      star('f2'),
    ]);
    expect(ordered.map((r) => r.key)).toEqual(['f1', 'f2', 'm1', 'm2']);
  });

  it('keeps chips where they were on a refresh and appends new ones', () => {
    const previous = [star('f1'), star('f2'), makeFood({ key: 'm1' }), makeFood({ key: 'm2' })];
    const next = [
      star('f2'),
      star('f1'),
      star('f3'),
      makeFood({ key: 'm3' }),
      makeFood({ key: 'm1' }),
    ];
    expect(orderQuickAdd(next, previous).map((r) => r.key)).toEqual(['f1', 'f2', 'f3', 'm1', 'm3']);
  });

  it('caps the number of chips', () => {
    const many = Array.from({ length: 14 }, (_, i) => makeFood({ key: `k${i}` }));
    expect(orderQuickAdd(many)).toHaveLength(10);
    expect(orderQuickAdd(many, [], 3)).toHaveLength(3);
  });
});

describe('quick log helpers', () => {
  it('always names the day an item was logged to', () => {
    expect(quickLogMessage('Yogurt', TODAY, TODAY)).toBe('Logged “Yogurt” for today');
    expect(quickLogMessage('Yogurt', '2026-09-27', TODAY)).toBe('Logged “Yogurt” for yesterday');
    expect(quickLogMessage('Yogurt', '2026-09-21', TODAY)).toBe('Logged “Yogurt” for Mon 21 Sep');
  });
});

describe('library chip actions', () => {
  const meal = makeFood({ key: 'meal:1', kind: 'meal' });
  const food = makeFood({ key: 'food:1', kind: 'food' });
  const favorite = makeFood({ key: 'favorite:1', kind: 'favorite', starred: true });
  const product = makeFood({ key: 'product:1', kind: 'product', productId: 'p1' });

  it('offers the action sheet for meals, single foods and saved products, never for starred items', () => {
    expect(offersFoodActions(meal)).toBe(true);
    expect(offersFoodActions(food)).toBe(true);
    expect(offersFoodActions(product)).toBe(true);
    expect(offersFoodActions(favorite)).toBe(false);
    expect(offersFoodActions({ ...product, productId: null })).toBe(false);
  });

  it('removes a chip, puts it back where it was and renames it without touching others', () => {
    const chips = [makeFood({ key: 'a' }), makeFood({ key: 'b' }), makeFood({ key: 'c' })];
    const without = withoutFood(chips, 'b');
    expect(without.map((chip) => chip.key)).toEqual(['a', 'c']);
    expect(withoutFood(chips, 'missing')).toBe(chips);
    expect(withFoodAt(without, chips[1], 1).map((chip) => chip.key)).toEqual(['a', 'b', 'c']);
    expect(withFoodAt(without, chips[1], 99).map((chip) => chip.key)).toEqual(['a', 'c', 'b']);
    expect(withFoodAt(chips, chips[1], 0)).toBe(chips);
    expect(withFoodAt(without, chips[1], 0, 2).map((chip) => chip.key)).toEqual(['b', 'a']);

    const renamed = withFoodName(chips, 'b', 'Banana');
    expect(renamed.map((chip) => chip.name)).toEqual([chips[0].name, 'Banana', chips[2].name]);
    expect(renamed[0]).toBe(chips[0]);
  });
});

describe('dashboard updates', () => {
  const breakfast = makeEntry({
    id: 'a',
    timestamp: '2026-09-28T08:00:00.000Z',
    totals: nutrients({ calories: 400.4, protein: 20.25, sodium: 300 }),
  });
  const lunch = makeEntry({
    id: 'b',
    mealType: 'lunch',
    timestamp: '2026-09-28T12:00:00.000Z',
    totals: nutrients({ calories: 600, protein: 35, sodium: 900 }),
  });

  it('adds an entry in time order and increases totals', () => {
    const snack = makeEntry({
      id: 'c',
      mealType: 'snack',
      timestamp: '2026-09-28T10:00:00.000Z',
      totals: nutrients({ calories: 150, protein: 5 }),
    });
    const next = withEntry(makeDashboard(TODAY, [breakfast, lunch]), snack);
    expect(next.entries.map((e) => e.id)).toEqual(['a', 'c', 'b']);
    expect(next.day.entryCount).toBe(3);
    expect(next.day.totals.calories).toBe(1150);
    expect(next.day.totals.protein).toBe(60.3);
  });

  it('ignores an entry that is already present', () => {
    const dashboard = makeDashboard(TODAY, [breakfast]);
    expect(withEntry(dashboard, breakfast)).toBe(dashboard);
  });

  it('removes an entry and subtracts its totals without going negative', () => {
    const dashboard = makeDashboard(TODAY, [breakfast, lunch]);
    const next = withoutEntry(dashboard, 'b');
    expect(next.entries.map((e) => e.id)).toEqual(['a']);
    expect(next.day.entryCount).toBe(1);
    expect(next.day.totals.calories).toBe(400);
    expect(next.day.totals.sodium).toBe(300);
    const empty = withoutEntry(next, 'a');
    expect(empty.day.totals).toEqual(nutrients());
    expect(withoutEntry(empty, 'missing')).toBe(empty);
  });

  function microsItem(
    id: string,
    micros: EntryItemDto['micros'],
    fluidMl: number | null = null,
  ): EntryItemDto {
    return {
      id,
      position: 0,
      name: id,
      grams: 100,
      nutrients: nutrients({ calories: 50 }),
      confidence: null,
      count: null,
      unit: null,
      unitPlural: null,
      productId: null,
      micros,
      fluidMl,
    };
  }

  it('adds a logged meal’s vitamins and minerals to the day and counts its foods', () => {
    const dashboard = makeDashboard(TODAY, [breakfast]);
    dashboard.day.micros = { vitaminD: 125, caffeine: 80 };
    dashboard.day.microsCoverage = { items: 2, withMicros: 1 };
    const dinner = makeEntry({
      id: 'd',
      timestamp: '2026-09-28T19:00:00.000Z',
      items: [
        microsItem('Diet Pepsi', { caffeine: 36 }, 330),
        microsItem('Red apple', { vitaminC: 8, potassium: 193 }),
        microsItem('Bun', null),
      ],
    });
    const next = withEntry(dashboard, dinner);
    expect(next.day.micros).toEqual({ vitaminC: 8, vitaminD: 125, potassium: 193, caffeine: 116 });
    expect(next.day.microsCoverage).toEqual({ items: 5, withMicros: 3 });
  });

  it('removes a meal’s vitamins and minerals and turns nutrients no food has back into unknowns', () => {
    const apple = makeEntry({
      id: 'apple',
      timestamp: '2026-09-29T00:56:00.000Z',
      items: [microsItem('Red apple', { vitaminC: 8, potassium: 193 })],
    });
    const softgel = makeEntry({
      id: 'softgel',
      items: [microsItem('Vitamin D3', { vitaminD: 125, vitaminC: 0 })],
    });
    const dashboard = makeDashboard(TODAY, [softgel, apple]);
    dashboard.day.micros = { vitaminC: 8, vitaminD: 125, potassium: 193, caffeine: 80 };
    dashboard.day.microsCoverage = { items: 2, withMicros: 2 };
    const next = withoutEntry(dashboard, 'apple');
    expect(next.day.micros).toEqual({ vitaminC: 0, vitaminD: 125, caffeine: 80 });
    expect(next.day.microsCoverage).toEqual({ items: 1, withMicros: 1 });
    const empty = withoutEntry(next, 'softgel');
    expect(empty.day.micros).toEqual({ caffeine: 80 });
    expect(empty.day.microsCoverage).toEqual({ items: 0, withMicros: 0 });
  });

  it('copes with a day summary from before vitamins were tracked', () => {
    const dashboard = makeDashboard(TODAY, []);
    const legacy = {
      ...dashboard,
      day: { ...dashboard.day, micros: undefined, microsCoverage: undefined },
    } as unknown as typeof dashboard;
    const next = withEntry(
      legacy,
      makeEntry({ id: 'x', items: [microsItem('Soy milk', { calcium: 300 }, 250)] }),
    );
    expect(next.day.micros).toEqual({ calcium: 300 });
    expect(next.day.microsCoverage).toEqual({ items: 1, withMicros: 1 });
  });

  it('swaps day targets when toggling a training day', () => {
    const dashboard = makeDashboard(TODAY, [breakfast]);
    const training = withTrainingDay(dashboard, true, TEST_TARGETS);
    expect(training.day.trainingDay).toBe(true);
    expect(training.day.targets.calories).toBe(2400);
    const rest = withTrainingDay(training, false, TEST_TARGETS);
    expect(rest.day.targets.calories).toBe(1800);
    const unknown = withTrainingDay(dashboard, true, null);
    expect(unknown.day.trainingDay).toBe(true);
    expect(unknown.day.targets).toEqual(dashboard.day.targets);
  });
});

describe('logMomentFor', () => {
  it('uses the current instant when logging to today', () => {
    const now = new Date(2026, 8, 28, 13, 5);
    const moment = logMomentFor(toLocalDate(now), now);
    expect(moment.timestamp).toBe(now.toISOString());
    expect(moment.localDate).toBe(toLocalDate(now));
  });

  it('keeps the clock time but moves to the viewed day for past days', () => {
    const now = new Date(2026, 8, 28, 19, 40);
    const moment = logMomentFor('2026-09-25', now);
    expect(moment.localDate).toBe('2026-09-25');
    expect(toLocalDate(moment.at)).toBe('2026-09-25');
    expect(moment.at.getHours()).toBe(19);
    expect(moment.at.getMinutes()).toBe(40);
  });
});

describe('logMomentFor around the day start', () => {
  afterEach(() => setDayStartHour(DEFAULT_DAY_START_HOUR, null));

  it('keeps a 00:56 log on the logical today with the real instant', () => {
    setDayStartHour(3, null);
    const now = new Date(2026, 9, 2, 0, 56);
    const moment = logMomentFor('2026-10-01', now);
    expect(moment.localDate).toBe('2026-10-01');
    expect(moment.timestamp).toBe(now.toISOString());
  });

  it('puts the current after-midnight clock time on the real next calendar day for a past day', () => {
    setDayStartHour(3, null);
    const now = new Date(2026, 9, 2, 0, 56);
    const moment = logMomentFor('2026-09-29', now);
    expect(moment.localDate).toBe('2026-09-29');
    expect(toLocalDate(moment.at)).toBe('2026-09-30');
    expect(moment.at.getHours()).toBe(0);
    expect(moment.at.getMinutes()).toBe(56);
  });

  it('treats 00:56 as the new calendar day when the day starts at midnight', () => {
    setDayStartHour(0, null);
    const now = new Date(2026, 9, 2, 0, 56);
    expect(logMomentFor('2026-10-02', now).timestamp).toBe(now.toISOString());
    expect(logMomentFor('2026-10-01', now).at.getDate()).toBe(1);
  });
});
