import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { HiddenFoodsResponse } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { ToastService } from '../../../core/toast.service';
import {
  HIDDEN_FOODS_LOAD_FAILED_MESSAGE,
  HIDDEN_FOODS_PREVIEW_COUNT,
  HiddenFoodsSection,
  hiddenFoodLabel,
  sortHiddenNames,
} from './hidden-foods-section';

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

function createApi() {
  return {
    hiddenFoods: vi.fn<() => Promise<HiddenFoodsResponse>>(),
    unhideFood: vi.fn<(name: string) => Promise<HiddenFoodsResponse>>(),
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('hidden suggestion helpers', () => {
  it('sorts names alphabetically without duplicates', () => {
    expect(sortHiddenNames(['yogurt', 'banana bread', 'yogurt', 'apple'])).toEqual([
      'apple',
      'banana bread',
      'yogurt',
    ]);
  });

  it('capitalises the stored lowercase name for display only', () => {
    expect(hiddenFoodLabel('khoury strawberry yogurt')).toBe('Khoury strawberry yogurt');
    expect(hiddenFoodLabel('')).toBe('');
  });
});

describe('HiddenFoodsSection', () => {
  let api: ReturnType<typeof createApi>;

  beforeEach(() => {
    api = createApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  async function render() {
    const fixture = TestBed.createComponent(HiddenFoodsSection);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const rows = () =>
      Array.from(el.querySelectorAll('li')).map((row) =>
        row.querySelector('span')?.textContent?.trim(),
      );
    const unhideButton = (label: string) =>
      el.querySelector<HTMLButtonElement>(`button[aria-label="Unhide ${label}"]`)!;
    return { fixture, el, rows, unhideButton };
  }

  it('lists hidden names alphabetically inside its own settings section', async () => {
    api.hiddenFoods.mockResolvedValue({ names: ['yogurt', 'banana bread'] });
    const { el, rows } = await render();

    expect(el.querySelector('#settings-hidden-foods h2')?.textContent).toContain(
      'Hidden suggestions',
    );
    expect(rows()).toEqual(['Banana bread', 'Yogurt']);
    expect(el.querySelector('button[aria-label="Unhide Yogurt"]')?.textContent).toContain('Unhide');
  });

  it('explains how to hide something when nothing is hidden', async () => {
    api.hiddenFoods.mockResolvedValue({ names: [] });
    const { el } = await render();
    expect(el.querySelector('ul')).toBeNull();
    expect(el.textContent).toContain('Nothing hidden');
    expect(el.textContent).toContain('Long-press a food in Quick add');
  });

  it('shows a retry when the list cannot be loaded', async () => {
    api.hiddenFoods.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const { fixture, el, rows } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      HIDDEN_FOODS_LOAD_FAILED_MESSAGE,
    );

    api.hiddenFoods.mockResolvedValueOnce({ names: ['yogurt'] });
    Array.from(el.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Retry')!
      .click();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(rows()).toEqual(['Yogurt']);
  });

  it('unhides a name, announces it and does not reload its own change', async () => {
    api.hiddenFoods.mockResolvedValue({ names: ['yogurt', 'banana bread'] });
    const pending = deferred<HiddenFoodsResponse>();
    api.unhideFood.mockReturnValueOnce(pending.promise);
    const events = TestBed.inject(DataEventsService);
    const { fixture, rows, unhideButton } = await render();

    unhideButton('Yogurt').click();
    await fixture.whenStable();
    expect(api.unhideFood).toHaveBeenCalledWith('yogurt');
    expect(unhideButton('Yogurt').disabled).toBe(true);
    expect(unhideButton('Banana bread').disabled).toBe(false);

    pending.resolve({ names: ['banana bread'] });
    await flush();
    await fixture.whenStable();
    expect(rows()).toEqual(['Banana bread']);
    expect(events.entries()).toBe(1);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
      '“Yogurt” is back in your suggestions',
    );
    await flush();
    await fixture.whenStable();
    expect(api.hiddenFoods).toHaveBeenCalledTimes(1);
  });

  it('keeps the name listed and says so when unhiding fails', async () => {
    api.hiddenFoods.mockResolvedValue({ names: ['yogurt'] });
    api.unhideFood.mockRejectedValueOnce(new Error('offline'));
    const { fixture, rows, unhideButton } = await render();

    unhideButton('Yogurt').click();
    await flush();
    await fixture.whenStable();
    expect(rows()).toEqual(['Yogurt']);
    expect(unhideButton('Yogurt').disabled).toBe(false);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.kind).toBe('error');
  });

  it('reloads quietly when foods change elsewhere in the app', async () => {
    api.hiddenFoods.mockResolvedValueOnce({ names: ['yogurt'] });
    const { fixture, el, rows } = await render();

    const reload = deferred<HiddenFoodsResponse>();
    api.hiddenFoods.mockReturnValueOnce(reload.promise);
    TestBed.inject(DataEventsService).notify('entries');
    await fixture.whenStable();
    expect(api.hiddenFoods).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual(['Yogurt']);
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();

    reload.resolve({ names: ['yogurt', 'porridge'] });
    await flush();
    await fixture.whenStable();
    expect(rows()).toEqual(['Porridge', 'Yogurt']);
  });

  it('shows the first few names and expands to the full list', async () => {
    const names = Array.from(
      { length: HIDDEN_FOODS_PREVIEW_COUNT + 3 },
      (_, i) => `food ${String(i).padStart(2, '0')}`,
    );
    api.hiddenFoods.mockResolvedValue({ names });
    const { fixture, el, rows } = await render();
    expect(rows()).toHaveLength(HIDDEN_FOODS_PREVIEW_COUNT);

    const toggle = Array.from(el.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show all'),
    )!;
    expect(toggle.textContent).toContain(`Show all ${names.length}`);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(rows()).toHaveLength(names.length);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Show fewer');
  });
});
