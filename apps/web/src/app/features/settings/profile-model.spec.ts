import { type ProfileDto, computeTargets } from '@food/shared';
import {
  DEFAULT_PROFILE,
  autoTargetValues,
  burnExplanation,
  changedProfileFields,
  formulaTdee,
  emptyOverrideDraft,
  fluidLitresFromMl,
  fluidMlFromLitres,
  labelParts,
  missingProfileFields,
  overrideDraftFrom,
  overridesFromDraft,
  previewColumns,
  previewInput,
  rebaseProfile,
  sameProfile,
  toFormModel,
  toProfileDto,
  trainingDaysExplanation,
} from './profile-model';

const PROFILE: ProfileDto = {
  ...DEFAULT_PROFILE,
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 0,
  targetOverrides: { sodiumMax: 2000 },
  location: 'Beirut, Lebanon',
  aiModel: 'gpt-6-sol',
};

describe('profile form mapping', () => {
  it('round-trips a profile through the form model', () => {
    const model = toFormModel(PROFILE);
    expect(model.sex).toBe('male');
    expect(model.overrides.sodiumMax).toBe(2000);
    expect(model.overrides.calories).toBeNull();
    expect(toProfileDto(model)).toEqual(PROFILE);
  });

  it('maps empty form values back to nulls and trims the location', () => {
    const model = {
      ...toFormModel(DEFAULT_PROFILE),
      location: '   ',
      aiModel: '',
      sex: '' as const,
    };
    const dto = toProfileDto(model);
    expect(dto.location).toBeNull();
    expect(dto.aiModel).toBeNull();
    expect(dto.sex).toBeNull();
    expect(toProfileDto({ ...model, location: '  Paris  ' }).location).toBe('Paris');
  });

  it('maps body fat and the daily burn both ways', () => {
    const profile: ProfileDto = { ...PROFILE, bodyFatPct: 18.5, tdeeOverride: 2600 };
    const model = toFormModel(profile);
    expect(model.bodyFatPct).toBe(18.5);
    expect(model.tdeeOverride).toBe(2600);
    expect(toProfileDto(model)).toEqual(profile);
    const legacy = { ...PROFILE } as Partial<ProfileDto>;
    delete legacy.bodyFatPct;
    delete legacy.tdeeOverride;
    expect(toFormModel(legacy as ProfileDto).bodyFatPct).toBeNull();
  });

  it('never sends the onboarding flag from settings', () => {
    expect('onboarded' in toProfileDto(toFormModel({ ...PROFILE, onboarded: true }))).toBe(false);
  });

  it('ignores non-numeric overrides coming from the server', () => {
    const draft = overrideDraftFrom({ calories: Number.NaN, protein: 150 });
    expect(draft.calories).toBeNull();
    expect(draft.protein).toBe(150);
  });
});

