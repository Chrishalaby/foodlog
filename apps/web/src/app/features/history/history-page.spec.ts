import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import {
  MEAL_TYPES,
  addDays,
  guessMealType,
  zeroNutrients,
  type EntryDto,
  type MealType,
  type EntryListQuery,
  type EntryListResponse,
  type FavoriteDto,
  type FoodRenameRequest,
  type FoodRenameResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EntryCard } from '../../shared/ui/entry-card';
import {
  EXTERNAL_REFRESH_DEBOUNCE_MS,
  HistoryPage,
  REMOVE_ANIMATION_MS,
  SEARCH_DEBOUNCE_MS,
} from './history-page';
import { HistoryStore } from './history-store';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function localInstant(localDate: string, hours: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(year, month - 1, day, hours, 0).toISOString();
}

function entry(
  id: string,
  localDate: string,
  hours: number,
  calories: number,
  protein: number,
): EntryDto {
  const timestamp = localInstant(localDate, hours);
  return {
    portion: null,
    id,
    name: `Meal ${id}`,
    description: null,
    mealType: 'lunch',
    source: 'food_photo',
    timestamp,
    localDate,
    items: [],
    totals: { ...zeroNutrients(), calories, protein },
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

class FakeApi {
  readonly listEntries = vi.fn<(query?: EntryListQuery) => Promise<EntryListResponse>>();
  readonly getEntry = vi.fn<(id: string) => Promise<EntryDto>>();
  readonly deleteEntry = vi.fn<(id: string) => Promise<void>>(async () => undefined);
  readonly duplicateEntry = vi.fn<(id: string, body: unknown) => Promise<EntryDto>>();
  readonly createFavoriteFromEntry = vi.fn<(id: string, body: unknown) => Promise<FavoriteDto>>();
  readonly renameFood = vi.fn<(body: FoodRenameRequest) => Promise<FoodRenameResponse>>(
    async () => ({ matchedEntries: 0, renamedEntries: 0, renamedItems: 0 }),
  );
}

function installDialogShim(): () => void {
  const proto = HTMLDialogElement.prototype;
  const keys = ['open', 'showModal', 'close'] as const;
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'open', {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute('open');
    },
  });
  Object.defineProperty(proto, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(proto, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (this.hasAttribute('open')) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      }
    },
  });
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(proto, key, descriptor);
      } else {
        Reflect.deleteProperty(proto, key);
      }
    }
  };
}

