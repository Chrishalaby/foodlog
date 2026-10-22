import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MEAL_TYPES, type MealType } from '@food/shared';
import { contrastRatio } from '../charts/contrast';
import { DARK_CHART_PALETTE, LIGHT_CHART_PALETTE } from '../charts/echarts';
import {
  MEAL_BADGE_TEXT_PERCENT,
  MEAL_BADGE_TINT_PERCENT,
  MEAL_TYPE_TOKENS,
  MealTypeBadge,
} from './meal-type-badge';

@Component({
  imports: [MealTypeBadge],
  template: `<app-meal-type-badge [mealType]="mealType()" />`,
})
class Host {
  readonly mealType = signal<MealType>('breakfast');
}

function channels(hex: string): number[] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(foreground: string, background: string, percent: number): string {
  const top = channels(foreground);
  const bottom = channels(background);
  const mixed = top.map((channel, i) =>
    Math.round((channel * percent + bottom[i] * (100 - percent)) / 100),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

describe('MealTypeBadge', () => {
  it('labels the meal and tints it with its token, nudged towards the text colour', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const badge = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'app-meal-type-badge > span',
    )!;
    expect(badge.textContent?.trim()).toBe('Breakfast');
    expect(badge.getAttribute('style')).toContain(
      `color-mix(in srgb, var(--color-carbs) ${MEAL_BADGE_TEXT_PERCENT}%, var(--color-fg))`,
    );

    fixture.componentInstance.mealType.set('dinner');
    await fixture.whenStable();
    expect(badge.textContent?.trim()).toBe('Dinner');
    expect(badge.getAttribute('style')).toContain('var(--color-accent)');
  });

  for (const [name, palette] of [
    ['dark', DARK_CHART_PALETTE],
    ['light', LIGHT_CHART_PALETTE],
  ] as const) {
    it(`keeps every ${name} badge label at AA on every surface`, () => {
      for (const mealType of MEAL_TYPES) {
        const token = palette[MEAL_TYPE_TOKENS[mealType]];
        const text = mix(token, palette.fg, MEAL_BADGE_TEXT_PERCENT);
        for (const surface of [palette.bg, palette.surface, palette.surface2, palette.elevated]) {
          const background = mix(token, surface, MEAL_BADGE_TINT_PERCENT);
          expect(
            contrastRatio(text, background)!,
            `${mealType} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
