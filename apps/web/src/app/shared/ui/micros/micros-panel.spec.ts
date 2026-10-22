import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { microTargets, type Micros, type MicrosCoverage } from '@food/shared';
import { MicrosPanel } from './micros-panel';
import type { MicrosScope } from './micros-model';

@Component({
  imports: [MicrosPanel],
  template: `
    <app-micros-panel
      [micros]="micros()"
      [targets]="targets"
      [coverage]="coverage()"
      [scope]="scope()"
    />
  `,
})
class Host {
  readonly targets = microTargets('male', 34);
  readonly micros = signal<Micros | null>({
    vitaminD: 125,
    vitaminC: 0,
    iron: 6,
    caffeine: 250,
  });
  readonly coverage = signal<MicrosCoverage | null>({ items: 9, withMicros: 7 });
  readonly scope = signal<MicrosScope>('day');
}

describe('MicrosPanel', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const rowOf = (key: string): HTMLElement =>
      el.querySelector<HTMLElement>(`[data-micro="${key}"]`)!;
    return { fixture, host: fixture.componentInstance, el, rowOf };
  }

  it('lists vitamins, minerals and other nutrients under their own headings', async () => {
    const { el } = await render();
    const headings = Array.from(el.querySelectorAll('h3')).map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Vitamins', 'Minerals', 'Other']);
    expect(el.querySelectorAll('li[data-micro]')).toHaveLength(15);
    const minerals = el.querySelector<HTMLElement>('section:nth-of-type(2)')!;
    expect(minerals.getAttribute('aria-labelledby')).toBe(minerals.querySelector('h3')!.id);
  });

  it('shows unknown nutrients as a dash without a bar and a known zero as 0', async () => {
    const { rowOf } = await render();
    const unknown = rowOf('vitaminK');
    expect(unknown.textContent).toContain('—');
    expect(unknown.dataset['tone']).toBe('unknown');
    expect(unknown.querySelector('.h-full')).toBeNull();
    expect(unknown.querySelector('.sr-only')?.textContent).toBe('Vitamin K: no estimate.');
    const zero = rowOf('vitaminC');
    expect(zero.textContent).toContain('0 mg');
    expect(zero.textContent).toContain('0%');
    expect(zero.textContent).not.toContain('—');
  });

  it('fills the bar toward the target and warns above the upper limit', async () => {
    const { rowOf } = await render();
    const iron = rowOf('iron');
    expect(iron.textContent).toContain('6 mg');
    expect(iron.textContent).toContain('75%');
    expect(iron.querySelector<HTMLElement>('.h-full')!.style.width).toBe('75%');
    expect(iron.querySelector('.h-full')!.classList.contains('bg-accent')).toBe(true);

    const vitaminD = rowOf('vitaminD');
    expect(vitaminD.dataset['tone']).toBe('warn');
    expect(vitaminD.textContent).toContain('833%');
    expect(vitaminD.textContent).toContain('Above the usual upper limit (100 µg/day)');
    const bar = vitaminD.querySelector<HTMLElement>('.h-full')!;
    expect(bar.style.width).toBe('100%');
    expect(bar.classList.contains('bg-warn')).toBe(true);
  });

  it('marks cholesterol and caffeine as limits', async () => {
    const { fixture, host, rowOf } = await render();
    const caffeine = rowOf('caffeine');
    expect(caffeine.textContent).toContain('limit 400 mg');
    expect(caffeine.querySelector('.h-full')!.classList.contains('bg-muted')).toBe(true);
    expect(rowOf('cholesterol').textContent).toContain('limit 300 mg');

    host.micros.set({ caffeine: 480 });
    await fixture.whenStable();
    const over = rowOf('caffeine');
    expect(over.querySelector('.h-full')!.classList.contains('bg-warn')).toBe(true);
    expect(over.textContent).toContain('Over the 400 mg/day limit');
  });

  it('gives every row a full sentence for screen readers and hides the visual parts', async () => {
    const { rowOf } = await render();
    const vitaminD = rowOf('vitaminD');
    expect(vitaminD.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(vitaminD.querySelector('.sr-only')?.textContent).toBe(
      'Vitamin D: 125 µg, 833% of the 15 µg daily target. Above the usual upper limit (100 µg/day).',
    );
  });

  it('ends with the coverage line and one disclaimer', async () => {
    const { fixture, host, el } = await render();
    expect(el.querySelector('[data-micros-coverage]')?.textContent).toBe(
      'Estimated for 7 of 9 foods; older logs have no vitamin data',
    );
    expect(el.querySelectorAll('[data-micros-disclaimer]')).toHaveLength(1);
    expect(el.querySelector('[data-micros-disclaimer]')?.textContent?.trim()).toBe(
      'Rough estimates to spot gaps, not exact amounts',
    );

    host.scope.set('meal');
    host.coverage.set({ items: 3, withMicros: 2 });
    await fixture.whenStable();
    expect(el.querySelector('[data-micros-coverage]')?.textContent).toBe(
      'Estimated for 2 of 3 foods',
    );

    host.coverage.set(null);
    await fixture.whenStable();
    expect(el.querySelector('[data-micros-coverage]')).toBeNull();
    expect(el.querySelector('[data-micros-disclaimer]')).not.toBeNull();
  });
});
