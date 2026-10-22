import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type EntryDto, zeroNutrients } from '@food/shared';
import { EntryCard } from './entry-card';
import { NumberInput } from './number-input';
import { NutrientBar } from './nutrient-bar';
import { ProgressRing, type ProgressRingOverTone } from './progress-ring';
import { SegmentedControl, type SegmentOption } from './segmented-control';

const ENTRY: EntryDto = {
  portion: null,
  id: 'e1',
  name: 'Khoury strawberry yogurt',
  description: null,
  mealType: 'snack',
  source: 'copy',
  timestamp: '2026-09-28T11:30:00.000Z',
  localDate: '2026-09-28',
  items: [],
  totals: { ...zeroNutrients(), calories: 1250, protein: 12.5, carbs: 30, fat: 4.2 },
  photo: null,
  photos: [],
  analysisId: null,
  favoriteId: null,
  productId: null,
  createdAt: '2026-09-28T11:30:00.000Z',
  updatedAt: '2026-09-28T11:30:00.000Z',
};

type Range = 'day' | 'week' | 'month';

@Component({
  imports: [ProgressRing, NutrientBar, SegmentedControl, NumberInput, EntryCard],
  template: `
    <app-progress-ring
      id="protein"
      label="Protein"
      unit="g"
      [value]="protein()"
      [target]="100"
      [overTone]="tone()"
    />
    <app-progress-ring id="calories" [value]="2500" [target]="2000" />
    <app-nutrient-bar
      id="sodium"
      label="Sodium"
      [value]="2500"
      [target]="2300"
      kind="max"
      unit="mg"
    />
    <app-nutrient-bar
      id="fiber"
      label="Fiber"
      [value]="12"
      [target]="30"
      kind="min"
      [showHint]="false"
    />
    <app-nutrient-bar id="zero" label="Sugar" [value]="5" [target]="0" kind="max" />
    <app-segmented-control [options]="options" [(value)]="range" ariaLabel="Range" />
    <app-number-input id="grams" [(value)]="grams" [decimals]="0" />
    <app-number-input id="weight" [(value)]="weight" [decimals]="1" />
    <app-number-input id="delta" [(value)]="delta" [min]="-10" />
    <app-entry-card [entry]="entry" />
  `,
})
class Host {
  readonly protein = signal(120);
  readonly tone = signal<ProgressRingOverTone>('ok');
  readonly range = signal<Range | null>(null);
  readonly grams = signal(150);
  readonly weight = signal(80.5);
  readonly delta = signal(0);
  readonly entry = ENTRY;
  readonly options: SegmentOption<Range | null>[] = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];
}

describe('Shared UI accessibility', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('lets exceeding a target be positive on the progress ring', async () => {
    const { fixture, host, el } = await render();
    const protein = el.querySelector('#protein')!;
    const circles = protein.querySelectorAll('circle');
    expect(circles).toHaveLength(3);
    expect(circles[2]!.getAttribute('stroke')).toBe('var(--color-ok)');
    expect(protein.querySelector('.text-ok')?.textContent?.trim()).toBe('20');
    expect(protein.querySelector('.text-danger')).toBeNull();
    expect(protein.getAttribute('aria-label')).toBe('Protein: 120 of 100 g, 20 g over');

    host.tone.set('warn');
    await fixture.whenStable();
    expect(circles[2]!.getAttribute('stroke')).toBe('var(--color-warn)');

    const calories = el.querySelector('#calories')!;
    expect(calories.querySelectorAll('circle')[2]!.getAttribute('stroke')).toBe(
      'var(--color-danger)',
    );
    expect(calories.querySelector('.text-danger')?.textContent?.trim()).toBe('500');

    host.protein.set(80);
    await fixture.whenStable();
    expect(protein.querySelectorAll('circle')).toHaveLength(2);
    expect(protein.querySelector('.text-fg')?.textContent?.trim()).toBe('20');
  });

  it('keeps progressbar values inside their range and describes the status', async () => {
    const { el } = await render();
    const sodium = el.querySelector('#sodium [role="progressbar"]')!;
    expect(sodium.getAttribute('aria-valuenow')).toBe('2300');
    expect(sodium.getAttribute('aria-valuemax')).toBe('2300');
    expect(sodium.getAttribute('aria-valuetext')).toBe('2,500 of 2,300 mg, 200 mg over limit');

    const fiber = el.querySelector('#fiber [role="progressbar"]')!;
    expect(fiber.getAttribute('aria-valuetext')).toBe('12 of 30 g, 18 g to go');
    expect(el.querySelector('#fiber p')).toBeNull();

    const zero = el.querySelector('#zero [role="progressbar"]')!;
    expect(zero.getAttribute('aria-valuemax')).toBe('100');
    expect(zero.getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps the segmented control reachable and supports arrow, Home and End keys', async () => {
    const { fixture, host, el } = await render();
    const radios = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(radios[0]!.className).toContain('before:-inset-y-1');

    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await fixture.whenStable();
    expect(host.range()).toBe('month');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);

    radios[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await fixture.whenStable();
    expect(host.range()).toBe('day');

    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    radios[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();
    expect(host.range()).toBe('month');

    const ignored = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    radios[2]!.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
  });

  it('picks the right mobile keyboard for number inputs', async () => {
    const { el } = await render();
    const input = (id: string) => el.querySelector<HTMLInputElement>(`#${id} input`)!;
    expect(input('grams').getAttribute('inputmode')).toBe('numeric');
    expect(input('weight').getAttribute('inputmode')).toBe('decimal');
    expect(input('delta').getAttribute('inputmode')).toBe('text');
    expect(input('grams').getAttribute('spellcheck')).toBe('false');
    expect(input('grams').getAttribute('autocapitalize')).toBe('off');
  });

  it('gives entry cards a descriptive label and a contextual actions button', async () => {
    const { el } = await render();
    const card = el.querySelector('app-entry-card')!;
    const [open, actions] = Array.from(card.querySelectorAll<HTMLButtonElement>('article button'));
    const label = open!.getAttribute('aria-label')!;
    expect(label).toContain('Khoury strawberry yogurt, Snack');
    expect(label).toContain('1,250 kcal, protein 12.5 g, carbs 30 g, fat 4.2 g');
    expect(actions!.getAttribute('aria-label')).toBe('Entry actions');
    const nameId = actions!.getAttribute('aria-describedby')!;
    expect(card.querySelector(`#${nameId}`)?.textContent?.trim()).toBe(ENTRY.name);
    expect(actions!.getAttribute('aria-expanded')).toBe('false');
    expect(actions!.className).toContain('btn-icon');
  });
});
