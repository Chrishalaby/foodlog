import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { addDays, type WeightLogDto, type WeightSummaryResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { ToastService } from '../../core/toast.service';
import { makeWeightSummary } from './today-fixtures';
import { WeightCard } from './weight-card';
import { WEIGHT_CARD_WINDOW_DAYS, WeightCardStore } from './weight-card-store';

const TODAY = '2026-09-28';
const FROM = addDays(TODAY, -(WEIGHT_CARD_WINDOW_DAYS - 1));
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function log(date: string, weightKg: number): WeightLogDto {
  return { date, weightKg, bodyFatPct: null };
}

describe('WeightCard', () => {
  let api: {
    weights: ReturnType<typeof vi.fn<(from: string, to: string) => Promise<WeightSummaryResponse>>>;
    putWeight: ReturnType<
      typeof vi.fn<(date: string, body: { weightKg: number }) => Promise<WeightLogDto>>
    >;
  };

  beforeEach(() => {
    api = { weights: vi.fn(), putWeight: vi.fn() };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  async function render(
    summary: WeightSummaryResponse | Error,
    date = TODAY,
  ): Promise<{ fixture: ComponentFixture<WeightCard>; el: HTMLElement }> {
    if (summary instanceof Error) {
      api.weights.mockRejectedValueOnce(summary);
    } else {
      api.weights.mockResolvedValueOnce(summary);
    }
    const fixture = TestBed.createComponent(WeightCard);
    fixture.componentRef.setInput('date', date);
    fixture.componentRef.setInput('today', TODAY);
    fixture.componentRef.setInput('goal', 'cut');
    void TestBed.inject(WeightCardStore).show(date);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function button(el: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(el.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label,
    );
    if (!found) {
      throw new Error(`No button "${label}"`);
    }
    return found as HTMLButtonElement;
  }

  it('loads the last 30 days and offers to log today prefilled with the latest weight', async () => {
    const summary = makeWeightSummary(
      FROM,
      TODAY,
      [log(addDays(TODAY, -9), 81.2), log(addDays(TODAY, -2), 80.4)],
      { weeklyChangeKg: -0.42 },
    );
    const { el } = await render(summary);

    expect(api.weights).toHaveBeenCalledWith(FROM, TODAY);
    expect(el.textContent).toContain('Log today’s weight');
    const input = el.querySelector<HTMLInputElement>('#today-weight-input')!;
    expect(input.value).toBe('80.4');
    expect(input.getAttribute('aria-label')).toBe('Weight for today in kg');
    expect(el.textContent).toContain('81.1 kg');
    const weekly = Array.from(el.querySelectorAll('p')).find((p) => p.textContent?.includes('/wk'));
    expect(weekly?.textContent?.trim()).toBe('−0.42 kg/wk');
    expect(weekly?.className).toContain('text-ok');
    const link = el.querySelector('a[href]');
    expect(link?.getAttribute('href')).toBe('/stats?tab=weight');
  });

  it('steps by 0.1 kg and saves the weigh-in for the viewed day', async () => {
    const { fixture, el } = await render(
      makeWeightSummary(FROM, TODAY, [log(addDays(TODAY, -1), 80.4)]),
    );
    const events = TestBed.inject(DataEventsService);
    button(el, 'Increase by 0.1 kg').click();
    button(el, 'Increase by 0.1 kg').click();
    button(el, 'Decrease by 0.1 kg').click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#today-weight-input')!;
    expect(input.value).toBe('80.5');

    api.putWeight.mockImplementationOnce(async (date, body) => log(date, body.weightKg));
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixture.whenStable();

    expect(api.putWeight).toHaveBeenCalledWith(TODAY, { weightKg: 80.5 });
    expect(events.weights()).toBe(1);
    expect(events.profile()).toBe(1);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe('Saved 80.5 kg for today');
    expect(el.querySelector('#today-weight-input')).toBeNull();
    expect(el.textContent).toContain('Today’s weight');
    expect(el.textContent).toContain('80.5');
  });

  it('keeps a typed weight when the card refreshes in the background', async () => {
    const logs = [log(addDays(TODAY, -2), 80.4)];
    const { fixture, el } = await render(makeWeightSummary(FROM, TODAY, logs));
    const input = el.querySelector<HTMLInputElement>('#today-weight-input')!;
    input.value = '79.9';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    api.weights.mockResolvedValueOnce(
      makeWeightSummary(FROM, TODAY, logs, { weeklyChangeKg: -0.3 }),
    );
    await TestBed.inject(WeightCardStore).refresh();
    await fixture.whenStable();
    expect(el.textContent).toContain('−0.30 kg/wk');
    expect(el.querySelector<HTMLInputElement>('#today-weight-input')!.value).toBe('79.9');
  });

  it('rejects an impossible weight without calling the API', async () => {
    const { fixture, el } = await render(makeWeightSummary(FROM, TODAY));
    const input = el.querySelector<HTMLInputElement>('#today-weight-input')!;
    expect(input.value).toBe('');
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();

    expect(api.putWeight).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('between 25 and 400 kg');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a logged day and lets the weigh-in be corrected', async () => {
    const { fixture, el } = await render(
      makeWeightSummary(FROM, TODAY, [log(addDays(TODAY, -1), 80.9), log(TODAY, 80.2)]),
    );
    expect(el.textContent).toContain('Today’s weight');
    expect(el.textContent).toContain('80.2');
    expect(el.querySelector('#today-weight-input')).toBeNull();

    button(el, 'Change this weigh-in').click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#today-weight-input')!;
    expect(input.value).toBe('80.2');
    expect(el.textContent).toContain('Edit weight for today');

    button(el, 'Cancel').click();
    await fixture.whenStable();
    expect(el.querySelector('#today-weight-input')).toBeNull();
  });

  it('labels a past day and shows a retryable error', async () => {
    const past = addDays(TODAY, -3);
    const { fixture, el } = await render(new Error('offline'), past);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load your weight');

    api.weights.mockResolvedValueOnce(makeWeightSummary(addDays(past, -29), past));
    button(el, 'Retry').click();
    await flush();
    await fixture.whenStable();
    expect(api.weights).toHaveBeenLastCalledWith(addDays(past, -29), past);
    expect(el.textContent).toContain(`Log weight for`);
    expect(el.querySelector('#today-weight-input')?.getAttribute('aria-label')).toMatch(
      /^Weight for \w{3} \d+ \w{3} in kg$/,
    );
  });
});
