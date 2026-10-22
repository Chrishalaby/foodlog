import type { Insight, InsightSeverity } from '@food/shared';

export interface InsightGroup {
  severity: InsightSeverity;
  title: string;
  insights: Insight[];
}

export const INSIGHT_GROUP_ORDER: readonly InsightSeverity[] = ['warning', 'good', 'info'];

export const INSIGHT_GROUP_TITLES: Record<InsightSeverity, string> = {
  warning: 'Needs attention',
  good: 'Going well',
  info: 'Good to know',
};

export function groupInsights(insights: readonly Insight[]): InsightGroup[] {
  return INSIGHT_GROUP_ORDER.map((severity) => ({
    severity,
    title: INSIGHT_GROUP_TITLES[severity],
    insights: insights.filter((insight) => insight.severity === severity),
  })).filter((group) => group.insights.length > 0);
}
