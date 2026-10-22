import {
  BODY_RULES,
  FLUID_TARGET_RULE,
  INLINE_ERROR_PATHS,
  LOCATION_MESSAGE,
  apiMessages,
  locationError,
  mapProfileServerError,
  mapProfileServerErrors,
  rangeError,
  targetRule,
} from './profile-schema';

describe('rangeError', () => {
  it('accepts empty and in-range values', () => {
    expect(rangeError(null, BODY_RULES.weightKg)).toBeUndefined();
    expect(rangeError(72.5, BODY_RULES.weightKg)).toBeUndefined();
  });

  it('reports out-of-range values with the bounds', () => {
    expect(rangeError(5, BODY_RULES.weightKg)?.message).toBe(
      'Weight must be between 25 and 400 kg.',
    );
    expect(rangeError(50, targetRule('calories'))?.message).toBe(
      'Calories must be between 800 and 8,000 kcal.',
    );
  });

  it('uses the same body limits as the profile API', () => {
    expect(rangeError(25, BODY_RULES.weightKg)).toBeUndefined();
    expect(rangeError(250, BODY_RULES.heightCm)).toBeUndefined();
    expect(rangeError(100, BODY_RULES.age)).toBeUndefined();
    expect(rangeError(101, BODY_RULES.age)?.message).toBe('Age must be between 13 and 100 years.');
  });

  it('checks body fat and the daily burn against the shared bounds', () => {
    expect(rangeError(3, BODY_RULES.bodyFatPct)).toBeUndefined();
    expect(rangeError(71, BODY_RULES.bodyFatPct)?.message).toBe(
      'Body fat must be between 3 and 70 %.',
    );
    expect(rangeError(8000, BODY_RULES.tdeeOverride)).toBeUndefined();
    expect(rangeError(700, BODY_RULES.tdeeOverride)?.message).toBe(
      'Daily calorie burn must be between 800 and 8,000 kcal.',
    );
    expect(rangeError(2500.5, BODY_RULES.tdeeOverride)?.kind).toBe('integer');
  });

  it('requires whole numbers for age', () => {
    expect(rangeError(30.5, BODY_RULES.age)?.kind).toBe('integer');
    expect(rangeError(30, BODY_RULES.age)).toBeUndefined();
  });
});

describe('locationError', () => {
  it('measures the location the way the server stores it, trimmed', () => {
    expect(locationError(`  ${'a'.repeat(120)}  `)).toBeUndefined();
    expect(locationError('a'.repeat(121))?.message).toBe(LOCATION_MESSAGE);
  });
});

describe('server error mapping', () => {
  it('maps top-level fields with friendly labels', () => {
    expect(mapProfileServerError('weightKg must not be greater than 400')).toEqual({
      path: 'weightKg',
      message: 'Weight must not be greater than 400.',
    });
  });

  it('maps the new body fields inline', () => {
    expect(mapProfileServerError('bodyFatPct must not be greater than 70')).toEqual({
      path: 'bodyFatPct',
      message: 'Body fat must not be greater than 70.',
    });
    expect(mapProfileServerError('tdeeOverride must be an integer number').path).toBe(
      'tdeeOverride',
    );
    expect(INLINE_ERROR_PATHS.has('bodyFatPct')).toBe(true);
    expect(INLINE_ERROR_PATHS.has('tdeeOverride')).toBe(true);
  });

  it('maps daily fluids and the day start', () => {
    expect(mapProfileServerError('fluidTargetMl must not be greater than 8000')).toEqual({
      path: 'fluidTargetL',
      message: 'Daily fluids must be between 0.5 and 8 L.',
    });
    expect(mapProfileServerError('dayStartHour must not be greater than 6')).toEqual({
      path: 'dayStartHour',
      message: 'Day starts at must not be greater than 6.',
    });
    expect(INLINE_ERROR_PATHS.has('fluidTargetL')).toBe(true);
    expect(rangeError(0.4, FLUID_TARGET_RULE)?.message).toBe(
      'Daily fluids must be between 0.5 and 8 L.',
    );
    expect(rangeError(2.75, FLUID_TARGET_RULE)).toBeUndefined();
    expect(rangeError(null, FLUID_TARGET_RULE)).toBeUndefined();
  });

  it('maps nested target overrides', () => {
    expect(mapProfileServerError('targetOverrides.sodiumMax must not be less than 100')).toEqual({
      path: 'overrides.sodiumMax',
      message: 'Sodium limit must not be less than 100.',
    });
  });

  it('splits target override problems the server joins into one message', () => {
    expect(
      mapProfileServerErrors([
        'targetOverrides.calories must be a number between 800 and 8000, or null; targetOverrides.fat must be a number between 10 and 400, or null',
      ]),
    ).toEqual([
      {
        path: 'overrides.calories',
        message: 'Calories must be a number between 800 and 8000, or null.',
      },
      { path: 'overrides.fat', message: 'Fat must be a number between 10 and 400, or null.' },
    ]);
  });

  it('only shows inline errors for fields that render them', () => {
    expect(INLINE_ERROR_PATHS.has('aiModel')).toBe(true);
    expect(INLINE_ERROR_PATHS.has('overrides.sodiumMax')).toBe(true);
    expect(INLINE_ERROR_PATHS.has('activityLevel')).toBe(false);
    expect(INLINE_ERROR_PATHS.has('theme')).toBe(false);
  });

  it('keeps unknown messages as general errors', () => {
    expect(mapProfileServerErrors(['property foo should not exist', 'Bad things'])).toEqual([
      { path: null, message: 'Property foo should not exist.' },
      { path: null, message: 'Bad things.' },
    ]);
  });

  it('extracts messages from Nest error bodies', () => {
    expect(apiMessages({ statusCode: 400, message: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(apiMessages('{"message":"Nope"}')).toEqual(['Nope']);
    expect(apiMessages(null)).toEqual([]);
  });
});
