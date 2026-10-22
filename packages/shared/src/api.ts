import type {
  AccessRequestStatus,
  AiApiStyle,
  AiProviderKind,
  AiProviderSource,
  AuthTokenType,
  ActivityLevel,
  AmountSource,
  AnalysisMode,
  Confidence,
  EntrySource,
  FoodState,
  Goal,
  ImageDetail,
  ImageRole,
  InsightSeverity,
  MealType,
  ProductSource,
  Sex,
  ThemePreference,
  UsageMode,
  UserRole,
  UserStatus,
} from './enums.js';
import type { BmiCategory, FfmiCategory } from './body.js';
import type { MacroSplit, NutrientKey, Nutrients } from './nutrients.js';
import type { BmrFormula, TargetOverrides, TargetValues, TdeeSource } from './targets.js';
import type { Portion } from './portions.js';
import type { Micros, MicrosCoverage } from './micros.js';
import type { FluidKind } from './fluids.js';
import type { AdaptiveTdeeConfidence } from './weight.js';
import type { CatalogGroup, CatalogPortion, CatalogSource } from './catalog.js';

export const API_LIMITS = {
  nameMax: 120,
  descriptionMax: 2000,
  followUpAnswerMax: 500,
  itemsMax: 60,
  imageMaxBytes: 8 * 1024 * 1024,
  passwordMin: 8,
  passwordMax: 200,
  historyPageMax: 100,
  rangeMaxDays: 366,
  favoriteServingsMin: 0.1,
  favoriteServingsMax: 20,
  locationMax: 120,
  foodSearchMax: 50,
  catalogSearchMax: 50,
  catalogOffsetMax: 10000,
  importEntriesMax: 200,
  importWeightsMax: 500,
  importFluidsMax: 1000,
  importTrainingDaysMax: 500,
  foodQueryMax: 120,
  personNameMax: 80,
  accessMessageMax: 500,
  barcodeMin: 8,
  analyzeImagesMax: 3,
  draftsMax: 100,
  menuDishesMax: 12,
  splitMealsMax: 8,
  mealIdeasMax: 3,
  mealIdeaPartsMax: 6,
  mealIdeaNoteMax: 300,
  mealIdeaExcludeMax: 12,
  audioMaxBytes: 10 * 1024 * 1024,
  voiceMaxSeconds: 180,
  noteTextMax: 4000,
  notePhotosMax: 4,
  notesPageMax: 100,
  barcodeMax: 14,
  sessionMaxAgeDays: 400,
  inviteTtlDays: 14,
  resetTtlDays: 2,
} as const;

export const BARCODE_PATTERN = /^(\d{8}|\d{12,14})$/;

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

