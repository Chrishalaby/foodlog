import {
  ACTIVITY_LEVELS,
  ACTIVITY_LEVEL_LABELS,
  type ActivityLevel,
  type BodyMetrics,
  GOALS,
  GOAL_FACTOR,
  type Goal,
  KCAL_PER_KG_BODY_MASS,
  PROTEIN_G_PER_KG,
  TARGET_LIMITS,
  type TargetProfileInput,
  type TargetValues,
  type TargetsResult,
  computeBodyMetrics,
  computeTargets,
  roundTo,
} from '@food/shared';
import { formatNumber } from '../../shared/utils/format';
import {
  BMR_FORMULA_LABELS,
  autoTargetValues,
  formulaTdee,
  labelParts,
} from '../settings/profile-model';

export interface ActivityPreview {
  level: ActivityLevel;
  title: string;
  detail: string;
  intensity: number;
  burnKcal: number | null;
}

export interface GoalPreview {
  goal: Goal;
  title: string;
  detail: string;
  kcal: number | null;
}

export interface NumbersSummary {
  targets: TargetsResult;
  auto: TargetValues;
  formulaTdee: number | null;
  formulaLabel: string | null;
  burnSource: 'formula' | 'override' | null;
  goalNote: string;
  body: BodyMetrics;
}

const GOAL_TITLES: Record<Goal, string> = {
  maintain: 'Maintain',
  cut: 'Lose fat',
  bulk: 'Build muscle',
};

const kcal = (value: number): string => `${formatNumber(value)} kcal`;

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function goalPercent(goal: Goal): number {
  return Math.round(Math.abs(GOAL_FACTOR[goal] - 1) * 100);
}

export function goalDetail(goal: Goal): string {
  const protein = `Protein ${PROTEIN_G_PER_KG[goal]} g/kg`;
  switch (goal) {
    case 'cut':
      return `About ${goalPercent(goal)} % under your burn (at most ${formatNumber(TARGET_LIMITS.maxDeficitKcal)} kcal). ${protein} keeps your muscle.`;
    case 'bulk':
      return `About ${goalPercent(goal)} % over your burn (at most ${formatNumber(TARGET_LIMITS.maxSurplusKcal)} kcal). ${protein} to build muscle.`;
    default:
      return `Eat about what you burn to keep your weight steady. ${protein}.`;
  }
}

export function activityPreviews(input: TargetProfileInput): ActivityPreview[] {
  return ACTIVITY_LEVELS.map((level, index) => {
    const parts = labelParts(ACTIVITY_LEVEL_LABELS[level]);
    return {
      level,
      title: parts.title,
      detail: capitalize(parts.detail),
      intensity: index + 1,
      burnKcal: formulaTdee({ ...input, activityLevel: level }),
    };
  });
}

export function goalPreviews(input: TargetProfileInput): GoalPreview[] {
  return GOALS.map((goal) => {
    const result = computeTargets({ ...input, goal, targetOverrides: {} });
    return {
      goal,
      title: GOAL_TITLES[goal],
      detail: goalDetail(goal),
      kcal: result.complete ? result.base.calories : null,
    };
  });
}

export function weeklyKgFromDailyKcal(dailyKcal: number): number {
  return roundTo((dailyKcal * 7) / KCAL_PER_KG_BODY_MASS, 1);
}

export function goalNote(targets: TargetsResult): string {
  if (!targets.complete || targets.tdee === null) {
    return 'Generic starting targets. Add your details for personal ones.';
  }
  const delta = targets.base.calories - targets.tdee;
  if (Math.abs(delta) < 25) {
    return 'Matches your daily calorie burn, so your weight should stay steady.';
  }
  const weekly = weeklyKgFromDailyKcal(Math.abs(delta));
  const direction = delta < 0 ? 'below' : 'above';
  const change = delta < 0 ? 'lost' : 'gained';
  const pace = weekly > 0 ? `: about ${formatNumber(weekly, 1)} kg ${change} per week` : '';
  return `${kcal(Math.abs(delta))} ${direction} your daily burn${pace}.`;
}

export function numbersSummary(input: TargetProfileInput): NumbersSummary {
  const targets = computeTargets(input);
  return {
    targets,
    auto: autoTargetValues(input),
    formulaTdee: formulaTdee(input),
    formulaLabel: targets.bmrFormula ? BMR_FORMULA_LABELS[targets.bmrFormula] : null,
    burnSource: targets.tdeeSource,
    goalNote: goalNote(targets),
    body: computeBodyMetrics(input),
  };
}
