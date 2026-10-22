import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { CreateFluidLogRequest, FluidDayResponse, FluidLogDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { FluidsCard } from './fluids-card';
import { FluidsStore } from './fluids-store';
import { installDialogShim, makeFluidDay, makeFluidDrink, makeFluidLog } from './today-fixtures';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('FluidsCard', () => {
  const today = todayLocalDate();
  let api: {
    fluidDay: ReturnType<typeof vi.fn<(date: string) => Promise<FluidDayResponse>>>;
    createFluid: ReturnType<typeof vi.fn<(body: CreateFluidLogRequest) => Promise<FluidLogDto>>>;
    deleteFluid: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  };
  let restoreDialog: () => void;
  let nextId = 0;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    nextId = 0;
    api = {
      fluidDay: vi.fn(async (date: string) => makeFluidDay(date)),
      createFluid: vi.fn(async (body: CreateFluidLogRequest) =>
        makeFluidLog({ id: `f${++nextId}`, ...body }),
      ),
      deleteFluid: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  afterEach(() => {
    restoreDialog();
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
  });

  async function render(
    day: FluidDayResponse | Error = makeFluidDay(today),
    date = today,
  ): Promise<{ fixture: ComponentFixture<FluidsCard>; el: HTMLElement }> {
    if (day instanceof Error) {
      api.fluidDay.mockRejectedValueOnce(day);
    } else {
      api.fluidDay.mockResolvedValueOnce(day);
    }
    const fixture = TestBed.createComponent(FluidsCard);
    fixture.componentRef.setInput('date', date);
    fixture.componentRef.setInput('today', today);
    void TestBed.inject(FluidsStore).show(date);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
  }

  function button(root: ParentNode, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`No button "${label}"`);
    }
    return found as HTMLButtonElement;
  }

  function progress(el: HTMLElement): string {
    return (
      el.querySelector('[data-fluids-progress]')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    );
  }

  function toasts() {
    return TestBed.inject(ToastService).toasts();
  }

  it('shows progress toward the target with an accessible progress bar', async () => {
    const { el } = await render(
      makeFluidDay(
        today,
        [makeFluidLog({ id: 'a', ml: 1000, localDate: today })],
        [makeFluidDrink({ itemId: 'i1', ml: 400 })],
      ),
    );
    expect(progress(el)).toBe('1.4/ 2.8 L');
    const bar = el.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(bar.getAttribute('aria-valuetext')).toBe('1.4 of 2.8 litres');
    expect(el.textContent).toContain('50%');
    expect(el.querySelector('[data-fluids-note]')?.textContent).toContain('400 ml from meals');
  });

  it('marks the target as reached and caps the bar at 100%', async () => {
    const { el } = await render(
      makeFluidDay(today, [makeFluidLog({ id: 'a', ml: 3000, localDate: today })], [], 2500),
    );
    expect(el.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');
    expect(el.textContent).toContain('120%');
    expect(el.querySelector('[data-fluids-percent] app-icon')).not.toBeNull();
  });

  it('does not round a nearly met target up to done', async () => {
    const { el } = await render(
      makeFluidDay(today, [makeFluidLog({ id: 'a', ml: 2745, localDate: today })], [], 2750),
    );
    expect(progress(el)).toBe('2.74/ 2.75 L');
    expect(el.querySelector('[data-fluids-percent]')?.textContent?.trim()).toBe('99%');
    expect(el.querySelector('[data-fluids-percent] app-icon')).toBeNull();
  });

  it('adds 250 ml of water now with one tap and offers undo', async () => {
    const { fixture, el } = await render();
    const before = Date.now();
    button(el, 'Add 250 ml water').click();
    await settle(fixture);

    const body = api.createFluid.mock.calls[0]![0];
    expect(Object.keys(body).sort()).toEqual(['kind', 'localDate', 'ml', 'timestamp']);
    expect(body).toMatchObject({ ml: 250, kind: 'water', localDate: today });
    expect(Date.parse(body.timestamp)).toBeGreaterThanOrEqual(before - 1000);
    expect(progress(el)).toBe('0.25/ 2.8 L');
    expect(el.querySelectorAll('[data-fluid-log]')).toHaveLength(1);
    const toast = toasts().at(-1)!;
    expect(toast.message).toBe('Added 250 ml water');

    toast.action!.run();
    await settle(fixture);
    expect(api.deleteFluid).toHaveBeenCalledWith('f1');
    expect(progress(el)).toBe('0.0/ 2.8 L');
    expect(toasts().at(-1)?.message).toBe('Removed 250 ml water');
  });

  it('shows the add immediately and rolls it back with a toast when saving fails', async () => {
    const { fixture, el } = await render();
    const saving = deferred<FluidLogDto>();
    api.createFluid.mockReturnValueOnce(saving.promise);

    button(el, 'Add 500 ml water').click();
    await fixture.whenStable();
    expect(progress(el)).toBe('0.5/ 2.8 L');
    expect(el.querySelector('[data-fluid-log] [role="status"]')?.getAttribute('aria-label')).toBe(
      'Saving',
    );

    saving.reject(new HttpErrorResponse({ status: 500 }));
    await settle(fixture);
    expect(progress(el)).toBe('0.0/ 2.8 L');
    expect(el.querySelectorAll('[data-fluid-log]')).toHaveLength(0);
    expect(toasts().at(-1)).toMatchObject({
      kind: 'error',
      message: 'Could not add 500 ml water.',
    });
  });

  it('deletes a log and can bring it back', async () => {
    const log = makeFluidLog({ id: 'a', ml: 330, kind: 'tea', localDate: today });
    const { fixture, el } = await render(makeFluidDay(today, [log]));
    const remove = el.querySelector<HTMLButtonElement>('[data-fluid-log] button')!;
    expect(remove.getAttribute('aria-label')).toMatch(/^Delete Tea, 330 ml/);

    remove.click();
    await settle(fixture);
    expect(api.deleteFluid).toHaveBeenCalledWith('a');
    expect(el.querySelectorAll('[data-fluid-log]')).toHaveLength(0);
    const toast = toasts().at(-1)!;
    expect(toast.message).toBe('Removed 330 ml tea');

    toast.action!.run();
    await settle(fixture);
    expect(api.createFluid).toHaveBeenCalledWith({
      ml: 330,
      kind: 'tea',
      timestamp: log.timestamp,
      localDate: today,
    });
    expect(el.querySelectorAll('[data-fluid-log]')).toHaveLength(1);
  });

  it('puts a log back and explains when deleting fails', async () => {
    const { fixture, el } = await render(
      makeFluidDay(today, [makeFluidLog({ id: 'a', localDate: today })]),
    );
    api.deleteFluid.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    el.querySelector<HTMLButtonElement>('[data-fluid-log] button')!.click();
    await settle(fixture);
    expect(el.querySelectorAll('[data-fluid-log]')).toHaveLength(1);
    expect(toasts().at(-1)).toMatchObject({
      kind: 'error',
      message: 'Could not delete that drink.',
    });
  });

  it('lists drinks from meals read-only', async () => {
    const { el } = await render(makeFluidDay(today, [], [makeFluidDrink({ itemId: 'i1' })]));
    const drink = el.querySelector('[data-fluid-drink]')!;
    expect(drink.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Diet Pepsi · 330 ml · Chicken burger meal',
    );
    expect(drink.getAttribute('aria-label')).toBe('Diet Pepsi, 330 ml, from Chicken burger meal');
    expect(drink.querySelector('button')).toBeNull();
  });

  it('shows the latest three logs and the rest on request', async () => {
    const logs = [6, 7, 8, 9, 10].map((hour) =>
      makeFluidLog({
        id: `l${hour}`,
        localDate: today,
        timestamp: new Date(2026, 8, 28, hour).toISOString(),
      }),
    );
    const { fixture, el } = await render(makeFluidDay(today, logs));
    expect(el.querySelectorAll('[data-fluid-log]')).toHaveLength(3);
    button(el, 'Show all 5 drinks').click();
    await fixture.whenStable();
    expect(el.querySelectorAll('[data-fluid-log]')).toHaveLength(5);
  });

  it('adds a custom drink from the Other sheet', async () => {
    const { fixture, el } = await render();
    button(el, 'Other…').click();
    await fixture.whenStable();
    const sheet = el.querySelector('app-fluid-sheet')!;
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(true);

    button(sheet, '330 ml').click();
    button(sheet, 'Coffee').click();
    await fixture.whenStable();
    button(sheet, 'Add 330 ml coffee').click();
    await settle(fixture);

    expect(api.createFluid).toHaveBeenCalledWith(
      expect.objectContaining({ ml: 330, kind: 'coffee', localDate: today }),
    );
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(toasts().at(-1)?.message).toBe('Added 330 ml coffee');
  });

  it('logs to the viewed past day and says so', async () => {
    const past = '2026-09-20';
    const { fixture, el } = await render(makeFluidDay(past), past);
    button(el, 'Add 250 ml water').click();
    await settle(fixture);
    expect(api.createFluid.mock.calls[0]![0].localDate).toBe(past);
    expect(toasts().at(-1)?.message).toMatch(/^Added 250 ml water for /);
  });

  it('offers a retry when the day cannot be loaded', async () => {
    const { fixture, el } = await render(new Error('offline'));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load your fluids.');
    button(el, 'Retry').click();
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(progress(el)).toBe('0.0/ 2.8 L');
  });
});
