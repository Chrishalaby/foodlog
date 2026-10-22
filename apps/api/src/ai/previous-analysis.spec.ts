import {
  type AnalysisChainParent,
  collectAnsweredQuestions,
  summarizePreviousResult,
} from './previous-analysis.js';

function loaderFor(rows: Record<string, AnalysisChainParent>): {
  load: (id: string) => Promise<AnalysisChainParent | null>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    load: (id) => {
      calls.push(id);
      return Promise.resolve(rows[id] ?? null);
    },
  };
}

const ROOT: AnalysisChainParent = {
  previousAnalysisId: null,
  followUpAnswer: null,
  result: { followUpQuestion: 'How was the chicken cooked?' },
};

const FIRST_FOLLOW_UP: AnalysisChainParent = {
  previousAnalysisId: 'root',
  followUpAnswer: 'Pan-fried in oil',
  result: { followUpQuestion: 'How big was the portion?' },
};

describe('collectAnsweredQuestions', () => {
  it('returns nothing for an analysis that answered no question', async () => {
    const { load, calls } = loaderFor({});
    await expect(collectAnsweredQuestions(ROOT, load)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('pairs every answer in the chain with the question it answered, oldest first', async () => {
    const { load } = loaderFor({ root: ROOT, first: FIRST_FOLLOW_UP });
    const second = {
      previousAnalysisId: 'first',
      followUpAnswer: '  Large  ',
    };

    await expect(collectAnsweredQuestions(second, load)).resolves.toEqual([
      { question: 'How was the chicken cooked?', answer: 'Pan-fried in oil' },
      { question: 'How big was the portion?', answer: 'Large' },
    ]);
  });

  it('keeps answers through a re-run that added no answer of its own', async () => {
    const { load } = loaderFor({ root: ROOT, first: FIRST_FOLLOW_UP });
    const precise = { previousAnalysisId: 'first', followUpAnswer: null };

    await expect(collectAnsweredQuestions(precise, load)).resolves.toEqual([
      { question: 'How was the chicken cooked?', answer: 'Pan-fried in oil' },
    ]);
  });

  it('keeps an answer whose question was already cleaned up', async () => {
    const { load } = loaderFor({});
    await expect(
      collectAnsweredQuestions(
        { previousAnalysisId: 'gone', followUpAnswer: 'Grilled' },
        load,
      ),
    ).resolves.toEqual([{ question: null, answer: 'Grilled' }]);
  });

  it('stops walking after the depth limit', async () => {
    const rows: Record<string, AnalysisChainParent> = {};
    for (let i = 0; i < 10; i += 1) {
      rows[`a${i}`] = {
        previousAnalysisId: `a${i + 1}`,
        followUpAnswer: `answer ${i}`,
        result: { followUpQuestion: `question ${i}` },
      };
    }
    const { load, calls } = loaderFor(rows);

    const answered = await collectAnsweredQuestions(rows.a0!, load, 3);

    expect(calls).toEqual(['a1', 'a2', 'a3']);
    expect(answered.map((entry) => entry.answer)).toEqual([
      'answer 2',
      'answer 1',
      'answer 0',
    ]);
  });
});

describe('summarizePreviousResult', () => {
  it('reads items, totals and the question from a stored result and skips junk', () => {
    expect(
      summarizePreviousResult({
        mealName: ' Chicken plate ',
        items: [
          { name: 'Chicken', grams: 150, nutrients: { calories: 248 } },
          { name: 42 },
          'junk',
        ],
        totals: { calories: 250 },
        followUpQuestion: 'How was it cooked?',
      }),
    ).toEqual({
      mealName: 'Chicken plate',
      items: [{ name: 'Chicken', grams: 150, calories: 248 }],
      totalCalories: 250,
      question: 'How was it cooked?',
    });
    expect(
      summarizePreviousResult({
        mealName: 'Burgers',
        portion: { count: 1.5, unit: 'burger', unitPlural: 'burgers' },
        items: [
          {
            name: 'Patties',
            grams: 135,
            count: 1.5,
            unit: 'patty',
            unitPlural: 'patties',
            nutrients: { calories: 365 },
          },
          { name: 'Sauce', grams: 20, count: 0, unit: 'x' },
        ],
        totals: { calories: 365 },
      }),
    ).toEqual({
      mealName: 'Burgers',
      portion: { count: 1.5, unit: 'burger', unitPlural: 'burgers' },
      items: [
        {
          name: 'Patties',
          grams: 135,
          calories: 365,
          portion: { count: 1.5, unit: 'patty', unitPlural: 'patties' },
        },
        { name: 'Sauce', grams: 20, calories: 0 },
      ],
      totalCalories: 365,
      question: null,
    });
    expect(
      summarizePreviousResult({ mealName: 'x', portion: { count: 'two' } }),
    ).not.toHaveProperty('portion');
    expect(summarizePreviousResult(null)).toEqual({
      mealName: '',
      items: [],
      totalCalories: 0,
      question: null,
    });
  });
});
