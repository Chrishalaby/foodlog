import {
  type AdaptiveTdee,
  addDays,
  type Goal,
  type Insight,
  type WeightPoint,
} from '@food/shared';
import {
  adaptiveTdeeInsight,
  type BodyInsightContext,
  buildBodyInsights,
  dailyKcalAdjustment,
  periodLabel,
  weightTrend,
  weightTrendInsight,
} from './body-insights.js';

const TO = '2026-09-27';

function linearWeights(
  endWeightKg: number,
  weeklyKg: number,
  options: { days?: number; every?: number; to?: string } = {},
): WeightPoint[] {
  const days = options.days ?? 21;
  const every = options.every ?? 1;
  const to = options.to ?? TO;
  const points: WeightPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= every) {
    points.push({
      date: addDays(to, -offset),
      weightKg: endWeightKg - (weeklyKg / 7) * offset,
    });
  }
  return points;
}

function context(
  overrides: Partial<BodyInsightContext> = {},
): BodyInsightContext {
  return {
    to: TO,
    goal: 'maintain',
    weights: [],
    tdee: null,
    adaptiveTdee: null,
    ...overrides,
  };
}

function trendFor(
  goal: Goal,
  weeklyKg: number,
  endWeightKg = 80,
): Insight | null {
  return weightTrendInsight(
    context({ goal, weights: linearWeights(endWeightKg, weeklyKg) }),
  );
}

function measured(
  kcal: number,
  overrides: Partial<AdaptiveTdee> = {},
): AdaptiveTdee {
  return {
    kcal,
    windowDays: 28,
    loggedDays: 26,
    weighIns: 14,
    avgIntakeKcal: 2100,
    weightChangeKg: -1.2,
    confidence: 'medium',
    ...overrides,
  };
}

describe('weightTrend', () => {
  it('needs at least three weigh-ins spanning seven days', () => {
    expect(
      weightTrend(
        [
          { date: '2026-09-21', weightKg: 80 },
          { date: '2026-09-27', weightKg: 79.5 },
        ],
        TO,
      ),
    ).toBeNull();
    expect(
      weightTrend(
        [
          { date: '2026-09-22', weightKg: 80 },
          { date: '2026-09-25', weightKg: 79.8 },
          { date: '2026-09-27', weightKg: 79.5 },
        ],
        TO,
      ),
    ).toBeNull();
    expect(
      weightTrend(
        [
          { date: '2026-09-20', weightKg: 80 },
          { date: '2026-09-24', weightKg: 79.8 },
          { date: '2026-09-27', weightKg: 79.3 },
        ],
        TO,
      ),
    ).not.toBeNull();
  });

  it('expresses the weekly change relative to the latest weigh-in up to the window end', () => {
    const weights = [
      ...linearWeights(80, -0.8),
      { date: addDays(TO, 3), weightKg: 60 },
    ];
    expect(weightTrend(weights, TO)).toEqual({
      weeklyKg: -0.8,
      weeklyPct: -1,
      weightKg: 80,
      periodDays: 21,
    });
  });

  it('measures the period from the first weigh-in of the three-week window', () => {
    const recent = weightTrend(linearWeights(80, -0.5, { days: 10 }), TO);
    expect(recent?.periodDays).toBe(10);
    const older = [
      { date: addDays(TO, -40), weightKg: 90 },
      ...linearWeights(80, -0.5, { days: 14 }),
    ];
    expect(weightTrend(older, TO)?.periodDays).toBe(14);
  });

  it('works with sparse weigh-ins', () => {
    const trend = weightTrend(linearWeights(90, -0.9, { every: 3 }), TO);
    expect(trend?.weeklyKg).toBe(-0.9);
    expect(trend?.weeklyPct).toBe(-1);
  });
});

