import { microTargets } from '@food/shared';
import {
  MICROS_NO_DATA,
  formatMicroAmount,
  microGroups,
  microRow,
  microTargetsFor,
  microsCoverageText,
  microsSummary,
} from './micros-model';

const OWNER = microTargets('male', 34);

function row(micros: Parameters<typeof microGroups>[0], key: string) {
  const found = microGroups(micros, OWNER)
    .flatMap((group) => group.rows)
    .find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(`no row ${key}`);
  }
  return found;
}

describe('micros model', () => {
  it('groups every nutrient into vitamins, minerals and other in a fixed order', () => {
    const groups = microGroups({}, OWNER);
    expect(groups.map((group) => group.title)).toEqual(['Vitamins', 'Minerals', 'Other']);
    expect(groups[0].rows.map((r) => r.label)).toEqual([
      'Vitamin A',
      'Vitamin C',
      'Vitamin D',
      'Vitamin E',
      'Vitamin K',
      'Vitamin B6',
      'Vitamin B12',
      'Folate',
    ]);
    expect(groups[1].rows.map((r) => r.key)).toEqual([
      'calcium',
      'iron',
      'magnesium',
      'potassium',
      'zinc',
    ]);
    expect(groups[2].rows.map((r) => r.key)).toEqual(['cholesterol', 'caffeine']);
  });

  it('shows unknown nutrients as a dash and a known zero as 0', () => {
    const unknown = row({ vitaminC: 0 }, 'vitaminK');
    expect(unknown).toMatchObject({
      known: false,
      amountText: '—',
      percent: null,
      percentText: '',
      fill: 0,
      tone: 'unknown',
      srText: 'Vitamin K: no estimate.',
    });
    const zero = row({ vitaminC: 0 }, 'vitaminC');
    expect(zero).toMatchObject({
      known: true,
      amountText: '0 mg',
      percent: 0,
      percentText: '0%',
      fill: 0,
      tone: 'progress',
    });
  });

  it('flags a 125 µg vitamin D day above the usual upper limit', () => {
    const vitaminD = row({ vitaminD: 125 }, 'vitaminD');
    expect(vitaminD).toMatchObject({
      amountText: '125 µg',
      targetText: '15 µg',
      percent: 833,
      percentText: '833%',
      fill: 100,
      tone: 'warn',
      note: 'Above the usual upper limit (100 µg/day)',
    });
    expect(vitaminD.srText).toBe(
      'Vitamin D: 125 µg, 833% of the 15 µg daily target. Above the usual upper limit (100 µg/day).',
    );
    expect(row({ vitaminD: 100 }, 'vitaminD')).toMatchObject({ tone: 'met', note: null });
  });

  it('shows progress below the target and met at or above it', () => {
    expect(row({ vitaminC: 45 }, 'vitaminC')).toMatchObject({
      tone: 'progress',
      percent: 50,
      fill: 50,
    });
    expect(row({ vitaminC: 90 }, 'vitaminC')).toMatchObject({ tone: 'met', percent: 100 });
    expect(row({ potassium: 5000 }, 'potassium')).toMatchObject({ tone: 'met', note: null });
  });

  it('styles cholesterol and caffeine as limits that turn amber when exceeded', () => {
    const caffeine = row({ caffeine: 250 }, 'caffeine');
    expect(caffeine).toMatchObject({
      limit: true,
      tone: 'limit',
      targetText: '400 mg',
      percent: 63,
      fill: 63,
      note: null,
    });
    expect(caffeine.srText).toBe('Caffeine: 250 mg, 63% of the 400 mg daily limit.');
    expect(row({ caffeine: 400 }, 'caffeine')).toMatchObject({ tone: 'limit', note: null });
    expect(row({ caffeine: 480 }, 'caffeine')).toMatchObject({
      tone: 'warn',
      fill: 100,
      note: 'Over the 400 mg/day limit',
    });
    expect(row({ cholesterol: 320 }, 'cholesterol')).toMatchObject({
      limit: true,
      tone: 'warn',
      note: 'Over the 300 mg/day limit',
    });
  });

  it('uses the stricter caffeine limit for teenagers', () => {
    const teen = microRow('caffeine', 150, microTargets('female', 16).caffeine);
    expect(teen).toMatchObject({ tone: 'warn', note: 'Over the 100 mg/day limit' });
  });

  it('formats amounts with each nutrient’s precision and tiny amounts as less than', () => {
    expect(formatMicroAmount('vitaminA', 1234.4)).toBe('1,234 µg');
    expect(formatMicroAmount('vitaminB12', 0.004)).toBe('<0.01 µg');
    expect(formatMicroAmount('iron', 2.04)).toBe('2 mg');
    expect(formatMicroAmount('iron', 2.25)).toBe('2.3 mg');
    expect(formatMicroAmount('caffeine', 0)).toBe('0 mg');
  });

  it('targets the profile’s sex and age, or the mean of both for an unknown profile', () => {
    expect(microTargetsFor({ sex: 'female', age: 28 }).iron.amount).toBe(18);
    expect(microTargetsFor({ sex: 'male', age: 28 }).iron.amount).toBe(8);
    expect(microTargetsFor(null).iron.amount).toBe(13);
  });

  it('describes coverage for a day, a week and a meal', () => {
    expect(microsCoverageText({ items: 9, withMicros: 7 }, 'day')).toBe(
      'Estimated for 7 of 9 foods; older logs have no vitamin data',
    );
    expect(microsCoverageText({ items: 40, withMicros: 12 }, 'week')).toBe(
      'Estimated for 12 of 40 foods; older logs have no vitamin data',
    );
    expect(microsCoverageText({ items: 3, withMicros: 2 }, 'meal')).toBe(
      'Estimated for 2 of 3 foods',
    );
    expect(microsCoverageText({ items: 9, withMicros: 9 }, 'day')).toBe(
      'Estimated for all 9 foods',
    );
    expect(microsCoverageText({ items: 1, withMicros: 1 }, 'meal')).toBe('Estimated for 1 food');
    expect(microsCoverageText({ items: 5, withMicros: 0 }, 'day')).toBe(
      'No estimates for these 5 foods; older logs have no vitamin data',
    );
    expect(microsCoverageText({ items: 0, withMicros: 0 }, 'day')).toBeNull();
    expect(microsCoverageText(null, 'day')).toBeNull();
  });

  it('summarises the collapsed row with warnings first, then coverage', () => {
    const coverage = { items: 9, withMicros: 7 };
    expect(microsSummary(microGroups({ vitaminD: 125, iron: 9 }, OWNER), coverage)).toEqual({
      text: 'Vitamin D above the usual limit',
      warn: true,
    });
    expect(microsSummary(microGroups({ caffeine: 500 }, OWNER), coverage)).toEqual({
      text: 'Caffeine over the limit',
      warn: true,
    });
    expect(microsSummary(microGroups({ vitaminD: 125, caffeine: 500 }, OWNER), coverage)).toEqual({
      text: '2 above usual limits',
      warn: true,
    });
    expect(microsSummary(microGroups({ iron: 9 }, OWNER), coverage)).toEqual({
      text: 'Estimated for 7 of 9 foods',
      warn: false,
    });
    expect(microsSummary(microGroups({}, OWNER), { items: 4, withMicros: 0 })).toEqual({
      text: MICROS_NO_DATA,
      warn: false,
    });
  });
});
