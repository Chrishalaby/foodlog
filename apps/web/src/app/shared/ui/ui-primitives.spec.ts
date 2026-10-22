import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type EntryDto } from '@food/shared';
import { EntryCard } from './entry-card';
import { MacroSummary } from './macro-summary';
import { NutrientBar } from './nutrient-bar';
import { ProgressRing } from './progress-ring';
import { SegmentedControl, type SegmentOption } from './segmented-control';

const ENTRY: EntryDto = {
  portion: null,
  id: 'e1',
  name: 'Chicken bowl',
  description: null,
  mealType: 'lunch',
  source: 'food_photo',
  timestamp: '2026-09-28T11:30:00.000Z',
  localDate: '2026-09-28',
  items: [],
  totals: { ...zeroNutrients(), calories: 642, protein: 48.5, carbs: 61, fat: 19.2 },
  photo: null,
  photos: [],
  analysisId: null,
  favoriteId: null,
  productId: null,
  createdAt: '2026-09-28T11:30:00.000Z',
  updatedAt: '2026-09-28T11:30:00.000Z',
};

@Component({
  imports: [ProgressRing, NutrientBar, MacroSummary, EntryCard, SegmentedControl],
  template: `
    <app-progress-ring [value]="value()" [target]="2000" label="Calories" />
    <app-nutrient-bar id="max" label="Sodium" [value]="2500" [target]="2300" kind="max" unit="mg" />
    <app-nutrient-bar id="min" label="Fiber" [value]="30" [target]="28" kind="min" />
    <app-macro-summary [nutrients]="entry.totals" [(expanded)]="expanded" />
    <app-entry-card [entry]="entry" (edit)="edited.set($event.id)" />
    <app-segmented-control [options]="options" [(value)]="range" />
  `,
})
class Host {
  readonly value = signal(1500);
  readonly expanded = signal(false);
  readonly edited = signal<string | null>(null);
  readonly range = signal<'week' | 'month'>('week');
  readonly entry = ENTRY;
  readonly options: SegmentOption<'week' | 'month'>[] = [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];
}

describe('UI primitives', () => {
  it('render values, statuses and emit interactions', async () => {
    const fixture = TestBed.createComponent(Host);
    const host = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();

    const ring = el.querySelector('app-progress-ring')!;
    expect(ring.getAttribute('aria-label')).toContain('500 kcal left');
    host.value.set(2250);
    await fixture.whenStable();
    expect(ring.getAttribute('aria-label')).toContain('250 kcal over');

    expect(el.querySelector('#max')!.textContent).toContain('200 mg over limit');
    expect(el.querySelector('#min')!.textContent).toContain('Minimum reached');

    expect(el.querySelector('app-macro-summary')!.textContent).toContain('48.5');
    expect(el.querySelector('app-macro-summary dl')).toBeNull();
    const more = Array.from(el.querySelectorAll('app-macro-summary button')).find((b) =>
      b.textContent?.includes('More nutrients'),
    ) as HTMLButtonElement;
    more.click();
    await fixture.whenStable();
    expect(host.expanded()).toBe(true);
    expect(el.querySelector('app-macro-summary dl')).not.toBeNull();

    const card = el.querySelector('app-entry-card')!;
    expect(card.textContent).toContain('Chicken bowl');
    expect(card.textContent).toContain('642');
    expect(card.textContent).toContain('Lunch');

    const month = Array.from(el.querySelectorAll('app-segmented-control button')).find((b) =>
      b.textContent?.includes('Month'),
    ) as HTMLButtonElement;
    month.click();
    await fixture.whenStable();
    expect(host.range()).toBe('month');
    expect(month.getAttribute('aria-checked')).toBe('true');
  });
});