describe('HistoryPage', () => {
  const today = todayLocalDate();
  const yesterday = addDays(today, -1);
  let api: FakeApi;
  let restoreDialog: () => void;

  beforeAll(() => {
    restoreDialog = installDialogShim();
  });

  afterAll(() => restoreDialog());

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  async function render(
    first: EntryListResponse,
  ): Promise<{ fixture: ComponentFixture<HistoryPage>; el: HTMLElement }> {
    api.listEntries.mockResolvedValueOnce(first);
    const fixture = TestBed.createComponent(HistoryPage);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function settle(fixture: ComponentFixture<HistoryPage>, ms = 0): Promise<void> {
    await sleep(ms);
    await fixture.whenStable();
  }

  function cards(fixture: ComponentFixture<HistoryPage>): EntryCard[] {
    return fixture.debugElement
      .queryAll(By.directive(EntryCard))
      .map((debug) => debug.componentInstance as EntryCard);
  }

  function toastMessages(): string[] {
    return TestBed.inject(ToastService)
      .toasts()
      .map((toast) => toast.message);
  }

  it('groups entries by day under linked headers with day totals', async () => {
    const { el } = await render({
      items: [
        entry('a', today, 12, 612.4, 40.2),
        entry('b', today, 8, 400, 20),
        entry('c', yesterday, 19, 700, 35),
      ],
      nextCursor: null,
    });

    expect(api.listEntries).toHaveBeenCalledWith({ limit: 30 });
    const headers = Array.from(el.querySelectorAll<HTMLAnchorElement>('h2 a'));
    expect(headers.map((link) => link.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Today'),
      expect.stringContaining('Yesterday'),
    ]);
    expect(headers[0].textContent).toContain('1,012');
    expect(headers[0].textContent).toContain('60.2 g protein');
    expect(headers[1].textContent).toContain('700');
    expect(headers[0].getAttribute('href')).toBe(`/today?date=${today}`);
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(3);
    expect(el.textContent).toContain("You've reached the start of your log.");
  });

  it('keeps late-night meals under Today until the day starts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 0, 56));
    try {
      setDayStartHour(DEFAULT_DAY_START_HOUR, null);
      const apple = {
        ...entry('apple', '2026-10-01', 0, 95, 0.5),
        timestamp: new Date(2026, 9, 2, 0, 56).toISOString(),
      };
      const { fixture, el } = await render({
        items: [
          apple,
          entry('dinner', '2026-10-01', 20, 800, 45),
          entry('c', '2026-09-30', 19, 700, 35),
        ],
        nextCursor: null,
      });

      const headers = Array.from(el.querySelectorAll<HTMLAnchorElement>('h2 a'));
      expect(headers.map((link) => link.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        expect.stringContaining('Today'),
        expect.stringContaining('Yesterday'),
      ]);
      expect(headers[0].getAttribute('href')).toBe('/today?date=2026-10-01');

      api.duplicateEntry.mockResolvedValueOnce({ ...apple, id: 'apple-2' });
      cards(fixture)[0].logAgain.emit(apple);
      await settle(fixture);
      expect(api.duplicateEntry.mock.calls[0][1]).toMatchObject({ localDate: '2026-10-01' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the empty state with a camera action when nothing is logged', async () => {
    const { el } = await render({ items: [], nextCursor: null });
    expect(el.textContent).toContain('No meals logged yet');
    expect(el.textContent).toContain('Take a photo');
  });

  it('debounces the search box and shows a no-results state that can be cleared', async () => {
    const { fixture, el } = await render({
      items: [entry('a', today, 12, 500, 30)],
      nextCursor: null,
    });
    api.listEntries.mockResolvedValueOnce({ items: [], nextCursor: null });

    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = '  oat ';
    input.dispatchEvent(new Event('input'));
    input.value = '  oats ';
    input.dispatchEvent(new Event('input'));
    await settle(fixture, SEARCH_DEBOUNCE_MS / 2);
    expect(api.listEntries).toHaveBeenCalledTimes(1);

    await settle(fixture, SEARCH_DEBOUNCE_MS);
    expect(api.listEntries).toHaveBeenCalledTimes(2);
    expect(api.listEntries).toHaveBeenLastCalledWith({ limit: 30, q: 'oats' });
    expect(el.textContent).toContain('No matches');
    expect(el.textContent).toContain('“oats”');

    api.listEntries.mockResolvedValueOnce({
      items: [entry('a', today, 12, 500, 30)],
      nextCursor: null,
    });
    const clear = el.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!;
    clear.click();
    await settle(fixture);
    expect(api.listEntries).toHaveBeenLastCalledWith({ limit: 30 });
    expect(input.value).toBe('');
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(1);
  });

  it('falls back to a Load more button and appends the next page with the cursor', async () => {
    const { fixture, el } = await render({
      items: [entry('b', today, 12, 500, 30)],
      nextCursor: 'cursor-1',
    });
    expect(el.querySelector('h2')?.textContent).toContain('500+');
    api.listEntries.mockResolvedValueOnce({
      items: [entry('a', yesterday, 12, 300, 10)],
      nextCursor: null,
    });

    const more = Array.from(el.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Load more',
    )!;
    more.click();
    await settle(fixture);

    expect(api.listEntries).toHaveBeenLastCalledWith({ limit: 30, before: 'cursor-1' });
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(2);
    expect(el.querySelector('h2')?.textContent).not.toContain('+');
    expect(el.textContent).toContain("You've reached the start of your log.");
  });

  it('deletes an entry after confirmation and removes it from the list', async () => {
    const target = entry('a', today, 12, 500, 30);
    const { fixture, el } = await render({
      items: [target, entry('b', yesterday, 12, 300, 10)],
      nextCursor: null,
    });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);

    cards(fixture)[0].delete.emit(target);
    await settle(fixture);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(api.deleteEntry).toHaveBeenCalledWith('a');
    expect(el.querySelector('li.history-leave')).not.toBeNull();

    await settle(fixture, REMOVE_ANIMATION_MS + 20);
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(1);
    expect(el.textContent).not.toContain('Today');
    expect(toastMessages()).toContain('Entry deleted');
  });

  it('keeps the entry when deletion is cancelled or fails', async () => {
    const target = entry('a', today, 12, 500, 30);
    const { fixture, el } = await render({ items: [target], nextCursor: null });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);

    cards(fixture)[0].delete.emit(target);
    await settle(fixture);
    expect(api.deleteEntry).not.toHaveBeenCalled();

    confirm.mockResolvedValue(true);
    api.deleteEntry.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 500, error: { statusCode: 500, message: 'Database down' } }),
    );
    cards(fixture)[0].delete.emit(target);
    await settle(fixture, REMOVE_ANIMATION_MS + 20);

    expect(el.querySelectorAll('app-entry-card')).toHaveLength(1);
    expect(el.querySelector('li.history-leave')).toBeNull();
    expect(toastMessages()).toContain('Database down.');
  });

  it('puts the oldest loaded entry back when its deletion fails while more pages exist', async () => {
    const oldest = entry('a', yesterday, 12, 300, 10);
    const { fixture, el } = await render({
      items: [entry('b', today, 12, 500, 30), oldest],
      nextCursor: 'cursor-1',
    });
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    api.deleteEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));

    cards(fixture)[1].delete.emit(oldest);
    await settle(fixture, REMOVE_ANIMATION_MS + 20);

    expect(cards(fixture).map((card) => card.entry().id)).toEqual(['b', 'a']);
    expect(el.textContent).toContain('Yesterday');
  });

  it('opens a logged copy from the toast without remembering a stale scroll position', async () => {
    const source = entry('a', yesterday, 12, 500, 30);
    const { fixture } = await render({ items: [source], nextCursor: null });
    api.duplicateEntry.mockResolvedValueOnce({ ...entry('z', today, 13, 500, 30) });
    cards(fixture)[0].logAgain.emit(source);
    await settle(fixture);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.destroy();
    const toast = TestBed.inject(ToastService);
    toast.runAction(toast.toasts().at(-1)!.id);

    expect(navigate).toHaveBeenCalledWith(['/entries', 'z']);
    expect(TestBed.inject(HistoryStore).takeReturn()).toBeNull();
  });

  it('logs an entry again now, filed under the meal type of the current time', async () => {
    const now = guessMealType(new Date());
    const source: EntryDto = {
      ...entry('a', yesterday, 12, 500, 30),
      mealType: now === 'breakfast' ? 'dinner' : 'breakfast',
    };
    const { fixture, el } = await render({ items: [source], nextCursor: null });
    const copy = { ...entry('z', today, 13, 500, 30), name: source.name };
    api.duplicateEntry.mockResolvedValueOnce(copy);

    cards(fixture)[0].logAgain.emit(source);
    await settle(fixture);

    expect(api.duplicateEntry).toHaveBeenCalledTimes(1);
    const body = api.duplicateEntry.mock.calls[0][1] as {
      timestamp: string;
      localDate: string;
      mealType: MealType;
    };
    expect(body).toEqual({
      timestamp: expect.any(String),
      localDate: today,
      mealType: guessMealType(new Date(body.timestamp)),
    });
    expect(MEAL_TYPES).toContain(body.mealType);
    expect(body.mealType).not.toBe(source.mealType);
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(2);
    const toast = TestBed.inject(ToastService).toasts().at(-1)!;
    expect(toast.message).toBe('Logged “Meal a” again');
    expect(toast.action?.label).toBe('View');
  });

  it('saves an entry as a favorite with the chosen name', async () => {
    const source = entry('a', today, 12, 500, 30);
    const { fixture, el } = await render({ items: [source], nextCursor: null });
    api.createFavoriteFromEntry.mockImplementation(
      async (_id, body) =>
        ({
          ...(body as { name: string }),
        }) as FavoriteDto,
    );

    cards(fixture)[0].favorite.emit(source);
    await settle(fixture);
    const input = el.querySelector<HTMLInputElement>('app-save-favorite-sheet input')!;
    expect(input.value).toBe('Meal a');

    input.value = '  Usual lunch  ';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('app-save-favorite-sheet form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await settle(fixture);

    expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('a', { name: 'Usual lunch' });
    expect(toastMessages()).toContain('Saved “Usual lunch” to favorites');
    expect(el.querySelector('app-save-favorite-sheet dialog')?.hasAttribute('open')).toBe(false);
    expect(api.renameFood).toHaveBeenCalledWith({
      from: 'Meal a',
      to: 'Usual lunch',
      dryRun: true,
    });
  });

  it('renames past entries to the new favorite name when the user agrees', async () => {
    const source = entry('a', today, 12, 500, 30);
    const { fixture, el } = await render({ items: [source], nextCursor: null });
    api.createFavoriteFromEntry.mockImplementation(
      async (_id, body) => ({ ...(body as { name: string }) }) as FavoriteDto,
    );
    api.renameFood.mockImplementation(async (body) => ({
      matchedEntries: 2,
      renamedEntries: body.dryRun ? 0 : 2,
      renamedItems: 0,
    }));
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);

    cards(fixture)[0].favorite.emit(source);
    await settle(fixture);
    const input = el.querySelector<HTMLInputElement>('app-save-favorite-sheet input')!;
    input.value = 'Usual lunch';
    input.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('app-save-favorite-sheet form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await settle(fixture);
    await settle(fixture);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Also rename past entries?' }),
    );
    expect(api.renameFood).toHaveBeenLastCalledWith({ from: 'Meal a', to: 'Usual lunch' });
    expect(toastMessages()).toContain('Renamed 2 entries to “Usual lunch”');
  });

  it('does not offer a rename when the favorite keeps the entry name', async () => {
    const source = entry('a', today, 12, 500, 30);
    const { fixture, el } = await render({ items: [source], nextCursor: null });
    api.createFavoriteFromEntry.mockImplementation(
      async (_id, body) => ({ ...(body as { name: string }) }) as FavoriteDto,
    );
    cards(fixture)[0].favorite.emit(source);
    await settle(fixture);
    el.querySelector<HTMLFormElement>('app-save-favorite-sheet form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await settle(fixture);
    expect(api.createFavoriteFromEntry).toHaveBeenCalled();
    expect(api.renameFood).not.toHaveBeenCalled();
  });

  it('asks before discarding a renamed favorite but closes an untouched one', async () => {
    const source = entry('a', today, 12, 500, 30);
    const { fixture, el } = await render({ items: [source], nextCursor: null });
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);
    const sheet = el.querySelector('app-save-favorite-sheet')!;
    const close = async () => {
      sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(fixture);
    };

    cards(fixture)[0].favorite.emit(source);
    await settle(fixture);
    await close();
    expect(confirm).not.toHaveBeenCalled();
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(false);

    cards(fixture)[0].favorite.emit(source);
    await settle(fixture);
    const input = sheet.querySelector<HTMLInputElement>('input')!;
    input.value = 'Usual lunch';
    input.dispatchEvent(new Event('input'));
    await close();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard changes?' }));
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(true);

    confirm.mockResolvedValueOnce(true);
    await close();
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(api.createFavoriteFromEntry).not.toHaveBeenCalled();
  });

  it('shows an inline error with retry when the first page fails', async () => {
    api.listEntries.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    const fixture = TestBed.createComponent(HistoryPage);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain("History didn't load");
    expect(el.textContent).toContain('offline');

    api.listEntries.mockResolvedValueOnce({
      items: [entry('a', today, 12, 500, 30)],
      nextCursor: null,
    });
    Array.from(el.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Try again'))!
      .click();
    await settle(fixture);
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(1);
  });

  it('announces its own changes without refetching the list', async () => {
    const target = entry('a', today, 12, 500, 30);
    const { fixture } = await render({ items: [target], nextCursor: null });
    const events = TestBed.inject(DataEventsService);
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    api.duplicateEntry.mockResolvedValueOnce(entry('z', today, 13, 500, 30));

    cards(fixture)[0].logAgain.emit(target);
    await settle(fixture);
    cards(fixture)[1].delete.emit(target);
    await settle(fixture, REMOVE_ANIMATION_MS + EXTERNAL_REFRESH_DEBOUNCE_MS + 20);

    expect(events.entries()).toBe(2);
    expect(api.listEntries).toHaveBeenCalledTimes(1);
  });

  it('revalidates once when entries change elsewhere while it is open', async () => {
    const { fixture, el } = await render({
      items: [entry('a', today, 12, 500, 30)],
      nextCursor: null,
    });
    api.listEntries.mockResolvedValueOnce({
      items: [entry('b', today, 18, 250, 12), entry('a', today, 12, 500, 30)],
      nextCursor: null,
    });
    const events = TestBed.inject(DataEventsService);
    events.notify('entries');
    await fixture.whenStable();
    events.notify('entries');
    await settle(fixture, EXTERNAL_REFRESH_DEBOUNCE_MS + 20);

    expect(api.listEntries).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(2);
  });

  it('reloads a cached list that went stale while it was closed', async () => {
    const { fixture } = await render({ items: [entry('a', today, 12, 500, 30)], nextCursor: null });
    fixture.destroy();
    TestBed.inject(DataEventsService).notify('entries');
    api.listEntries.mockResolvedValueOnce({ items: [], nextCursor: null });

    const again = TestBed.createComponent(HistoryPage);
    await settle(again);
    expect(api.listEntries).toHaveBeenCalledTimes(2);
    expect(api.listEntries).toHaveBeenLastCalledWith({ limit: 30 });
    expect((again.nativeElement as HTMLElement).textContent).toContain('No meals logged yet');
  });

  it('announces a new favorite', async () => {
    const source = entry('a', today, 12, 500, 30);
    const { fixture, el } = await render({ items: [source], nextCursor: null });
    api.createFavoriteFromEntry.mockResolvedValueOnce({ name: 'Lunch' } as FavoriteDto);
    cards(fixture)[0].favorite.emit(source);
    await settle(fixture);
    el.querySelector<HTMLFormElement>('app-save-favorite-sheet form')!.dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    await settle(fixture);
    expect(TestBed.inject(DataEventsService).favorites()).toBe(1);
  });
});
