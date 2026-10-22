import { describe, expect, it } from 'vitest';
import { computeTargets, DEFAULT_BASE_TARGETS, targetsForDay, type TargetProfileInput } from './targets.js';

const male: TargetProfileInput = {
  weightKg: 82,
  heightCm: 180,
  age: 34,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 4,
  targetOverrides: {},
};

describe('computeTargets', () => {
  it('matches the reference maintain fixture with weekly calorie cycling', () => {
    const t = computeTargets(male);
    expect(t.complete).toBe(true);
    expect(t.bmr).toBe(1780);
    expect(t.tdee).toBe(2759);
    expect(t.base).toEqual({
      calories: 2760,
      protein: 131,
      fat: 92,
      carbs: 352,
      satFatMax: 31,
      fiberMin: 39,
      sugarMax: 124,
      sodiumMax: 2300,
    });
    expect(t.trainingDay.calories).toBe(3040);
    expect(t.trainingDay.carbs).toBe(422);
    expect(t.restDay.calories).toBe(2390);
    expect(t.restDay.carbs).toBe(260);
    expect(t.trainingDay.protein).toBe(t.restDay.protein);
  });

  it('applies cut and bulk goal factors', () => {
    expect(computeTargets({ ...male, goal: 'cut' }).base.calories).toBe(2210);
    expect(computeTargets({ ...male, goal: 'cut' }).base.protein).toBe(180);
    expect(computeTargets({ ...male, goal: 'bulk' }).base.calories).toBe(3030);
  });

  it('adds the training bump on top when no weekly training count is set', () => {
    const t = computeTargets({ ...male, trainingDaysPerWeek: 0 });
    expect(t.restDay).toEqual(t.base);
    expect(t.trainingDay.calories).toBe(t.base.calories + 280);
    expect(t.trainingDay.carbs).toBe(t.base.carbs + 70);
  });

  it('uses generic defaults for an incomplete profile', () => {
    const t = computeTargets({ ...male, weightKg: null });
    expect(t.complete).toBe(false);
    expect(t.bmr).toBeNull();
    expect(t.computedBase).toEqual(DEFAULT_BASE_TARGETS);
  });

  it('honours overrides and rebalances carbs', () => {
    const t = computeTargets({ ...male, trainingDaysPerWeek: 0, targetOverrides: { calories: 2500, protein: 180, sodiumMax: 1500 } });
    expect(t.base.calories).toBe(2500);
    expect(t.base.protein).toBe(180);
    expect(t.base.sodiumMax).toBe(1500);
    expect(t.base.carbs).toBe(Math.round((2500 - 4 * 180 - 9 * t.base.fat) / 4));
    expect(targetsForDay(t, true).sodiumMax).toBe(1500);
  });

  it('never drops rest days below the calorie floor', () => {
    const t = computeTargets({
      weightKg: 60,
      heightCm: 165,
      age: 29,
      sex: 'female',
      activityLevel: 'sedentary',
      goal: 'cut',
      trainingDaysPerWeek: 6,
      targetOverrides: {},
    });
    expect(t.restDay.calories).toBeGreaterThanOrEqual(1200);
  });
});

describe('computeTargets body fat and burn override', () => {
  it('uses Katch-McArdle when body fat is known', () => {
    const t = computeTargets({ ...male, bodyFatPct: 15 });
    expect(t.bmrFormula).toBe('katch_mcardle');
    expect(t.bmr).toBe(Math.round(370 + 21.6 * 82 * 0.85));
    expect(t.tdeeSource).toBe('formula');
  });

  it('uses the daily burn override for the calorie target', () => {
    const t = computeTargets({ ...male, tdeeOverride: 3000, trainingDaysPerWeek: 0 });
    expect(t.tdeeSource).toBe('override');
    expect(t.tdee).toBe(3000);
    expect(t.base.calories).toBe(3000);
  });

  it('can compute targets from weight and a burn override alone', () => {
    const t = computeTargets({ ...male, age: null, sex: null, heightCm: null, tdeeOverride: 2500, goal: 'cut' });
    expect(t.complete).toBe(true);
    expect(t.bmr).toBeNull();
    expect(t.base.calories).toBe(2000);
    expect(t.base.protein).toBe(180);
  });
});

describe('computeTargets training frequency', () => {
  const owner: TargetProfileInput = {
    weightKg: 71.6,
    heightCm: 175,
    age: 23,
    sex: 'male',
    activityLevel: 'sedentary',
    goal: 'maintain',
    trainingDaysPerWeek: 6,
    targetOverrides: {},
  };

  it('keeps the single rest day within 15 % of the average when training six days a week', () => {
    const t = computeTargets(owner);
    expect(t.base.calories).toBe(2040);
    expect(t.restDay.calories).toBeGreaterThanOrEqual(Math.round(2040 * 0.85) - 10);
    expect(t.restDay.calories).toBeLessThan(2040);
    expect(t.trainingDay.calories).toBeGreaterThan(2040);
    expect(6 * t.trainingDay.calories + t.restDay.calories).toBeLessThanOrEqual(7 * 2040 + 70);
  });

  it('leaves moderate frequencies unchanged', () => {
    expect(computeTargets({ ...male, trainingDaysPerWeek: 4 }).restDay.calories).toBe(2390);
  });
});
