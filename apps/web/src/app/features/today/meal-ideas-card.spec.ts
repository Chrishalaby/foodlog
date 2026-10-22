import { TestBed } from '@angular/core/testing';
import { DEFAULT_BASE_TARGETS, type DaySummary } from '@food/shared';
import { MealIdeasCard } from './meal-ideas-card';
import { nutrients } from './today-fixtures';

function day(calories: number): DaySummary {
  return {
    date: '2026-10-11',
    trainingDay: false,
    targets: { ...DEFAULT_BASE_TARGETS, calories: 2200 },
    totals: nutrients({ calories }),
    entryCount: 1,
    micros: {},
    microsCoverage: { items: 0, withMicros: 0 },
    fluidsMl: 0,
    fluidTargetMl: 2500,
  };
}

describe('MealIdeasCard', () => {
  async function render(calories: number) {
    const fixture = TestBed.createComponent(MealIdeasCard);
    let asked = 0;
    fixture.componentInstance.ask.subscribe(() => asked++);
    fixture.componentRef.setInput('day', day(calories));
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    return { button, asked: () => asked };
  }

  it('names the feature, says what is left and asks on tap', async () => {
    const { button, asked } = await render(1300);

    expect(button.textContent).toContain('AI meal ideas');
    expect(button.textContent).toContain('From your usual foods · 900 kcal left');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    button.click();
    expect(asked()).toBe(1);
  });

  it('promises light options once the day is at or over target', async () => {
    const { button } = await render(2300);
    expect(button.textContent).toContain('From your usual foods · light options');
  });
});