describe('weightTrendInsight', () => {
  it('is omitted without enough weigh-ins', () => {
    expect(
      weightTrendInsight(
        context({ goal: 'cut', weights: linearWeights(80, -0.5, { days: 5 }) }),
      ),
    ).toBeNull();
    expect(weightTrendInsight(context({ goal: 'cut' }))).toBeNull();
  });

  describe('on a cut', () => {
    it('is good when losing 0.25–1 % of body weight a week', () => {
      const insight = trendFor('cut', -0.6);
      expect(insight).toEqual({
        id: 'weight-trend',
        severity: 'good',
        title: 'Losing weight at a steady pace',
        detail:
          'Over the last 3 weeks you have been losing about 0.6 kg a week (0.75% of your body weight), right in the 0.25–1% a week range that protects muscle while you lose fat.',
      });
    });

    it('describes the span actually covered by the weigh-ins', () => {
      const insight = weightTrendInsight(
        context({
          goal: 'cut',
          weights: linearWeights(80, -0.6, { days: 10 }),
        }),
      );
      expect(insight?.detail).toMatch(
        /^Over the last 10 days you have been losing about 0\.6 kg a week/,
      );
    });

    it('includes both ends of the healthy range', () => {
      expect(trendFor('cut', -0.2)?.severity).toBe('good');
      expect(trendFor('cut', -0.8)?.severity).toBe('good');
    });

    it('warns when losing faster than 1 % a week', () => {
      const insight = trendFor('cut', -1.2);
      expect(insight).toMatchObject({
        id: 'weight-trend',
        severity: 'warning',
        title: 'Losing weight fast',
      });
      expect(insight?.detail).toBe(
        'Over the last 3 weeks you have been losing about 1.2 kg a week (1.5% of your body weight). Losing more than 1% a week makes it harder to keep muscle and to stick with the plan; eating about 440 kcal a day more brings you back to a sustainable pace.',
      );
    });

    it('warns when gaining', () => {
      const insight = trendFor('cut', 0.3);
      expect(insight).toMatchObject({
        severity: 'warning',
        title: 'Gaining weight on a cut',
      });
      expect(insight?.detail).toBe(
        'Over the last 3 weeks you have been gaining about 0.3 kg a week (0.38% of your body weight). To lose fat, aim to lose 0.25–1% of your body weight a week (0.2–0.8 kg for you); eating about 550 kcal a day less would get you there.',
      );
    });

    it('nudges when losing slowly or holding steady', () => {
      expect(trendFor('cut', -0.1)).toMatchObject({
        severity: 'info',
        title: 'Weight loss is slow',
      });
      const steady = trendFor('cut', 0.02);
      expect(steady).toMatchObject({
        severity: 'info',
        title: 'Weight holding steady on a cut',
      });
      expect(steady?.detail).toContain(
        'Your weight has held steady over the last 3 weeks (less than 0.05 kg a week).',
      );
    });
  });

  describe('on a bulk', () => {
    it('is good when gaining 0.1–0.5 % of body weight a week', () => {
      expect(trendFor('bulk', 0.2)).toMatchObject({
        severity: 'good',
        title: 'Gaining at a lean pace',
      });
      expect(trendFor('bulk', 0.4)?.severity).toBe('good');
    });

    it('is info when gaining faster than 0.5 % a week', () => {
      const insight = trendFor('bulk', 0.6);
      expect(insight).toMatchObject({
        severity: 'info',
        title: 'Gaining faster than needed',
      });
      expect(insight?.detail).toContain(
        'eating about 220 kcal a day less keeps the bulk lean.',
      );
    });

    it('is info when gaining slowly', () => {
      expect(trendFor('bulk', 0.06)).toMatchObject({
        severity: 'info',
        title: 'Gaining slowly',
      });
    });

    it('is info when stalled or losing', () => {
      expect(trendFor('bulk', 0)).toMatchObject({
        severity: 'info',
        title: 'Weight gain has stalled',
      });
      const losing = trendFor('bulk', -0.3);
      expect(losing).toMatchObject({
        severity: 'info',
        title: 'Losing weight on a bulk',
      });
      expect(losing?.detail).toContain(
        'aim to gain 0.1–0.5% of your body weight a week (0.1–0.4 kg for you); eating about 420 kcal a day more would get you there.',
      );
    });
  });

  describe('when maintaining', () => {
    it('is good within ±0.2 kg a week', () => {
      expect(trendFor('maintain', 0.2)).toMatchObject({
        severity: 'good',
        title: 'Weight stable',
      });
      expect(trendFor('maintain', -0.15)?.severity).toBe('good');
    });

    it('is info when drifting, with the daily adjustment', () => {
      const up = trendFor('maintain', 0.4);
      expect(up).toMatchObject({
        severity: 'info',
        title: 'Weight drifting up',
      });
      expect(up?.detail).toContain(
        'To hold your weight, try eating about 440 kcal a day less.',
      );
      const down = trendFor('maintain', -0.3);
      expect(down).toMatchObject({
        severity: 'info',
        title: 'Weight drifting down',
      });
      expect(down?.detail).toContain('eating about 330 kcal a day more.');
    });
  });
});

