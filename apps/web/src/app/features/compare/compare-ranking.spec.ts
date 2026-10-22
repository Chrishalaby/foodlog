import { zeroNutrients, type Nutrients, type TargetValues } from '@food/shared';
import {
  BEST_FIT_LABEL,
  BEST_OF_LABEL,
  budgetFromDay,
  calorieFit,
  calorieReason,
  calorieScore,
  calorieTolerance,
  comparisonRows,
  fiberReason,
  laterPhrase,
  limitScore,
  mealShare,
  optionReasons,
  proteinPace,
  proteinReason,
  proteinScore,
  rankOptions,
  remainingBudget,
  roomFactor,
  type DayBudget,
  type RankContext,
  type RankInput,
} from './compare-ranking';

const TARGETS: TargetValues = {
  calories: 2500,
  protein: 150,
  carbs: 280,
  fat: 80,
  satFatMax: 25,
  fiberMin: 35,
  sugarMax: 60,
  sodiumMax: 2300,
};

const LUNCH_EATEN: Partial<Nutrients> = {
  calories: 1500,
  protein: 90,
  fiber: 15,
  satFat: 12,
  sodium: 1500,
  sugar: 30,
};

function n(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function budget(eaten: Partial<Nutrients> = {}, fullDay = false): DayBudget {
  return { targets: TARGETS, eaten: n(eaten), fullDay };
}

function ctx(eaten: Partial<Nutrients> = LUNCH_EATEN, hour = 13, fullDay = false): RankContext {
  return { budget: budget(eaten, fullDay), hour };
}

function option(id: string, values: Partial<Nutrients>): RankInput {
  return { id, nutrients: n(values) };
}

const BOWL = option('bowl', {
  calories: 650,
  protein: 42,
  carbs: 70,
  fat: 18,
  fiber: 6,
  satFat: 3,
  sodium: 700,
  sugar: 5,
});

const BURGER = option('burger', {
  calories: 1100,
  protein: 45,
  carbs: 90,
  fat: 60,
  fiber: 3,
  satFat: 18,
  sodium: 1600,
  sugar: 12,
});

describe('remainingBudget', () => {
  it('subtracts what was eaten from the day targets', () => {
    expect(remainingBudget(budget(LUNCH_EATEN))).toEqual({
      calories: 1000,
      protein: 60,
      fiber: 20,
      satFat: 13,
      sodium: 800,
      sugar: 30,
    });
  });

  it('never asks for negative protein or fiber but lets limits go negative', () => {
    const left = remainingBudget(
      budget({ calories: 2700, protein: 170, fiber: 40, satFat: 30, sodium: 2600, sugar: 70 }),
    );
    expect(left).toEqual({
      calories: -200,
      protein: 0,
      fiber: 0,
      satFat: -5,
      sodium: -300,
      sugar: -10,
    });
  });

  it('uses the full day targets when nothing has been logged', () => {
    expect(remainingBudget(budget(LUNCH_EATEN, true))).toEqual({
      calories: 2500,
      protein: 150,
      fiber: 35,
      satFat: 25,
      sodium: 2300,
      sugar: 60,
    });
  });

  it('builds the budget from a day summary and flags empty days', () => {
    const day = { targets: TARGETS, totals: n({ calories: 300 }), entryCount: 0 };
    expect(budgetFromDay(day).fullDay).toBe(true);
    expect(budgetFromDay({ ...day, entryCount: 2 })).toEqual({
      targets: TARGETS,
      eaten: n({ calories: 300 }),
      fullDay: false,
    });
  });
});

describe('calorie helpers', () => {
  it('uses 5% of the calorie target as tolerance, at least 50 kcal', () => {
    expect(calorieTolerance(2500)).toBe(125);
    expect(calorieTolerance(1800)).toBe(90);
    expect(calorieTolerance(800)).toBe(50);
    expect(calorieTolerance(Number.NaN)).toBe(50);
  });

  it('keeps more room for later meals early in the day', () => {
    expect(mealShare(8)).toBe(0.45);
    expect(mealShare(13)).toBe(0.65);
    expect(mealShare(16)).toBe(0.8);
    expect(mealShare(20)).toBe(1);
    expect(laterPhrase(9)).toBe('for the rest of the day');
    expect(laterPhrase(13)).toBe('for dinner');
    expect(laterPhrase(21)).toBe('to spare');
  });

  it('classifies fits, close and over with the tolerance', () => {
    expect(calorieFit(900, 1000, 125)).toBe('fits');
    expect(calorieFit(1000.4, 1000, 125)).toBe('fits');
    expect(calorieFit(1100, 1000, 125)).toBe('close');
    expect(calorieFit(1125, 1000, 125)).toBe('close');
    expect(calorieFit(1126, 1000, 125)).toBe('over');
  });

  it('scores a fitting option fully in the evening and less the further it goes over', () => {
    const fits = calorieScore(900, 1000, 2500, 20);
    const close = calorieScore(1100, 1000, 2500, 20);
    const over = calorieScore(1500, 1000, 2500, 20);
    const wayOver = calorieScore(3000, 1000, 2500, 20);
    expect(fits).toBe(1);
    expect(close).toBeCloseTo(0.88, 5);
    expect(over).toBeLessThan(close);
    expect(over).toBeGreaterThan(0);
    expect(wayOver).toBe(0);
  });

  it('is continuous at the edge of the tolerance', () => {
    const inside = calorieScore(1125, 1000, 2500, 20);
    const outside = calorieScore(1126, 1000, 2500, 20);
    expect(inside - outside).toBeLessThan(0.01);
  });

  it('penalises using most of the remaining calories at lunch but not at dinner', () => {
    expect(roomFactor(600, 1000, 13)).toBe(1);
    expect(roomFactor(1000, 1000, 13)).toBeCloseTo(0.7, 5);
    expect(roomFactor(1000, 1000, 20)).toBe(1);
    expect(roomFactor(500, -100, 13)).toBe(1);
    expect(calorieScore(1000, 1000, 2500, 13)).toBeLessThan(calorieScore(600, 1000, 2500, 13));
  });
});

describe('protein, fiber and limit scores', () => {
  it('treats protein as neutral once the target is hit', () => {
    expect(proteinScore(0, 500, 0, 1000)).toBe(1);
    expect(proteinScore(50, 500, 0.5, 1000)).toBe(1);
  });

  it('rewards coverage of the protein still needed and protein per calorie', () => {
    const dense = proteinScore(40, 400, 60, 1200);
    const heavy = proteinScore(40, 1000, 60, 1200);
    expect(dense).toBeGreaterThan(heavy);
    expect(proteinScore(60, 600, 60, 1200)).toBe(1);
    expect(proteinScore(0, 300, 60, 1200)).toBe(0);
  });

  it('measures protein pace against the calories an option uses', () => {
    expect(proteinPace(30, 400, 150, 2500)).toBe(1);
    expect(proteinPace(8, 450, 150, 2500)).toBeCloseTo(0.296, 3);
    expect(proteinPace(10, 0, 150, 2500)).toBe(1);
    expect(proteinPace(0, 0, 150, 2500)).toBe(0);
    expect(proteinPace(30, 400, 0, 2500)).toBeNull();
    expect(proteinPace(30, 400, 150, 0)).toBeNull();
    expect(proteinPace(30, 400, 150, Number.NaN)).toBeNull();
  });

  it('uses coverage alone when there are no calories left', () => {
    expect(proteinScore(30, 500, 60, -100)).toBe(0.5);
  });

  it('scores limits by the room left and punishes going over', () => {
    expect(limitScore(0, 800, 2300)).toBe(1);
    expect(limitScore(400, 800, 2300)).toBeCloseTo(0.9, 5);
    expect(limitScore(800, 800, 2300)).toBeCloseTo(0.8, 5);
    expect(limitScore(900, 800, 2300)).toBeLessThan(0.8);
    expect(limitScore(5000, 800, 2300)).toBe(0);
    expect(limitScore(100, -200, 2300)).toBeLessThan(0.8);
    expect(limitScore(10, 5, 0)).toBe(1);
  });
});

describe('rankOptions', () => {
  it('picks the option that fits the calories and still brings protein', () => {
    const ranking = rankOptions([BURGER, BOWL], ctx());
    expect(ranking.winnerId).toBe('bowl');
    expect(ranking.winnerLabel).toBe(BEST_FIT_LABEL);
    const [burger, bowl] = ranking.options;
    expect(bowl.best).toBe(true);
    expect(bowl.rank).toBe(1);
    expect(burger.rank).toBe(2);
    expect(bowl.score).toBeGreaterThan(burger.score);
    expect(bowl.fit).toBe('fits');
    expect(burger.fit).toBe('close');
  });

  it('keeps the input order in the result', () => {
    const ranking = rankOptions([BURGER, BOWL], ctx());
    expect(ranking.options.map((ranked) => ranked.id)).toEqual(['burger', 'bowl']);
  });

  it('prefers a lighter option at breakfast but the one that completes the day at dinner', () => {
    const eaten = { calories: 1300, protein: 90 };
    const big = option('big', { calories: 1000, protein: 50 });
    const light = option('light', { calories: 400, protein: 40 });
    expect(rankOptions([big, light], ctx(eaten, 8)).winnerId).toBe('light');
    expect(rankOptions([big, light], ctx(eaten, 19)).winnerId).toBe('big');
  });

  it('lets calories outweigh a little more protein', () => {
    const eaten = { calories: 2000, protein: 100 };
    const fits = option('fits', { calories: 450, protein: 30 });
    const over = option('over', { calories: 1100, protein: 40 });
    expect(rankOptions([over, fits], ctx(eaten, 19)).winnerId).toBe('fits');
  });

  it('breaks a tie on calories and protein with the sodium limit', () => {
    const salty = option('salty', { calories: 500, protein: 30, sodium: 1400 });
    const plain = option('plain', { calories: 500, protein: 30, sodium: 300 });
    const ranking = rankOptions([salty, plain], ctx());
    expect(ranking.winnerId).toBe('plain');
    expect(ranking.options[0].reasons.map((reason) => reason.text)).toContain(
      'Over your sodium limit by 600 mg',
    );
  });

  it('breaks a tie on saturated fat and sugar too', () => {
    const rich = option('rich', { calories: 500, protein: 30, satFat: 14 });
    const lean = option('lean', { calories: 500, protein: 30, satFat: 2 });
    expect(rankOptions([rich, lean], ctx()).winnerId).toBe('lean');
    const sweet = option('sweet', { calories: 500, protein: 30, sugar: 40 });
    const savory = option('savory', { calories: 500, protein: 30, sugar: 2 });
    expect(rankOptions([sweet, savory], ctx()).winnerId).toBe('savory');
  });

  it('prefers more fiber when everything else is equal', () => {
    const fibrous = option('fibrous', { calories: 500, protein: 30, fiber: 12 });
    const refined = option('refined', { calories: 500, protein: 30, fiber: 1 });
    expect(rankOptions([refined, fibrous], ctx()).winnerId).toBe('fibrous');
  });

  it('calls the winner "best of these" when every option goes over', () => {
    const eaten = { calories: 2300, protein: 100 };
    const smaller = option('smaller', { calories: 800, protein: 30 });
    const bigger = option('bigger', { calories: 900, protein: 30 });
    const ranking = rankOptions([bigger, smaller], ctx(eaten, 19));
    expect(ranking.winnerId).toBe('smaller');
    expect(ranking.winnerLabel).toBe(BEST_OF_LABEL);
    expect(ranking.options.every((ranked) => ranked.fit === 'over')).toBe(true);
  });

  it('names no winner for a single option but still explains it', () => {
    const ranking = rankOptions([BOWL], ctx());
    expect(ranking.winnerId).toBeNull();
    expect(ranking.winnerLabel).toBeNull();
    expect(ranking.options[0].best).toBe(false);
    expect(ranking.options[0].rank).toBe(1);
    expect(ranking.options[0].reasons.length).toBeGreaterThan(0);
  });

  it('keeps the first of two identical options on top', () => {
    const a = option('a', { calories: 500, protein: 30 });
    const b = option('b', { calories: 500, protein: 30 });
    expect(rankOptions([a, b], ctx()).winnerId).toBe('a');
    expect(rankOptions([b, a], ctx()).winnerId).toBe('b');
  });

  it('prefers more protein when the scores tie', () => {
    const eaten = { calories: 1000, protein: 200 };
    const lean = option('lean', { calories: 500, protein: 40 });
    const light = option('light', { calories: 500, protein: 10 });
    expect(rankOptions([light, lean], ctx(eaten, 19)).winnerId).toBe('lean');
  });

  it('prefers fewer calories when scores and protein tie', () => {
    const eaten = { calories: 500, protein: 200, fiber: 40 };
    const smaller = option('smaller', { calories: 300 });
    const larger = option('larger', { calories: 400 });
    expect(rankOptions([larger, smaller], ctx(eaten, 21)).winnerId).toBe('smaller');
  });

  it('ranks against the full day when nothing is logged', () => {
    const ranking = rankOptions(
      [option('toast', { calories: 500, protein: 20 })],
      ctx(LUNCH_EATEN, 9, true),
    );
    expect(ranking.remaining.calories).toBe(2500);
    expect(ranking.options[0].reasons[0].text).toBe('Leaves 2,000 kcal for the rest of the day');
  });

  it('reports the remaining budget and tolerance it used', () => {
    const ranking = rankOptions([BOWL, BURGER], ctx());
    expect(ranking.remaining.calories).toBe(1000);
    expect(ranking.tolerance).toBe(125);
  });

  it('returns scores between 0 and 100', () => {
    const ranking = rankOptions(
      [BOWL, BURGER, option('water', {}), option('feast', { calories: 5000, sodium: 9000 })],
      ctx(),
    );
    for (const ranked of ranking.options) {
      expect(ranked.score).toBeGreaterThanOrEqual(0);
      expect(ranked.score).toBeLessThanOrEqual(100);
    }
  });
});

describe('reasons', () => {
  it('explains the fitting lunch bowl in plain English', () => {
    expect(optionReasons(BOWL.nutrients, ctx())).toEqual([
      { tone: 'good', text: 'Leaves 350 kcal for dinner' },
      { tone: 'good', text: 'Adds 42 g protein — 70% of what you still need' },
      { tone: 'good', text: 'Adds 6 g fiber' },
    ]);
  });

  it('puts the worst limit before the good news and keeps three reasons', () => {
    expect(optionReasons(BURGER.nutrients, ctx())).toEqual([
      { tone: 'warn', text: 'Just 100 kcal over your target' },
      { tone: 'good', text: 'Adds 45 g protein — 75% of what you still need' },
      { tone: 'bad', text: 'Over your sodium limit by 800 mg' },
    ]);
  });

  it('describes going well over the calorie target', () => {
    expect(calorieReason(1420, 1000, 125, 13)).toEqual({
      tone: 'bad',
      text: 'Goes 420 kcal over your target',
    });
  });

  it('describes a day that is already over', () => {
    expect(calorieReason(450, -200, 125, 20)).toEqual({
      tone: 'bad',
      text: 'Already 200 kcal over today, adds 450',
    });
    expect(calorieReason(80, 0, 125, 20)).toEqual({
      tone: 'warn',
      text: 'No calories left today, adds 80 kcal',
    });
  });

  it('warns when a lunch option leaves little for dinner', () => {
    expect(calorieReason(900, 1000, 125, 13)).toEqual({
      tone: 'warn',
      text: 'Leaves only 100 kcal for dinner',
    });
  });

  it('praises using up the last calories in the evening', () => {
    expect(calorieReason(980, 1000, 125, 20)).toEqual({
      tone: 'good',
      text: 'Uses up the rest of your calories',
    });
    expect(calorieReason(0.2, 1000, 125, 20).text).toBe('Adds almost no calories');
  });

  it('covers, adds or lacks protein', () => {
    expect(proteinReason(35, 30)).toEqual({
      tone: 'good',
      text: 'Covers the 30 g protein you still need',
    });
    expect(proteinReason(18, 60)).toEqual({
      tone: 'neutral',
      text: 'Adds 18 g protein — 30% of what you still need',
    });
    expect(proteinReason(5, 60)).toEqual({
      tone: 'warn',
      text: 'Only 5 g protein of the 60 g you still need',
    });
    expect(proteinReason(2, 10)).toEqual({ tone: 'neutral', text: 'Adds 2 g protein' });
    expect(proteinReason(0.4, 60)).toEqual({ tone: 'warn', text: 'Almost no protein' });
    expect(proteinReason(0.4, 10)).toBeNull();
    expect(proteinReason(40, 0)).toBeNull();
  });

  it('judges protein against the share of calories an option uses', () => {
    expect(proteinReason(30, 150, 400, 2500)).toEqual({
      tone: 'good',
      text: 'Adds 30 g protein',
    });
    expect(proteinReason(8, 150, 450, 2500)).toEqual({
      tone: 'warn',
      text: 'Only 8 g protein of the 150 g you still need',
    });
    expect(proteinReason(45, 150, 600, 2500)).toEqual({
      tone: 'good',
      text: 'Adds 45 g protein — 30% of what you still need',
    });
    expect(proteinReason(45, 150, 1200, 2500)).toEqual({
      tone: 'neutral',
      text: 'Adds 45 g protein — 30% of what you still need',
    });
    expect(proteinReason(45, 150, 1800, 2500)).toEqual({
      tone: 'warn',
      text: 'Only 45 g protein of the 150 g you still need',
    });
    expect(proteinReason(20, 150, 1500, 2500)).toEqual({
      tone: 'warn',
      text: 'Only 20 g protein of the 150 g you still need',
    });
    expect(proteinReason(12, 150, 60, 2500)).toEqual({ tone: 'good', text: 'Adds 12 g protein' });
    expect(proteinReason(8, 150, 450, 0)).toEqual({
      tone: 'warn',
      text: 'Only 8 g protein of the 150 g you still need',
    });
  });

  it('does not scold a high-protein breakfast for not covering the whole day', () => {
    const reasons = optionReasons(
      n({ calories: 380, protein: 32, carbs: 30, fat: 12, sugar: 12 }),
      ctx({}, 8, true),
    );
    expect(reasons[1]).toEqual({ tone: 'good', text: 'Adds 32 g protein' });
    const pastry = optionReasons(n({ calories: 420, protein: 6, sugar: 20 }), ctx({}, 8, true));
    expect(pastry[1]).toEqual({
      tone: 'warn',
      text: 'Only 6 g protein of the 150 g you still need',
    });
  });

  it('mentions fiber only when it matters', () => {
    expect(fiberReason(8, 20)).toEqual({ tone: 'good', text: 'Adds 8 g fiber' });
    expect(fiberReason(4, 10)).toEqual({ tone: 'good', text: 'Adds 4 g fiber' });
    expect(fiberReason(2, 20)).toBeNull();
    expect(fiberReason(25, 20)?.text).toBe('Covers the fiber you still need today');
    expect(fiberReason(10, 0)).toBeNull();
  });

  it('flags limits that are already over', () => {
    const reasons = optionReasons(
      n({ calories: 300, protein: 20, sodium: 800 }),
      ctx({ ...LUNCH_EATEN, sodium: 2400 }),
    );
    expect(reasons).toContainEqual({
      tone: 'bad',
      text: 'Already over your sodium limit, adds 800 mg',
    });
  });

  it('warns when an option uses most of what is left of a limit', () => {
    const reasons = optionReasons(n({ calories: 300, protein: 20, satFat: 9 }), ctx());
    expect(reasons).toContainEqual({
      tone: 'warn',
      text: 'Uses most of your saturated fat allowance',
    });
  });

  it('ignores tiny amounts of limited nutrients', () => {
    const reasons = optionReasons(
      n({ calories: 300, protein: 20, sodium: 50 }),
      ctx({ ...LUNCH_EATEN, sodium: 2400 }),
    );
    expect(reasons.some((reason) => reason.text.includes('sodium'))).toBe(false);
  });

  it('never returns more than three reasons and always starts with calories', () => {
    const reasons = optionReasons(
      n({ calories: 1500, protein: 5, fiber: 20, satFat: 30, sodium: 3000, sugar: 80 }),
      ctx(),
    );
    expect(reasons).toHaveLength(3);
    expect(reasons[0].text).toContain('kcal');
  });
});

describe('comparisonRows', () => {
  const rows = comparisonRows([BOWL, BURGER], ctx());
  const row = (key: string) => rows.find((candidate) => candidate.key === key)!;
  const best = (key: string) =>
    row(key)
      .cells.filter((cell) => cell.best)
      .map((cell) => cell.id);
  const over = (key: string) =>
    row(key)
      .cells.filter((cell) => cell.over)
      .map((cell) => cell.id);

  it('lists the eight nutrients in a fixed order with units', () => {
    expect(rows.map((candidate) => [candidate.key, candidate.unit])).toEqual([
      ['calories', 'kcal'],
      ['protein', 'g'],
      ['carbs', 'g'],
      ['fat', 'g'],
      ['fiber', 'g'],
      ['satFat', 'g'],
      ['sodium', 'mg'],
      ['sugar', 'g'],
    ]);
    expect(row('sodium').cells.map((cell) => cell.text)).toEqual(['700', '1,600']);
  });

  it('highlights the best value per row for what is left today', () => {
    expect(best('calories')).toEqual(['bowl']);
    expect(best('protein')).toEqual(['burger']);
    expect(best('fiber')).toEqual(['bowl']);
    expect(best('satFat')).toEqual(['bowl']);
    expect(best('sodium')).toEqual(['bowl']);
    expect(best('sugar')).toEqual(['bowl']);
  });

  it('never highlights carbs or fat', () => {
    expect(best('carbs')).toEqual([]);
    expect(best('fat')).toEqual([]);
  });

  it('marks values that break a limit', () => {
    expect(over('satFat')).toEqual(['burger']);
    expect(over('sodium')).toEqual(['burger']);
    expect(over('sugar')).toEqual([]);
    expect(over('calories')).toEqual([]);
  });

  it('marks calories over only beyond the tolerance', () => {
    const feast = option('feast', { calories: 1400 });
    const table = comparisonRows([BOWL, feast], ctx());
    const calories = table.find((candidate) => candidate.key === 'calories')!;
    expect(calories.cells.map((cell) => cell.over)).toEqual([false, true]);
  });

  it('treats protein amounts above what is needed as equally good', () => {
    const eaten = { ...LUNCH_EATEN, protein: 120 };
    const table = comparisonRows(
      [option('a', { calories: 400, protein: 35 }), option('b', { calories: 400, protein: 60 })],
      ctx(eaten),
    );
    const protein = table.find((candidate) => candidate.key === 'protein')!;
    expect(protein.cells.every((cell) => !cell.best)).toBe(true);
  });

  it('does not highlight equal values or a single option', () => {
    const same = comparisonRows(
      [option('a', { sodium: 300 }), option('b', { sodium: 300 })],
      ctx(),
    );
    expect(same.flatMap((candidate) => candidate.cells).some((cell) => cell.best)).toBe(false);
    const single = comparisonRows([BOWL], ctx());
    expect(single.flatMap((candidate) => candidate.cells).some((cell) => cell.best)).toBe(false);
  });

  it('shows plain values without a budget', () => {
    const plain = comparisonRows([BOWL, BURGER], null);
    const cells = plain.flatMap((candidate) => candidate.cells);
    expect(cells.some((cell) => cell.best || cell.over)).toBe(false);
    expect(plain[0].cells.map((cell) => cell.text)).toEqual(['650', '1,100']);
  });
});
