import type { TargetProfileInput } from '@food/shared';
import {
  activityPreviews,
  goalDetail,
  goalNote,
  goalPreviews,
  numbersSummary,
  weeklyKgFromDailyKcal,
} from './onboarding-math';

const INPUT: TargetProfileInput = {
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  bodyFatPct: null,
  tdeeOverride: null,
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 0,
  targetOverrides: {},
};

describe('numbersSummary', () => {
  it('uses Mifflin-St Jeor without body fat', () => {
    const summary = numbersSummary(INPUT);
    expect(summary.targets.bmr).toBe(1780);
    expect(summary.formulaLabel).toBe('Mifflin-St Jeor');
    expect(summary.targets.tdee).toBe(2759);
    expect(summary.formulaTdee).toBe(2759);
    expect(summary.burnSource).toBe('formula');
    expect(summary.targets.base.calories).toBe(2760);
    expect(summary.goalNote).toBe(
      'Matches your daily calorie burn, so your weight should stay steady.',
    );
    expect(summary.body.bmi).toBe(24.7);
    expect(summary.body.bmiCategory).toBe('normal');
    expect(summary.body.ffmi).toBeNull();
  });

  it('switches to Katch-McArdle and shows FFMI when body fat is known', () => {
    const summary = numbersSummary({ ...INPUT, bodyFatPct: 15 });
    expect(summary.formulaLabel).toBe('Katch-McArdle');
    expect(summary.targets.bmr).toBe(Math.round(370 + 21.6 * 68));
    expect(summary.body.leanMassKg).toBe(68);
    expect(summary.body.fatMassKg).toBe(12);
    expect(summary.body.ffmi).toBe(21);
    expect(summary.body.ffmiNormalized).toBe(21);
    expect(summary.body.ffmiCategory).toBe('above_average');
  });

  it('uses the real burn when the user knows it but keeps the formula estimate', () => {
    const summary = numbersSummary({ ...INPUT, tdeeOverride: 2500 });
    expect(summary.targets.tdee).toBe(2500);
    expect(summary.burnSource).toBe('override');
    expect(summary.formulaTdee).toBe(2759);
    expect(summary.targets.base.calories).toBe(2500);
  });

  it('explains the deficit on a cut and the surplus on a bulk', () => {
    const cut = numbersSummary({ ...INPUT, goal: 'cut' });
    expect(cut.targets.base.calories).toBe(2210);
    expect(cut.goalNote).toBe('549 kcal below your daily burn: about 0.5 kg lost per week.');
    const bulk = numbersSummary({ ...INPUT, goal: 'bulk' });
    expect(bulk.goalNote).toBe('271 kcal above your daily burn: about 0.2 kg gained per week.');
  });

  it('falls back to generic targets while details are missing', () => {
    const summary = numbersSummary({ ...INPUT, weightKg: null });
    expect(summary.targets.complete).toBe(false);
    expect(summary.formulaLabel).toBeNull();
    expect(summary.goalNote).toContain('Generic starting targets');
    expect(goalNote(summary.targets)).toBe(summary.goalNote);
  });

  it('keeps the calculated value for each overridden target', () => {
    const summary = numbersSummary({ ...INPUT, targetOverrides: { protein: 180 } });
    expect(summary.targets.base.protein).toBe(180);
    expect(summary.auto.protein).toBe(128);
  });
});

describe('step previews', () => {
  it('estimates the daily burn for each activity level', () => {
    const previews = activityPreviews(INPUT);
    expect(previews.map((p) => p.level)).toEqual([
      'sedentary',
      'light',
      'moderate',
      'very',
      'extra',
    ]);
    expect(previews[0]).toMatchObject({
      title: 'Sedentary',
      detail: 'Desk job, little exercise',
      intensity: 1,
      burnKcal: 2136,
    });
    expect(previews[2]?.burnKcal).toBe(2759);
    expect(activityPreviews({ ...INPUT, age: null }).every((p) => p.burnKcal === null)).toBe(true);
  });

  it('ignores a known burn when comparing activity levels', () => {
    expect(activityPreviews({ ...INPUT, tdeeOverride: 2000 })[2]?.burnKcal).toBe(2759);
  });

  it('shows the calories each goal would give', () => {
    expect(goalPreviews(INPUT).map((p) => [p.goal, p.kcal])).toEqual([
      ['maintain', 2760],
      ['cut', 2210],
      ['bulk', 3030],
    ]);
    expect(goalPreviews({ ...INPUT, targetOverrides: { calories: 1900 } })[0]?.kcal).toBe(2760);
    expect(goalPreviews({ ...INPUT, sex: null }).every((p) => p.kcal === null)).toBe(true);
  });

  it('describes each goal in plain language', () => {
    expect(goalDetail('cut')).toBe(
      'About 20 % under your burn (at most 1,000 kcal). Protein 2.2 g/kg keeps your muscle.',
    );
    expect(goalDetail('bulk')).toContain('About 10 % over your burn (at most 500 kcal)');
    expect(goalDetail('maintain')).toContain('Protein 1.6 g/kg');
  });

  it('converts a daily calorie gap into weekly weight change', () => {
    expect(weeklyKgFromDailyKcal(550)).toBe(0.5);
    expect(weeklyKgFromDailyKcal(1100)).toBe(1);
  });
});