describe('override diffing', () => {
  it('only sends overrides that are set', () => {
    const draft = { ...emptyOverrideDraft(), calories: 2500, fiberMin: 30 };
    expect(overridesFromDraft(draft)).toEqual({ calories: 2500, fiberMin: 30 });
  });

  it('can drop out-of-bounds overrides for the live preview', () => {
    const draft = { ...emptyOverrideDraft(), calories: 50, protein: 150 };
    expect(overridesFromDraft(draft, true)).toEqual({ protein: 150 });
  });

  it('lists exactly the changed profile fields', () => {
    const changed: ProfileDto = {
      ...PROFILE,
      weightKg: 81,
      targetOverrides: { sodiumMax: 2000, calories: 2500 },
      theme: 'light',
    };
    expect(changedProfileFields(PROFILE, changed)).toEqual([
      'weightKg',
      'targetOverrides',
      'theme',
    ]);
  });

  it('ignores the onboarding flag and missing new fields when diffing', () => {
    const server: ProfileDto = { ...PROFILE, onboarded: true };
    const legacy = { ...PROFILE } as Partial<ProfileDto>;
    delete legacy.bodyFatPct;
    expect(changedProfileFields(server, toProfileDto(toFormModel(server)))).toEqual([]);
    expect(sameProfile(legacy as ProfileDto, PROFILE)).toBe(true);
    expect(changedProfileFields(PROFILE, { ...PROFILE, bodyFatPct: 20 })).toEqual(['bodyFatPct']);
  });

  it('maps the day start and daily fluids both ways', () => {
    const model = toFormModel({ ...PROFILE, dayStartHour: 5, fluidTargetMl: 3250 });
    expect(model.dayStartHour).toBe(5);
    expect(model.fluidTargetL).toBe(3.25);
    expect(toProfileDto(model)).toEqual({ ...PROFILE, dayStartHour: 5, fluidTargetMl: 3250 });
    expect(toProfileDto({ ...model, fluidTargetL: null }).fluidTargetMl).toBeNull();

    const legacy = { ...PROFILE } as Partial<ProfileDto>;
    delete legacy.dayStartHour;
    delete legacy.fluidTargetMl;
    expect(toFormModel(legacy as ProfileDto)).toMatchObject({
      dayStartHour: 3,
      fluidTargetL: null,
    });
  });

  it('converts daily fluids between millilitres and litres', () => {
    expect(fluidLitresFromMl(2800)).toBe(2.8);
    expect(fluidLitresFromMl(null)).toBeNull();
    expect(fluidLitresFromMl(undefined)).toBeNull();
    expect(fluidLitresFromMl(0)).toBeNull();
    expect(fluidMlFromLitres(3.456)).toBe(3456);
    expect(fluidMlFromLitres(null)).toBeNull();
  });

  it('tracks the day start and daily fluids as changes but not a missing day start', () => {
    expect(changedProfileFields(PROFILE, { ...PROFILE, dayStartHour: 0 })).toEqual([
      'dayStartHour',
    ]);
    expect(changedProfileFields(PROFILE, { ...PROFILE, fluidTargetMl: 3000 })).toEqual([
      'fluidTargetMl',
    ]);
    const legacy = { ...PROFILE } as Partial<ProfileDto>;
    delete legacy.dayStartHour;
    delete legacy.fluidTargetMl;
    expect(sameProfile(legacy as ProfileDto, PROFILE)).toBe(true);
    expect(changedProfileFields(legacy as ProfileDto, { ...PROFILE, dayStartHour: 4 })).toEqual([
      'dayStartHour',
    ]);
  });

  it('rebases unsaved edits on a profile that changed elsewhere', () => {
    const draft: ProfileDto = { ...PROFILE, heightCm: 181, goal: 'cut' };
    const server: ProfileDto = { ...PROFILE, weightKg: 78.5, goal: 'bulk' };
    expect(rebaseProfile(PROFILE, draft, server)).toEqual({
      ...PROFILE,
      weightKg: 78.5,
      heightCm: 181,
      goal: 'cut',
    });
    expect(rebaseProfile(PROFILE, PROFILE, server)).toEqual(server);
  });

  it('treats overrides with the same values as equal regardless of key order', () => {
    const a: ProfileDto = { ...PROFILE, targetOverrides: { calories: 2500, protein: 150 } };
    const b: ProfileDto = { ...PROFILE, targetOverrides: { protein: 150, calories: 2500 } };
    expect(sameProfile(a, b)).toBe(true);
    expect(sameProfile(a, { ...b, targetOverrides: { protein: 150 } })).toBe(false);
  });
});

