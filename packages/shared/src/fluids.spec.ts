import { describe, expect, it } from 'vitest';
import {
  FLUID_CAFFEINE_MG_PER_ML,
  FLUID_KINDS,
  FLUID_KIND_LABELS,
  FLUID_LIMITS,
  autoFluidTargetMl,
  fluidCaffeineMg,
  fluidTargetMl,
} from './fluids.js';

describe('fluids', () => {
  it('labels every kind and only counts caffeine for coffee and tea', () => {
    expect(Object.keys(FLUID_KIND_LABELS)).toEqual([...FLUID_KINDS]);
    expect(FLUID_KIND_LABELS.water).toBe('Water');
    expect(FLUID_CAFFEINE_MG_PER_ML).toEqual({ water: 0, coffee: 0.4, tea: 0.2, other: 0 });
    expect(FLUID_LIMITS).toEqual({ logMinMl: 10, logMaxMl: 3000, targetMinMl: 500, targetMaxMl: 8000 });
  });

  it('estimates caffeine close to FDA reference cups', () => {
    expect(fluidCaffeineMg('coffee', 355)).toBe(142);
    expect(fluidCaffeineMg('coffee', 355)).toBeGreaterThanOrEqual(113);
    expect(fluidCaffeineMg('coffee', 355)).toBeLessThanOrEqual(247);
    expect(fluidCaffeineMg('tea', 355)).toBe(71);
    expect(fluidCaffeineMg('coffee', 250)).toBe(100);
    expect(fluidCaffeineMg('water', 500)).toBe(0);
    expect(fluidCaffeineMg('other', 330)).toBe(0);
    expect(fluidCaffeineMg('coffee', 0)).toBe(0);
    expect(fluidCaffeineMg('coffee', -50)).toBe(0);
    expect(fluidCaffeineMg('tea', Number.NaN)).toBe(0);
  });

  it('derives the automatic target from weight at 35 ml/kg in 50 ml steps', () => {
    expect(autoFluidTargetMl(80, false)).toBe(2800);
    expect(autoFluidTargetMl(72.4, false)).toBe(2550);
    expect(autoFluidTargetMl(61, false)).toBe(2150);
  });

  it('clamps the automatic target and falls back without a weight', () => {
    expect(autoFluidTargetMl(30, false)).toBe(1500);
    expect(autoFluidTargetMl(200, false)).toBe(4500);
    expect(autoFluidTargetMl(null, false)).toBe(2500);
    expect(autoFluidTargetMl(0, false)).toBe(2500);
    expect(autoFluidTargetMl(Number.NaN, false)).toBe(2500);
  });

  it('adds 500 ml on training days after clamping', () => {
    expect(autoFluidTargetMl(80, true)).toBe(3300);
    expect(autoFluidTargetMl(200, true)).toBe(5000);
    expect(autoFluidTargetMl(null, true)).toBe(3000);
  });

  it('lets a custom target win without a training bonus', () => {
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: 3000 }, true)).toBe(3000);
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: 3000 }, false)).toBe(3000);
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: null }, true)).toBe(3300);
    expect(fluidTargetMl({ weightKg: 80 }, false)).toBe(2800);
    expect(fluidTargetMl({ weightKg: null, fluidTargetMl: undefined }, false)).toBe(2500);
  });

  it('keeps a custom target inside the allowed range', () => {
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: 200 }, false)).toBe(500);
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: 12000 }, false)).toBe(8000);
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: 2499.6 }, false)).toBe(2500);
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: 0 }, false)).toBe(2800);
    expect(fluidTargetMl({ weightKg: 80, fluidTargetMl: Number.NaN }, false)).toBe(2800);
  });
});
