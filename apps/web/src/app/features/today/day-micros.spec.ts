import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Micros, MicrosCoverage, ProfileDto } from '@food/shared';
import { ProfileStore } from '../../core/profile.store';
import {
  DAY_MICROS_STORAGE_KEY,
  DayMicros,
  readMicrosExpanded,
  writeMicrosExpanded,
} from './day-micros';

@Component({
  imports: [DayMicros],
  template: `<app-day-micros [micros]="micros()" [coverage]="coverage()" />`,
})
class Host {
  readonly micros = signal<Micros | null>({ vitaminD: 125, vitaminC: 40, caffeine: 150 });
  readonly coverage = signal<MicrosCoverage | null>({ items: 9, withMicros: 7 });
}

describe('DayMicros', () => {
  const profile = signal<Partial<ProfileDto> | null>({ sex: 'male', age: 34 });

  beforeEach(() => {
    localStorage.removeItem(DAY_MICROS_STORAGE_KEY);
    profile.set({ sex: 'male', age: 34 });
    TestBed.configureTestingModule({
      providers: [{ provide: ProfileStore, useValue: { profile } }],
    });
  });

  afterEach(() => {
    localStorage.removeItem(DAY_MICROS_STORAGE_KEY);
  });

  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const toggle = () => el.querySelector<HTMLButtonElement>('button[aria-expanded]');
    return { fixture, host: fixture.componentInstance, el, toggle };
  }

  it('shows a collapsed “Vitamins & minerals” row that leads with an upper-limit warning', async () => {
    const { el, toggle } = await render();
    const button = toggle()!;
    expect(button.textContent).toContain('Vitamins & minerals');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBeNull();
    const summary = el.querySelector<HTMLElement>('[data-micros-summary]')!;
    expect(summary.textContent?.trim()).toBe('Vitamin D above the usual limit');
    expect(summary.classList.contains('text-warn')).toBe(true);
    expect(el.querySelector('app-micros-panel')).toBeNull();
  });

  it('expands inline with the grouped rows, the coverage line and the disclaimer', async () => {
    const { fixture, el, toggle } = await render();
    toggle()!.click();
    await fixture.whenStable();
    const button = toggle()!;
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const body = el.querySelector<HTMLElement>(`#${button.getAttribute('aria-controls')}`)!;
    expect(body.querySelector('app-micros-panel')).not.toBeNull();
    expect(body.querySelector('[data-micro="vitaminD"]')?.textContent).toContain(
      'Above the usual upper limit (100 µg/day)',
    );
    expect(body.querySelector('[data-micro="vitaminK"]')?.textContent).toContain('—');
    expect(body.querySelector('[data-micros-coverage]')?.textContent).toBe(
      'Estimated for 7 of 9 foods; older logs have no vitamin data',
    );
    expect(body.querySelector('[data-micros-disclaimer]')?.textContent?.trim()).toBe(
      'Rough estimates to spot gaps, not exact amounts',
    );
  });

  it('remembers on this device whether the row was open', async () => {
    const first = await render();
    first.toggle()!.click();
    await first.fixture.whenStable();
    expect(localStorage.getItem(DAY_MICROS_STORAGE_KEY)).toBe('1');
    first.fixture.destroy();

    const second = await render();
    expect(second.toggle()!.getAttribute('aria-expanded')).toBe('true');
    expect(second.el.querySelector('app-micros-panel')).not.toBeNull();
    second.toggle()!.click();
    await second.fixture.whenStable();
    expect(localStorage.getItem(DAY_MICROS_STORAGE_KEY)).toBe('0');
    expect(second.el.querySelector('app-micros-panel')).toBeNull();
  });

  it('uses the profile’s targets for the percentages', async () => {
    const { fixture, host, el, toggle } = await render();
    host.micros.set({ iron: 8 });
    toggle()!.click();
    await fixture.whenStable();
    expect(el.querySelector('[data-micro="iron"]')?.textContent).toContain('100%');
    profile.set({ sex: 'female', age: 28 });
    await fixture.whenStable();
    expect(el.querySelector('[data-micro="iron"]')?.textContent).toContain('44%');
  });

  it('summarises coverage when nothing is out of range and says when there is no data', async () => {
    const { fixture, host, el } = await render();
    host.micros.set({ vitaminC: 40 });
    await fixture.whenStable();
    expect(el.querySelector('[data-micros-summary]')?.textContent?.trim()).toBe(
      'Estimated for 7 of 9 foods',
    );
    host.micros.set({});
    host.coverage.set({ items: 3, withMicros: 0 });
    await fixture.whenStable();
    expect(el.querySelector('[data-micros-summary]')?.textContent?.trim()).toBe(
      'No vitamin data yet',
    );
  });

  it('stays hidden on a day with nothing logged', async () => {
    const { fixture, host, el } = await render();
    host.micros.set({});
    host.coverage.set({ items: 0, withMicros: 0 });
    await fixture.whenStable();
    expect(el.querySelector('app-day-micros')?.classList.contains('hidden')).toBe(true);
    expect(el.querySelector('button')).toBeNull();
    host.micros.set(null);
    host.coverage.set(null);
    await fixture.whenStable();
    expect(el.querySelector('button')).toBeNull();
  });

  it('treats storage that throws as collapsed and never fails to save', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(readMicrosExpanded(broken)).toBe(false);
    expect(readMicrosExpanded(null)).toBe(false);
    expect(() => writeMicrosExpanded(broken, true)).not.toThrow();
    expect(() => writeMicrosExpanded(null, true)).not.toThrow();
  });
});
