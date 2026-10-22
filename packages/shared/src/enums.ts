export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const ANALYSIS_MODES = ['food_photo', 'nutrition_label', 'text'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export const USAGE_MODES = ['food_photo', 'nutrition_label', 'text', 'menu', 'voice', 'ideas'] as const;
export type UsageMode = (typeof USAGE_MODES)[number];

export const ENTRY_SOURCES = ['food_photo', 'nutrition_label', 'text', 'favorite', 'manual', 'copy', 'barcode', 'database', 'import'] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const AMOUNT_SOURCES = ['user_stated', 'label', 'visual_estimate', 'assumed_hidden', 'typical_serving'] as const;
export type AmountSource = (typeof AMOUNT_SOURCES)[number];

export const FOOD_STATES = ['raw', 'cooked', 'dry_uncooked', 'as_served'] as const;
export type FoodState = (typeof FOOD_STATES)[number];

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'very', 'extra'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const GOALS = ['maintain', 'cut', 'bulk'] as const;
export type Goal = (typeof GOALS)[number];

export const IMAGE_DETAILS = ['low', 'high'] as const;
export type ImageDetail = (typeof IMAGE_DETAILS)[number];

export const THEMES = ['dark', 'light', 'system'] as const;
export type ThemePreference = (typeof THEMES)[number];

export const INSIGHT_SEVERITIES = ['good', 'info', 'warning'] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

export const EXPORT_FORMATS = ['json', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ACCESS_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const AUTH_TOKEN_TYPES = ['invite', 'reset'] as const;
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number];

export const PRODUCT_SOURCES = ['label', 'openfoodfacts', 'manual'] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

export const IMAGE_ROLES = ['food', 'label'] as const;
export type ImageRole = (typeof IMAGE_ROLES)[number];

export const AI_PROVIDER_KINDS = ['openai', 'anthropic', 'gemini', 'openrouter', 'local', 'custom'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

export const AI_API_STYLES = ['responses', 'chat'] as const;
export type AiApiStyle = (typeof AI_API_STYLES)[number];

export const AI_PROVIDER_SOURCES = ['app', 'env', 'demo', 'none'] as const;
export type AiProviderSource = (typeof AI_PROVIDER_SOURCES)[number];

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (desk job, little exercise)',
  light: 'Light (exercise 1–3 days/week)',
  moderate: 'Moderate (exercise 3–5 days/week)',
  very: 'Very active (hard exercise 6–7 days/week)',
  extra: 'Extra active (hard training + physical job)',
};

export const GOAL_LABELS: Record<Goal, string> = {
  maintain: 'Maintain',
  cut: 'Cut (lose fat)',
  bulk: 'Bulk (gain muscle)',
};
