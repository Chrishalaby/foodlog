import { TestBed } from '@angular/core/testing';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { AfterMidnightNote } from './after-midnight-note';

describe('AfterMidnightNote', () => {
  afterEach(() => {
    vi.useRealTimers();
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
  });

  async function render(value: string) {
    const fixture = TestBed.createComponent(AfterMidnightNote);
    fixture.componentRef.setInput('value', value);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('explains that a time before the day start belongs to the eating day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 0, 56));
    setDayStartHour(3, null);
    const { el } = await render('2026-10-01T00:30');
    expect(el.textContent?.trim()).toBe('After midnight (Fri 2 Oct) · counts toward today');
    expect(el.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('offers to move an entry still counted on another day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 9, 0));
    setDayStartHour(3, null);
    const { fixture, el } = await render('2026-10-01T00:56');
    let moved = 0;
    fixture.componentInstance.recount.subscribe(() => moved++);
    fixture.componentRef.setInput('storedDay', { date: '2026-10-02', moving: false });
    await fixture.whenStable();
    expect(el.querySelector('[data-counted-on] > span')?.textContent).toBe('Counted on Fri 2 Oct');
    expect(el.textContent).not.toContain('After midnight');
    const move = el.querySelector<HTMLButtonElement>('[data-counted-on] button')!;
    expect(move.textContent?.trim()).toBe('Move to Thu 1 Oct');
    move.click();
    expect(moved).toBe(1);

    fixture.componentRef.setInput('storedDay', { date: '2026-10-02', moving: true });
    await fixture.whenStable();
    expect(el.querySelector('[data-counted-on]')).toBeNull();
    expect(el.querySelector('[data-day-move]')?.textContent?.trim()).toBe(
      'Moves to Thu 1 Oct when you save',
    );

    fixture.componentRef.setInput('storedDay', { date: '2026-10-01', moving: false });
    await fixture.whenStable();
    expect(el.querySelector('[data-counted-on]')).toBeNull();
    expect(el.querySelector('[data-day-move]')).toBeNull();
    expect(el.textContent).toContain('After midnight (Fri 2 Oct) · counts toward yesterday');
  });

  it('stays empty for daytime values and when the day starts at midnight', async () => {
    setDayStartHour(3, null);
    const { fixture, el } = await render('2026-10-01T12:30');
    expect(el.textContent?.trim()).toBe('');

    fixture.componentRef.setInput('value', '2026-10-01T00:30');
    setDayStartHour(0, null);
    await fixture.whenStable();
    expect(el.textContent?.trim()).toBe('');

    setDayStartHour(3, null);
    await fixture.whenStable();
    expect(el.textContent).toContain('After midnight');
  });
});
