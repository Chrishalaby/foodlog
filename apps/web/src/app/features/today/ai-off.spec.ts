import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DEFAULT_BASE_TARGETS, type DaySummary } from '@food/shared';
import { aiOff } from '../../core/testing/ai-off';
import { MealIdeasCard } from './meal-ideas-card';
import { QuickAdd } from './quick-add';
import { nutrients } from './today-fixtures';

const DAY: DaySummary = {
  date: '2026-10-11',
  trainingDay: false,
  targets: { ...DEFAULT_BASE_TARGETS, calories: 2200 },
  totals: nutrients({ calories: 900 }),
  entryCount: 1,
  micros: {},
  microsCoverage: { items: 0, withMicros: 0 },
  fluidsMl: 0,
  fluidTargetMl: 2500,
};

@Component({
  imports: [MealIdeasCard, QuickAdd],
  template: `
    <app-quick-add [foods]="[]" status="ready" [busyKey]="null" />
    <app-meal-ideas-card [day]="day" />
  `,
})
class Host {
  readonly day = DAY;
}

describe('Today without AI', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), aiOff()] });
  });

  it('hides meal ideas and offers the food database instead of label and describe', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('app-meal-ideas-card')?.classList.contains('hidden')).toBe(true);
    const group = el.querySelector('[role="group"][aria-label="More ways to log"]')!;
    const labels = Array.from(group.querySelectorAll('a, button')).map((node) =>
      node.textContent?.trim(),
    );
    expect(labels).toEqual(['Scan barcode', 'Food database']);
    expect(group.querySelector('a')?.getAttribute('href')).toBe('/foods');
  });
});
