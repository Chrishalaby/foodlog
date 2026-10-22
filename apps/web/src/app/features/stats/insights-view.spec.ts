import type { Insight } from '@food/shared';
import { groupInsights } from './insights-view';

describe('groupInsights', () => {
  it('puts warnings first, then wins, then notes, dropping empty groups', () => {
    const insights: Insight[] = [
      { id: 'fiber-good', severity: 'good', title: 'Fiber on point', detail: '' },
      { id: 'logging-gaps', severity: 'info', title: 'Logged 4 of 7 days', detail: '' },
      { id: 'satfat-over', severity: 'warning', title: 'Sat fat over', detail: '' },
      { id: 'protein-hit', severity: 'good', title: 'Protein hit', detail: '' },
    ];
    const groups = groupInsights(insights);
    expect(groups.map((g) => [g.title, g.insights.map((i) => i.id)])).toEqual([
      ['Needs attention', ['satfat-over']],
      ['Going well', ['fiber-good', 'protein-hit']],
      ['Good to know', ['logging-gaps']],
    ]);
    expect(groupInsights(insights.filter((i) => i.severity === 'good'))).toHaveLength(1);
    expect(groupInsights([])).toEqual([]);
  });
});
