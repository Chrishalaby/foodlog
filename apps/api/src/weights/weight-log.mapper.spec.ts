import {
  profileBodySync,
  toWeightLogDto,
  toWeightPoint,
  weightLogValues,
} from './weight-log.mapper.js';

describe('weightLogValues', () => {
  it('rounds weight and body fat to 0.1', () => {
    expect(weightLogValues({ weightKg: 80.26, bodyFatPct: 18.44 })).toEqual({
      weightKg: 80.3,
      bodyFatPct: 18.4,
    });
    expect(weightLogValues({ weightKg: 79.95 })).toEqual({ weightKg: 80 });
  });

  it('leaves out a missing body fat so the stored value is kept', () => {
    expect(weightLogValues({ weightKg: 70 })).not.toHaveProperty('bodyFatPct');
  });

  it('keeps an explicit null body fat so the stored value is cleared', () => {
    expect(weightLogValues({ weightKg: 70, bodyFatPct: null })).toEqual({
      weightKg: 70,
      bodyFatPct: null,
    });
  });
});

describe('toWeightLogDto', () => {
  it('keeps only the public fields', () => {
    const row = {
      date: '2026-09-28',
      weightKg: 80.2,
      bodyFatPct: null,
      userId: 'someone',
    };
    expect(toWeightLogDto(row)).toEqual({
      date: '2026-09-28',
      weightKg: 80.2,
      bodyFatPct: null,
    });
    expect(toWeightPoint(row)).toEqual({ date: '2026-09-28', weightKg: 80.2 });
  });
});

describe('profileBodySync', () => {
  it('syncs body fat only when the weigh-in has one', () => {
    expect(profileBodySync({ weightKg: 80.2, bodyFatPct: null })).toEqual({
      weightKg: 80.2,
    });
    expect(profileBodySync({ weightKg: 80.2 })).toEqual({ weightKg: 80.2 });
    expect(profileBodySync({ weightKg: 80.2, bodyFatPct: 17.5 })).toEqual({
      weightKg: 80.2,
      bodyFatPct: 17.5,
    });
  });
});
