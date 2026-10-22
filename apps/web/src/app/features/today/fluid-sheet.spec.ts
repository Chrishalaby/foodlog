import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { FluidSheet, parseCustomMl, type FluidSheetRequest } from './fluid-sheet';
import { installDialogShim } from './today-fixtures';

const TODAY = '2026-10-01';

describe('FluidSheet', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreDialog();
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
  });

  async function render(date = TODAY): Promise<{
    fixture: ComponentFixture<FluidSheet>;
    el: HTMLElement;
    added: FluidSheetRequest[];
  }> {
    const fixture = TestBed.createComponent(FluidSheet);
    const added: FluidSheetRequest[] = [];
    fixture.componentInstance.added.subscribe((request) => added.push(request));
    fixture.componentRef.setInput('date', date);
    fixture.componentRef.setInput('today', TODAY);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, added };
  }

  function button(el: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.replace(/\s+/g, ' ').trim() === text,
    );
    if (!found) {
      throw new Error(`No button "${text}"`);
    }
    return found as HTMLButtonElement;
  }

  function submitButton(el: HTMLElement): HTMLButtonElement {
    return el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('offers the usual amounts and drinks with 250 ml of water preselected', async () => {
    const { el } = await render();
    const amounts = ['150 ml', '250 ml', '330 ml', '500 ml', '750 ml', 'Custom'];
    for (const label of amounts) {
      expect(button(el, label)).toBeTruthy();
    }
    expect(button(el, '250 ml').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'Water').getAttribute('aria-pressed')).toBe('true');
    for (const kind of ['Coffee', 'Tea', 'Other']) {
      expect(button(el, kind).getAttribute('aria-pressed')).toBe('false');
    }
    expect(submitButton(el).textContent).toContain('Add 250 ml water');
    expect(el.textContent).toContain('Now · today');
  });

  it('emits the chosen amount and drink for now and closes', async () => {
    const { fixture, el, added } = await render();
    button(el, '500 ml').click();
    button(el, 'Tea').click();
    await fixture.whenStable();
    expect(submitButton(el).textContent).toContain('Add 500 ml tea');
    submitButton(el).click();
    await fixture.whenStable();
    expect(added).toEqual([{ ml: 500, kind: 'tea', time: null }]);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('validates a custom amount between 10 and 3000 ml', async () => {
    const { fixture, el, added } = await render();
    button(el, 'Custom').click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#fluid-sheet-custom')!;
    expect(submitButton(el).disabled).toBe(true);

    type(input, '5');
    await fixture.whenStable();
    expect(el.querySelector('#fluid-sheet-custom-error')?.textContent).toContain(
      'Enter 10–3,000 ml.',
    );
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(submitButton(el).disabled).toBe(true);

    type(input, '400');
    await fixture.whenStable();
    expect(el.querySelector('#fluid-sheet-custom-error')).toBeNull();
    expect(submitButton(el).textContent).toContain('Add 400 ml water');
    submitButton(el).click();
    expect(added).toEqual([{ ml: 400, kind: 'water', time: null }]);
  });

  it('lets the time change and notes times after midnight', async () => {
    setDayStartHour(3, null);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 2, 1, 30));
    const { fixture, el, added } = await render();
    button(el, 'Now · today').click();
    await fixture.whenStable();
    const time = el.querySelector<HTMLInputElement>('input[type="time"]')!;
    type(time, '00:30');
    await fixture.whenStable();
    expect(el.textContent).toContain('After midnight (Fri 2 Oct) · counts toward today');

    type(time, '21:15');
    await fixture.whenStable();
    expect(el.textContent).not.toContain('After midnight');
    submitButton(el).click();
    expect(added).toEqual([{ ml: 250, kind: 'water', time: '21:15' }]);
  });

  it('refuses a time that has not happened yet', async () => {
    setDayStartHour(3, null);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 1, 20, 0));
    const { fixture, el } = await render();
    button(el, 'Now · today').click();
    await fixture.whenStable();
    const time = el.querySelector<HTMLInputElement>('input[type="time"]')!;
    type(time, '22:00');
    await fixture.whenStable();
    expect(el.querySelector('#fluid-sheet-time-error')?.textContent).toContain(
      'That time is still to come.',
    );
    expect(time.getAttribute('aria-invalid')).toBe('true');
    expect(submitButton(el).disabled).toBe(true);

    type(time, '00:30');
    await fixture.whenStable();
    expect(el.querySelector('#fluid-sheet-time-error')).not.toBeNull();
    expect(el.textContent).not.toContain('After midnight');

    type(time, '19:30');
    await fixture.whenStable();
    expect(el.querySelector('#fluid-sheet-time-error')).toBeNull();
    expect(submitButton(el).disabled).toBe(false);
  });

  it('focuses the custom amount when it is chosen', async () => {
    const { fixture, el } = await render();
    button(el, 'Custom').click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(el.querySelector('#fluid-sheet-custom'));
  });

  it('goes back to now and starts fresh each time it opens', async () => {
    const { fixture, el } = await render();
    button(el, '750 ml').click();
    button(el, 'Coffee').click();
    button(el, 'Now · today').click();
    await fixture.whenStable();
    button(el, 'Now').click();
    await fixture.whenStable();
    expect(el.querySelector('input[type="time"]')).toBeNull();

    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    expect(button(el, '250 ml').getAttribute('aria-pressed')).toBe('true');
    expect(button(el, 'Water').getAttribute('aria-pressed')).toBe('true');
  });

  it('parses custom amounts as whole millilitres', () => {
    expect(parseCustomMl('400')).toBe(400);
    expect(parseCustomMl(' 330,4 ')).toBe(330);
    expect(parseCustomMl('abc')).toBeNull();
    expect(parseCustomMl('')).toBeNull();
  });
});