describe('target preview', () => {
  it('ignores out-of-range body metrics while typing', () => {
    const input = previewInput({ ...toFormModel(PROFILE), weightKg: 7 });
    expect(input.weightKg).toBeNull();
    expect(computeTargets(input).complete).toBe(false);
  });

  it('ignores out-of-range body fat and daily burn while typing', () => {
    const input = previewInput({ ...toFormModel(PROFILE), bodyFatPct: 90, tdeeOverride: 300 });
    expect(input.bodyFatPct).toBeNull();
    expect(input.tdeeOverride).toBeNull();
    const valid = previewInput({ ...toFormModel(PROFILE), bodyFatPct: 15, tdeeOverride: 2500 });
    expect(valid.bodyFatPct).toBe(15);
    expect(valid.tdeeOverride).toBe(2500);
  });

  it('names the metrics still needed for personal targets', () => {
    expect(missingProfileFields(previewInput(toFormModel(PROFILE)))).toEqual([]);
    expect(missingProfileFields(previewInput(toFormModel(DEFAULT_PROFILE)))).toEqual([
      'weight',
      'height',
      'age',
      'sex',
    ]);
    expect(
      missingProfileFields(previewInput({ ...toFormModel(PROFILE), age: 5, sex: '' })),
    ).toEqual(['age', 'sex']);
  });

  it('matches computeTargets for a complete profile', () => {
    const result = computeTargets(previewInput(toFormModel(PROFILE)));
    expect(result.bmr).toBe(1780);
    expect(result.tdee).toBe(2759);
    expect(result.base.calories).toBe(2760);
    expect(result.base.sodiumMax).toBe(2000);
  });

  it('shows the value each override would fall back to', () => {
    const model = {
      ...toFormModel(PROFILE),
      overrides: { ...emptyOverrideDraft(), calories: 2500, protein: 150 },
    };
    const auto = autoTargetValues(previewInput(model));
    expect(auto.calories).toBe(2760);
    expect(auto.protein).toBe(128);
    expect(auto.fat).toBe(83);
    expect(auto.carbs).toBe(Math.round((2500 - 4 * 150 - 9 * 83) / 4));
  });

  it('uses the effective value as auto when nothing is overridden', () => {
    const input = previewInput(toFormModel({ ...PROFILE, targetOverrides: {} }));
    expect(autoTargetValues(input)).toEqual(computeTargets(input).base);
  });

  it('builds preview columns for each training schedule', () => {
    const at = (days: number) => {
      const input = previewInput(toFormModel({ ...PROFILE, trainingDaysPerWeek: days }));
      return previewColumns(computeTargets(input), days).map((column) => column.label);
    };
    expect(at(0)).toEqual(['Normal day', 'Training day']);
    expect(at(3)).toEqual(['Average', 'Training', 'Rest']);
    expect(at(7)).toEqual(['Every day']);
  });

  it('explains the training day rules', () => {
    expect(trainingDaysExplanation(0, 280, 0)).toContain('+280 kcal (10 %) as carbs');
    expect(trainingDaysExplanation(3, 280, -210)).toBe(
      'Weekly calorie cycling: 3 training days get +280 kcal as carbs, 4 rest days get −210 kcal. Your weekly total stays the same.',
    );
    expect(trainingDaysExplanation(1, 280, -50)).toContain('1 training day gets');
    expect(trainingDaysExplanation(6, 0, 0)).toContain('safe minimum');
    expect(trainingDaysExplanation(7, 0, 0)).toContain('every day');
  });
});

describe('daily calorie burn', () => {
  const input = previewInput(toFormModel(PROFILE));

  it('keeps the formula estimate next to a known burn', () => {
    expect(formulaTdee(input)).toBe(2759);
    expect(formulaTdee({ ...input, tdeeOverride: 2400 })).toBe(2759);
    expect(formulaTdee({ ...input, weightKg: null })).toBeNull();
  });

  it('explains where the burn comes from', () => {
    expect(burnExplanation(computeTargets(input), input)).toBe(
      'Resting burn 1,780 kcal (Mifflin-St Jeor) × 1.55 for your activity level.',
    );
    const katch = { ...input, bodyFatPct: 15 };
    expect(burnExplanation(computeTargets(katch), katch)).toContain('(Katch-McArdle)');
    const known = { ...input, tdeeOverride: 2400 };
    expect(burnExplanation(computeTargets(known), known)).toBe(
      'Using your own value. The formula estimate is 2,759 kcal.',
    );
    const empty = previewInput(toFormModel(DEFAULT_PROFILE));
    expect(burnExplanation(computeTargets(empty), empty)).toContain('Add your details');
  });
});

describe('labelParts', () => {
  it('splits descriptive labels', () => {
    expect(labelParts('Cut (lose fat)')).toEqual({ title: 'Cut', detail: 'lose fat' });
    expect(labelParts('Maintain')).toEqual({ title: 'Maintain', detail: '' });
  });
});