describe('periodLabel', () => {
  it('uses weeks for whole weeks and days otherwise', () => {
    expect(periodLabel(7)).toBe('week');
    expect(periodLabel(14)).toBe('2 weeks');
    expect(periodLabel(21)).toBe('3 weeks');
    expect(periodLabel(10)).toBe('10 days');
  });
});

describe('dailyKcalAdjustment', () => {
  it('never suggests less than 50 kcal', () => {
    expect(
      dailyKcalAdjustment(
        { weeklyKg: -0.19, weeklyPct: -0.24, weightKg: 80, periodDays: 21 },
        -0.25,
      ),
    ).toBe(50);
  });
});

describe('adaptiveTdeeInsight', () => {
  it('needs a measured burn and a current setting', () => {
    expect(adaptiveTdeeInsight(context({ tdee: 2000 }))).toBeNull();
    expect(
      adaptiveTdeeInsight(context({ adaptiveTdee: measured(2600) })),
    ).toBeNull();
  });

  it('stays quiet within 10 % of the setting', () => {
    expect(
      adaptiveTdeeInsight(
        context({ tdee: 2000, adaptiveTdee: measured(2200) }),
      ),
    ).toBeNull();
    expect(
      adaptiveTdeeInsight(
        context({ tdee: 2000, adaptiveTdee: measured(1800) }),
      ),
    ).toBeNull();
  });

  it('suggests adopting a higher measured burn', () => {
    expect(
      adaptiveTdeeInsight(
        context({ tdee: 2100, adaptiveTdee: measured(2450) }),
      ),
    ).toEqual({
      id: 'adaptive-tdee',
      severity: 'info',
      title: 'Your measured burn is higher than your setting',
      detail:
        'Your measured burn is about 2,450 kcal/day, 350 kcal higher than your current setting — you can adopt it in Stats → Weight. It is based on 26 logged days and 14 weigh-ins over the last 28 days (medium confidence).',
    });
  });

  it('reports a lower measured burn', () => {
    const insight = adaptiveTdeeInsight(
      context({
        tdee: 2500,
        adaptiveTdee: measured(2000, { confidence: 'high', loggedDays: 28 }),
      }),
    );
    expect(insight?.title).toBe(
      'Your measured burn is lower than your setting',
    );
    expect(insight?.detail).toContain(
      'about 2,000 kcal/day, 500 kcal lower than your current setting',
    );
    expect(insight?.detail).toContain('28 logged days');
    expect(insight?.detail).toContain('(high confidence)');
  });
});

describe('buildBodyInsights', () => {
  it('returns the weight trend and adaptive TDEE insights when both apply', () => {
    const insights = buildBodyInsights(
      context({
        goal: 'cut',
        weights: linearWeights(80, -0.5),
        tdee: 2000,
        adaptiveTdee: measured(2500),
      }),
    );
    expect(insights.map((insight) => insight.id)).toEqual([
      'weight-trend',
      'adaptive-tdee',
    ]);
  });

  it('returns nothing without body data', () => {
    expect(buildBodyInsights(context())).toEqual([]);
  });
});