export const IMPORT_SOURCES = ['foodlog', 'cronometer', 'myfitnesspal', 'csv'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportEntryInput {
  name: string;
  description?: string | null;
  mealType: MealType;
  timestamp: string;
  localDate: string;
  items: EntryItemInput[];
  portion?: Portion | null;
}

export interface ImportWeightInput {
  date: string;
  weightKg: number;
  bodyFatPct?: number | null;
}

export interface ImportFluidInput {
  localDate: string;
  timestamp: string;
  ml: number;
  kind: FluidKind;
}

export interface ImportBatchRequest {
  source: ImportSource;
  entries?: ImportEntryInput[];
  weights?: ImportWeightInput[];
  fluids?: ImportFluidInput[];
  trainingDays?: string[];
}

export interface ImportBatchResponse {
  entriesCreated: number;
  entriesSkipped: number;
  weightsCreated: number;
  weightsSkipped: number;
  fluidsCreated: number;
  fluidsSkipped: number;
  trainingDaysSet: number;
}

export interface DemoStatusDto {
  enabled: boolean;
  expiresAt: string | null;
}

export interface AuthStatusResponse {
  setupRequired: boolean;
  authenticated: boolean;
  user: UserDto | null;
  demo?: DemoStatusDto;
  notes?: boolean;
}

export interface DemoStartRequest {
  localDate: string;
  utcOffsetMinutes: number;
}

export interface SetupRequest {
  email: string;
  password: string;
  setupCode: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface PhotoRef {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

export interface AnalyzeRequestFields {
  mode: AnalysisMode;
  description?: string;
  detail?: ImageDetail;
  precise?: 'true' | 'false';
  previousAnalysisId?: string;
  followUpAnswer?: string;
  localTime?: string;
  mealType?: MealType;
  imageRoles?: string;
  draftId?: string;
  split?: 'true' | 'false';
}

export interface AnalysisPhotoRef {
  photo: PhotoRef;
  role: ImageRole;
}

export interface AnalysisItem {
  name: string;
  grams: number;
  count: number | null;
  unit: string | null;
  unitPlural: string | null;
  nutrients: Nutrients;
  per100g: Nutrients;
  confidence: Confidence;
  amountSource: AmountSource;
  state: FoodState;
  portionBasis: string;
  flags: string[];
  micros: Micros | null;
  microsPer100g: Micros | null;
  fluidMl: number | null;
  savedFood: SavedFoodRef | null;
  suggestedFood: SavedFoodRef | null;
}

export interface SavedFoodRef {
  id: string;
  name: string;
  brand: string | null;
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100: Micros | null;
  unitName: string | null;
  unitGrams: number | null;
}

export interface LabelInfo {
  productName: string | null;
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100: Micros | null;
  servingSize: number | null;
  servingText: string | null;
  packSize: number | null;
}

export interface AnalysisResult {
  inputType: AnalysisMode;
  mealName: string;
  portion: Portion | null;
  scaleCues: string;
  items: AnalysisItem[];
  label: LabelInfo | null;
  totals: Nutrients;
  assumptions: string[];
  followUpQuestion: string | null;
  followUpOptions: string[];
  warnings: string[];
}

export interface AiUsageSummary {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  durationMs: number;
  attempts: number;
}

export interface MealTiming {
  mealType: MealType | null;
  time: string | null;
  daysAgo: number;
}

export interface AnalyzeResponse {
  analysisId: string;
  mode: AnalysisMode;
  description: string | null;
  result: AnalysisResult;
  photo: PhotoRef | null;
  photos: AnalysisPhotoRef[];
  usage: AiUsageSummary;
  precise: boolean;
  timing?: MealTiming | null;
  moreMeals?: AnalyzeResponse[];
}

export interface TranscribeResponse {
  text: string;
}

export interface EntryItemInput {
  name: string;
  grams: number;
  nutrients: Nutrients;
  confidence?: Confidence | null;
  count?: number | null;
  unit?: string | null;
  unitPlural?: string | null;
  productId?: string | null;
  micros?: Micros | null;
  fluidMl?: number | null;
}

export interface EntryItemDto {
  id: string;
  position: number;
  name: string;
  grams: number;
  nutrients: Nutrients;
  confidence: Confidence | null;
  count: number | null;
  unit: string | null;
  unitPlural: string | null;
  productId: string | null;
  micros: Micros | null;
  fluidMl: number | null;
}

export interface EntryDto {
  id: string;
  name: string;
  description: string | null;
  mealType: MealType;
  source: EntrySource;
  timestamp: string;
  localDate: string;
  items: EntryItemDto[];
  totals: Nutrients;
  portion: Portion | null;
  photo: PhotoRef | null;
  photos: AnalysisPhotoRef[];
  analysisId: string | null;
  favoriteId: string | null;
  productId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntryRequestPhotos {
  coverPhotoId?: string | null;
  portion?: Portion | null;
}

export interface CreateEntryRequest extends CreateEntryRequestPhotos {
  name: string;
  description?: string | null;
  mealType: MealType;
  source: EntrySource;
  timestamp: string;
  localDate: string;
  items: EntryItemInput[];
  analysisId?: string | null;
  photoId?: string | null;
}

export interface UpdateEntryRequest {
  name: string;
  description?: string | null;
  mealType: MealType;
  timestamp: string;
  localDate: string;
  items: EntryItemInput[];
  coverPhotoId?: string;
  portion?: Portion | null;
}

export interface DuplicateEntryRequest {
  timestamp: string;
  localDate: string;
  mealType?: MealType;
}

export interface EntryListQuery {
  from?: string;
  to?: string;
  before?: string;
  limit?: number;
  q?: string;
}

export interface EntryRawAiResponse {
  entryId: string;
  analysisId: string | null;
  rawAiJson: unknown;
}

export interface EntryListResponse {
  items: EntryDto[];
  nextCursor: string | null;
}

export interface FavoriteDto {
  id: string;
  name: string;
  mealType: MealType | null;
  items: EntryItemInput[];
  totals: Nutrients;
  portion: Portion | null;
  photo: PhotoRef | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFavoriteRequest {
  name: string;
  mealType?: MealType | null;
  items: EntryItemInput[];
  portion?: Portion | null;
  photoId?: string | null;
}

export interface CreateFavoriteFromEntryRequest {
  name?: string;
}

export interface UpdateFavoriteRequest {
  name: string;
  mealType: MealType | null;
  items: EntryItemInput[];
  portion?: Portion | null;
}

export interface LogFavoriteRequest {
  timestamp: string;
  localDate: string;
  mealType: MealType;
  servings?: number;
}

export interface DayMetaDto {
  date: string;
  trainingDay: boolean;
}

export interface UpdateDayMetaRequest {
  trainingDay: boolean;
}

export interface ProfileDto {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: Sex | null;
  bodyFatPct?: number | null;
  tdeeOverride?: number | null;
  onboarded?: boolean;
  activityLevel: ActivityLevel;
  goal: Goal;
  trainingDaysPerWeek: number;
  targetOverrides: TargetOverrides;
  location: string | null;
  aiModel: string | null;
  aiDetailFood: ImageDetail;
  aiDetailLabel: ImageDetail;
  theme: ThemePreference;
  dayStartHour?: number;
  fluidTargetMl?: number | null;
}

export type UpdateProfileRequest = ProfileDto;

export interface TargetsDto {
  complete: boolean;
  bmr: number | null;
  bmrFormula: BmrFormula | null;
  tdee: number | null;
  tdeeSource: TdeeSource | null;
  computedBase: TargetValues;
  base: TargetValues;
  trainingDay: TargetValues;
  restDay: TargetValues;
  trainingDeltaKcal: number;
  restDeltaKcal: number;
  warnings: string[];
}

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
  estCostPerRequestUsd: number;
  recommended: boolean;
}

export interface AiConfigDto {
  provider: AiProviderKind | 'mock' | 'unconfigured';
  voice: boolean;
  customEndpoint: boolean;
  defaultModel: string;
  preciseModel: string;
  activeModel: string;
  reasoningEffort: string;
  availableModels: AiModelOption[];
  monthlyBudgetUsd: number | null;
}

export interface BodyMetricsDto {
  bmi: number | null;
  bmiCategory: BmiCategory | null;
  leanMassKg: number | null;
  fatMassKg: number | null;
  ffmi: number | null;
  ffmiNormalized: number | null;
  ffmiCategory: FfmiCategory | null;
}

export interface ProfileResponse {
  profile: ProfileDto;
  targets: TargetsDto;
  body: BodyMetricsDto;
  ai: AiConfigDto;
}

export interface WeightLogDto {
  date: string;
  weightKg: number;
  bodyFatPct: number | null;
}

export interface UpsertWeightRequest {
  weightKg: number;
  bodyFatPct?: number | null;
}

export interface WeightTrendPointDto {
  date: string;
  weightKg: number | null;
  trendKg: number | null;
}

export interface AdaptiveTdeeDto {
  kcal: number;
  windowDays: number;
  loggedDays: number;
  weighIns: number;
  avgIntakeKcal: number;
  weightChangeKg: number;
  confidence: AdaptiveTdeeConfidence;
}

export interface WeightSummaryResponse {
  from: string;
  to: string;
  logs: WeightLogDto[];
  trend: WeightTrendPointDto[];
  latest: WeightLogDto | null;
  weeklyChangeKg: number | null;
  adaptiveTdee: AdaptiveTdeeDto | null;
}

export const FOOD_RESULT_KINDS = ['favorite', 'meal', 'food', 'product'] as const;
export type FoodResultKind = (typeof FOOD_RESULT_KINDS)[number];

export interface FoodSearchResult {
  key: string;
  kind: FoodResultKind;
  name: string;
  detail: string | null;
  items: EntryItemInput[];
  totals: Nutrients;
  grams: number;
  portion: Portion | null;
  mealType: MealType | null;
  photo: PhotoRef | null;
  favoriteId: string | null;
  entryId: string | null;
  productId: string | null;
  barcode?: string | null;
  useCount: number;
  lastUsedAt: string | null;
  starred: boolean;
}

export const FOOD_SEARCH_SCOPES = ['all', 'standalone'] as const;
export type FoodSearchScope = (typeof FOOD_SEARCH_SCOPES)[number];

export interface FoodSearchQuery {
  q?: string;
  limit?: number;
  scope?: FoodSearchScope;
}

export interface FoodSearchResponse {
  query: string;
  results: FoodSearchResult[];
}

export interface CatalogFoodDto {
  id: number;
  name: string;
  category: string;
  group: CatalogGroup;
  source: CatalogSource;
  per100: Nutrients;
  missing: NutrientKey[];
  microsPer100: Micros | null;
  portions: CatalogPortion[];
}

export interface CatalogSearchQuery {
  q?: string;
  group?: CatalogGroup;
  limit?: number;
  offset?: number;
}

export interface CatalogSearchResponse {
  query: string;
  group: CatalogGroup | null;
  total: number;
  results: CatalogFoodDto[];
}

export interface CatalogGroupCount {
  group: CatalogGroup;
  count: number;
}

export interface CatalogInfoResponse {
  version: string | null;
  foodCount: number;
  loadedAt: string | null;
  groups: CatalogGroupCount[];
  source: string;
  license: string;
}

export interface FoodRenameRequest {
  from: string;
  to: string;
  dryRun?: boolean;
}

export interface FoodRenameResponse {
  matchedEntries: number;
  renamedEntries: number;
  renamedItems: number;
}

export interface HiddenFoodsResponse {
  names: string[];
}

export interface HideFoodRequest {
  name: string;
}

export interface QuickLogRequest {
  key: string;
  servings?: number;
  grams?: number;
  portionCount?: number;
  timestamp: string;
  localDate: string;
  mealType: MealType;
}

export interface DaySummary {
  date: string;
  trainingDay: boolean;
  targets: TargetValues;
  totals: Nutrients;
  entryCount: number;
  micros: Micros;
  microsCoverage: MicrosCoverage;
  fluidsMl: number;
  fluidTargetMl: number;
}

export interface DayDashboardResponse {
  day: DaySummary;
  entries: EntryDto[];
}

export interface WeekdayAverage {
  weekday: number;
  loggedDays: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface RangeStats {
  loggedDays: number;
  totalDays: number;
  avgTotals: Nutrients;
  avgTargets: TargetValues;
  macroSplit: MacroSplit;
  proteinHitDays: number;
  calorieOnTargetDays: number;
  satFatOverDays: number;
  sodiumOverDays: number;
  fiberHitDays: number;
  weekdayAverages: WeekdayAverage[];
  avgMicros: Micros;
  microsCoverage: MicrosCoverage;
  microsDays: number;
  avgFluidsMl: number;
  fluidDays: number;
  fluidHitDays: number;
}

export interface RangeDashboardResponse {
  from: string;
  to: string;
  days: DaySummary[];
  stats: RangeStats;
}

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
}

export interface InsightsResponse {
  from: string;
  to: string;
  insights: Insight[];
}

export interface UsageRecordDto {
  id: string;
  createdAt: string;
  model: string;
  mode: UsageMode;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorKind: string | null;
}

export interface UsageSummaryResponse {
  month: string;
  monthToDateUsd: number;
  monthRequests: number;
  monthFailedRequests: number;
  last30DaysUsd: number;
  allTimeUsd: number;
  avgCostPerRequestUsd: number;
  byModel: { model: string; requests: number; costUsd: number }[];
  recent: UsageRecordDto[];
  budgetUsd: number | null;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}

export interface CreateAccessRequest {
  email: string;
  name: string;
  message?: string | null;
}

export interface CreateAccessRequestResponse {
  statusToken: string;
}

export interface AccessRequestStatusRequest {
  statusToken: string;
}

export interface AccessRequestStatusResponse {
  status: AccessRequestStatus | 'unknown';
  email: string | null;
  name: string | null;
  createdAt: string | null;
  decidedAt: string | null;
  canCreateAccount: boolean;
}

export interface AcceptAccessRequest {
  statusToken: string;
  password: string;
}

export interface AuthTokenInfoResponse {
  type: AuthTokenType | null;
  email: string | null;
  name: string | null;
  valid: boolean;
  reason: 'expired' | 'used' | 'revoked' | 'not_found' | 'account_exists' | null;
  expiresAt: string | null;
}

export interface AcceptAuthTokenRequest {
  password: string;
  name?: string | null;
}

export interface SessionDto {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface UpdateAccountRequest {
  name: string | null;
}

export interface AdminOverviewResponse {
  users: number;
  activeUsers30d: number;
  pendingRequests: number;
  pendingInvites: number;
  aiCostMonthUsd: number;
  aiRequestsMonth: number;
  globalBudgetUsd: number | null;
  memberDefaultBudgetUsd: number | null;
}

export interface AdminUserDto {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastSeenAt: string | null;
  entryCount: number;
  aiRequestsMonth: number;
  aiCostMonthUsd: number;
  aiMonthlyBudgetUsd: number | null;
  aiBudgetUnlimited: boolean;
  effectiveBudgetUsd: number | null;
  activeSessions: number;
  isSelf: boolean;
}

export interface UpdateAdminUserRequest {
  role?: UserRole;
  status?: UserStatus;
  aiMonthlyBudgetUsd?: number | null;
  aiBudgetUnlimited?: boolean;
  name?: string | null;
}

export interface AdminAccessRequestDto {
  id: string;
  email: string;
  name: string;
  message: string | null;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByEmail: string | null;
  acceptedAt: string | null;
  hasAccount: boolean;
}

export type AdminInviteStatus = 'pending' | 'used' | 'expired' | 'revoked';

export interface AdminInviteDto {
  id: string;
  type: AuthTokenType;
  email: string;
  name: string | null;
  role: UserRole;
  status: AdminInviteStatus;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  createdByEmail: string | null;
}

export interface CreateInviteRequest {
  email: string;
  name?: string | null;
  role?: UserRole;
}

export interface InviteLinkResponse {
  invite: AdminInviteDto;
  url: string;
}

export interface AiProviderSettingsDto {
  provider: AiProviderKind;
  baseUrl: string | null;
  apiStyle: AiApiStyle;
  model: string;
  preciseModel: string;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  voiceEnabled: boolean;
  transcribeBaseUrl: string | null;
  transcribeModel: string | null;
  hasTranscribeApiKey: boolean;
  transcribeApiKeyLast4: string | null;
  updatedAt: string;
}

export interface AiProviderServerDto {
  provider: 'openai' | 'mock';
  baseUrl: string | null;
  apiStyle: AiApiStyle;
  model: string;
  preciseModel: string;
}

export interface AiProviderResponse {
  source: AiProviderSource;
  editable: boolean;
  active: boolean;
  voice: boolean;
  keyUnreadable: boolean;
  settings: AiProviderSettingsDto | null;
  server: AiProviderServerDto | null;
}

export interface UpdateAiProviderRequest {
  provider: AiProviderKind;
  baseUrl?: string | null;
  apiStyle?: AiApiStyle;
  model: string;
  preciseModel: string;
  apiKey?: string | null;
  voiceEnabled: boolean;
  transcribeBaseUrl?: string | null;
  transcribeModel?: string | null;
  transcribeApiKey?: string | null;
}

export type TestAiProviderRequest = UpdateAiProviderRequest;

export interface TestAiProviderResponse {
  ok: boolean;
  model: string | null;
  latencyMs: number | null;
  message: string;
}

export interface ProductDto {
  id: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  aliases: string[];
  unitName: string | null;
  unitGrams: number | null;
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100: Micros | null;
  servingSizeG: number | null;
  packSizeG: number | null;
  source: ProductSource;
  imageUrl: string | null;
  missingNutrients: NutrientKey[];
  useCount: number;
  lastUsedAt: string | null;
}

export interface BarcodeLookupResponse {
  barcode: string;
  source: 'library' | 'openfoodfacts' | null;
  product: ProductDto | null;
}

export interface UpsertProductRequest {
  name: string;
  brand?: string | null;
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100?: Micros | null;
  servingSizeG?: number | null;
  packSizeG?: number | null;
  source: ProductSource;
}

export interface LogProductRequest {
  grams?: number;
  servings?: number;
  timestamp: string;
  localDate: string;
  mealType: MealType;
}

export interface DraftDto {
  id: string;
  mode: AnalysisMode;
  name: string | null;
  description: string | null;
  mealType: MealType | null;
  timestamp: string;
  localDate: string;
  items: EntryItemInput[] | null;
  portion: Portion | null;
  analysisId: string | null;
  photos: AnalysisPhotoRef[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDraftFields {
  mode: AnalysisMode;
  portion?: string;
  name?: string;
  description?: string;
  mealType?: MealType;
  timestamp: string;
  localDate: string;
  analysisId?: string;
  items?: string;
  imageRoles?: string;
}

export interface UpdateDraftRequest {
  portion?: Portion | null;
  name?: string | null;
  description?: string | null;
  mealType?: MealType | null;
  timestamp?: string;
  localDate?: string;
  items?: EntryItemInput[] | null;
  analysisId?: string | null;
}

export interface LogDraftRequest {
  portion?: Portion | null;
  name: string;
  description?: string | null;
  mealType: MealType;
  timestamp: string;
  localDate: string;
  items: EntryItemInput[];
}

export interface MenuDish {
  name: string;
  description: string | null;
  grams: number;
  portion: Portion | null;
  nutrients: Nutrients;
  confidence: Confidence;
  notes: string | null;
}

export interface MenuScanFields {
  description?: string;
  imageRoles?: string;
}

export interface MenuScanResponse {
  restaurant: string | null;
  dishes: MenuDish[];
  warnings: string[];
  usage: AiUsageSummary;
}

export interface MealIdeasRequest {
  localDate: string;
  localTime: string;
  note?: string;
  exclude?: string[];
}

export interface MealIdeaPart {
  name: string;
  foodKey: string | null;
  servings: number | null;
  grams: number;
  portion: Portion | null;
  nutrients: Nutrients;
  items: EntryItemInput[];
}

export interface MealIdea {
  title: string;
  mealType: MealType;
  reason: string;
  parts: MealIdeaPart[];
  totals: Nutrients;
  grams: number;
}

export interface MealIdeasResponse {
  summary: string;
  ideas: MealIdea[];
  usage: AiUsageSummary;
}

export interface MyFoodDto extends ProductDto {
  itemCount: number;
}

export interface MyFoodsQuery {
  q?: string;
}

export interface SaveMyFoodRequest {
  name: string;
  brand?: string | null;
  aliases?: string[];
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100?: Micros | null;
  unitName?: string | null;
  unitGrams?: number | null;
  servingSizeG?: number | null;
  source?: ProductSource;
}

export interface UpdateMyFoodRequest {
  name?: string;
  brand?: string | null;
  aliases?: string[];
  basisUnit?: 'g' | 'ml';
  per100?: Nutrients;
  microsPer100?: Micros | null;
  unitName?: string | null;
  unitGrams?: number | null;
  servingSizeG?: number | null;
  applyToPast?: boolean;
}

export interface MyFoodChangeResponse {
  food: MyFoodDto;
  updatedItems: number;
  updatedEntries: number;
  updatedFavorites: number;
}

export const FOOD_VALUE_SOURCES = ['saved', 'label', 'estimate'] as const;
export type FoodValueSource = (typeof FOOD_VALUE_SOURCES)[number];

export interface FoodMergeVariant {
  name: string;
  productId: string | null;
  timesLogged: number;
  typicalGrams: number;
  lastUsedAt: string;
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100: Micros | null;
  kcalPer100Min: number;
  kcalPer100Max: number;
  valueSource: FoodValueSource;
  recommended: boolean;
}

export interface FoodMergeSuggestion {
  key: string;
  label: string;
  variants: FoodMergeVariant[];
  itemCount: number;
  entryCount: number;
  kcalPer100Min: number;
  kcalPer100Max: number;
}

export interface FoodMergeSuggestionsResponse {
  suggestions: FoodMergeSuggestion[];
}

export interface MergeFoodsRequest {
  key: string;
  names: string[];
  name: string;
  brand?: string | null;
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100?: Micros | null;
  productId?: string | null;
  keptApart?: string[];
  applyToPast: boolean;
}

export interface DismissFoodMergeRequest {
  key: string;
}

export interface FluidLogDto {
  id: string;
  localDate: string;
  timestamp: string;
  ml: number;
  kind: FluidKind;
  createdAt: string;
}

export interface CreateFluidLogRequest {
  ml: number;
  kind: FluidKind;
  timestamp: string;
  localDate: string;
}

export interface UpdateFluidLogRequest {
  ml?: number;
  kind?: FluidKind;
  timestamp?: string;
  localDate?: string;
}

export interface FluidFoodDrinkDto {
  entryId: string;
  itemId: string;
  entryName: string;
  name: string;
  ml: number;
  timestamp: string;
}

export interface FluidDayResponse {
  date: string;
  targetMl: number;
  totalMl: number;
  logsMl: number;
  foodMl: number;
  caffeineMg: number;
  logs: FluidLogDto[];
  drinks: FluidFoodDrinkDto[];
}

export const NOTE_STATUSES = ['all', 'open', 'done'] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export interface NoteDto {
  id: string;
  text: string;
  photos: PhotoRef[];
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoteListQuery {
  q?: string;
  status?: NoteStatus;
  before?: string;
  limit?: number;
}

export interface NoteListResponse {
  notes: NoteDto[];
  nextCursor: string | null;
}

export interface CreateNoteFields {
  text?: string;
}

export interface UpdateNoteRequest {
  text?: string;
  done?: boolean;
}
