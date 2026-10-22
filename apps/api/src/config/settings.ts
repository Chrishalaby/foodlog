import { resolve } from 'node:path';
import type { ServiceTier } from 'openai/resources/responses/responses';
import type { ReasoningEffort } from 'openai/resources/shared';
import { z } from 'zod';
import type { EnvRecord } from './env-files.js';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export const AI_PROVIDERS = ['openai', 'mock'] as const;
export const AI_API_STYLES = ['responses', 'chat'] as const;
export const STORAGE_DRIVERS = ['local', 's3'] as const;
export const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly NonNullable<ReasoningEffort>[];
export const SERVICE_TIERS = [
  'auto',
  'default',
  'flex',
  'scale',
  'priority',
  'fast',
  'ultrafast',
] as const satisfies readonly NonNullable<ServiceTier>[];

export type NodeEnv = (typeof NODE_ENVS)[number];
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];
export type ReasoningEffortSetting = (typeof REASONING_EFFORTS)[number];
export type ServiceTierSetting = (typeof SERVICE_TIERS)[number];

export interface AiSettings {
  provider: AiProvider;
  apiKey: string | null;
  baseUrl: string | null;
  apiStyle: (typeof AI_API_STYLES)[number];
  voiceEnabled: boolean;
  transcribeBaseUrl: string | null;
  transcribeApiKey: string | null;
  model: string;
  preciseModel: string;
  transcribeModel: string;
  reasoningEffort: ReasoningEffortSetting;
  serviceTier: ServiceTierSetting;
  timeoutMs: number;
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  monthlyBudgetUsd: number | null;
  memberMonthlyBudgetUsd: number | null;
}

export interface S3Settings {
  bucket: string;
  region: string;
  endpoint: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  forcePathStyle: boolean;
}

export type StorageSettings =
  | { driver: 'local'; photosDir: string }
  | { driver: 's3'; photosDir: string; s3: S3Settings };

export interface DemoSettings {
  enabled: boolean;
  ttlHours: number;
}

export interface CatalogSettings {
  autoload: boolean;
  file: string;
}

export interface AppSettings {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  port: number;
  host: string;
  databaseUrl: string;
  cookieSecure: boolean;
  jwtSecret: string | null;
  setupCode: string | null;
  adminEmails: readonly string[];
  appUrl: string | null;
  webDistDir: string;
  ai: AiSettings;
  storage: StorageSettings;
  catalog: CatalogSettings;
  demo: DemoSettings;
  notesEnabled: boolean;
}

export interface AiRateLimits {
  perMinute: number;
  perHour: number;
}

export const DEFAULT_WEB_DIST_DIR = resolve(
  import.meta.dirname,
  '../../../web/dist/web/browser',
);

export const DEFAULT_CATALOG_FILE = resolve(
  import.meta.dirname,
  '../../catalog/usda-foods.json.gz',
);

export const DEFAULT_MEMBER_MONTHLY_BUDGET_USD = 5;
const MEMBER_BUDGET_KEY = 'AI_MEMBER_MONTHLY_BUDGET_USD';
const UNLIMITED_BUDGET = 'unlimited';

const positiveInt = z.coerce.number().int().min(1);
const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export function parseEmailList(value: string): string[] {
  const emails = value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== '');
  return [...new Set(emails)];
}

const emailList = z
  .string()
  .refine(
    (value) =>
      parseEmailList(value).every(
        (email) => z.email().safeParse(email).success,
      ),
    'must be a comma-separated list of email addresses',
  )
  .transform(parseEmailList);

const appUrl = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = URL.parse(value);
    return url !== null && url.search === '' && url.hash === '';
  }, 'must be an absolute http(s) URL without a query or fragment')
  .transform((value) => value.replace(/\/+$/, ''));

const memberBudget = z
  .union([
    z.literal(UNLIMITED_BUDGET).transform(() => null),
    z.coerce.number().min(0),
  ])
  .default(DEFAULT_MEMBER_MONTHLY_BUDGET_USD);

const envShape = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().trim().min(1).max(255).default('::'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection URL'),
  COOKIE_SECURE: z.enum(['true', 'false', 'auto']).default('auto'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  SETUP_CODE: z.string().max(200).optional(),
  ADMIN_EMAILS: emailList.optional(),
  APP_URL: appUrl.optional(),
  WEB_DIST_DIR: z.string().optional(),
  AI_PROVIDER: z.enum(AI_PROVIDERS).default('openai'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
  AI_API_STYLE: z.enum(AI_API_STYLES).default('responses'),
  VOICE_ENABLED: booleanFlag.default(true),
  TRANSCRIBE_BASE_URL: z
    .url({ protocol: /^https?$/ })
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
  TRANSCRIBE_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.6-sol'),
  OPENAI_PRECISE_MODEL: z.string().default('gpt-6-astra'),
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-transcribe'),
  OPENAI_REASONING_EFFORT: z.enum(REASONING_EFFORTS).default('low'),
  OPENAI_SERVICE_TIER: z.enum(SERVICE_TIERS).default('default'),
  OPENAI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .default(90_000),
  AI_RATE_LIMIT_PER_MINUTE: positiveInt.default(6),
  AI_RATE_LIMIT_PER_HOUR: positiveInt.default(60),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().min(0).optional(),
  AI_MEMBER_MONTHLY_BUDGET_USD: memberBudget,
  NOTES_ENABLED: booleanFlag.default(false),
  DEMO_MODE: booleanFlag.default(false),
  DEMO_TTL_HOURS: positiveInt.max(168).default(24),
  CATALOG_AUTOLOAD: booleanFlag.optional(),
  CATALOG_FILE: z.string().optional(),
  STORAGE_DRIVER: z.enum(STORAGE_DRIVERS).default('local'),
  PHOTOS_DIR: z.string().default('./data/photos'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanFlag.default(false),
});

type Env = z.infer<typeof envShape>;

const envSchema = envShape.superRefine((env, ctx) => {
  if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_BUCKET'],
      message: 'is required when STORAGE_DRIVER=s3',
    });
  }
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['S3_SECRET_ACCESS_KEY'],
      message: 'S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together',
    });
  }
});

const rateLimitSchema = envShape.pick({
  AI_RATE_LIMIT_PER_MINUTE: true,
  AI_RATE_LIMIT_PER_HOUR: true,
});

export class ConfigValidationError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

export function parseSettings(env: EnvRecord): AppSettings {
  return toSettings(parseEnv(envSchema, env));
}

export function parseAiRateLimits(env: EnvRecord): AiRateLimits {
  const parsed = parseEnv(rateLimitSchema, env);
  return {
    perMinute: parsed.AI_RATE_LIMIT_PER_MINUTE,
    perHour: parsed.AI_RATE_LIMIT_PER_HOUR,
  };
}

function parseEnv<T extends z.ZodType>(schema: T, env: EnvRecord): z.output<T> {
  const result = schema.safeParse(prepareEnv(env));
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  return result.data;
}

function withoutBlankValues(env: EnvRecord): Record<string, string> {
  const entries = Object.entries(env)
    .map(([key, value]) => [key, value?.trim() ?? ''] as const)
    .filter(([, value]) => value !== '');
  return Object.fromEntries(entries);
}

function prepareEnv(env: EnvRecord): Record<string, string> {
  const prepared = withoutBlankValues(env);
  const memberBudgetValue = env[MEMBER_BUDGET_KEY];
  if (memberBudgetValue !== undefined && memberBudgetValue.trim() === '') {
    prepared[MEMBER_BUDGET_KEY] = UNLIMITED_BUDGET;
  }
  return prepared;
}

function toSettings(env: Env): AppSettings {
  const isProduction = env.NODE_ENV === 'production';
  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    host: env.HOST,
    databaseUrl: env.DATABASE_URL,
    cookieSecure:
      env.COOKIE_SECURE === 'auto'
        ? isProduction
        : env.COOKIE_SECURE === 'true',
    jwtSecret: env.JWT_SECRET ?? null,
    setupCode: env.SETUP_CODE ?? null,
    adminEmails: env.ADMIN_EMAILS ?? [],
    appUrl: env.APP_URL ?? null,
    webDistDir: env.WEB_DIST_DIR
      ? resolve(env.WEB_DIST_DIR)
      : DEFAULT_WEB_DIST_DIR,
    ai: toAiSettings(env),
    storage: toStorageSettings(env),
    demo: { enabled: env.DEMO_MODE, ttlHours: env.DEMO_TTL_HOURS },
    notesEnabled: env.NOTES_ENABLED,
    catalog: {
      autoload: env.CATALOG_AUTOLOAD ?? env.NODE_ENV !== 'test',
      file: env.CATALOG_FILE ? resolve(env.CATALOG_FILE) : DEFAULT_CATALOG_FILE,
    },
  };
}

function toAiSettings(env: Env): AiSettings {
  return {
    provider: env.DEMO_MODE ? 'mock' : env.AI_PROVIDER,
    apiKey: env.OPENAI_API_KEY ?? null,
    baseUrl: env.OPENAI_BASE_URL ?? null,
    apiStyle: env.AI_API_STYLE,
    voiceEnabled: env.VOICE_ENABLED,
    transcribeBaseUrl: env.TRANSCRIBE_BASE_URL ?? null,
    transcribeApiKey: env.TRANSCRIBE_API_KEY ?? null,
    model: env.OPENAI_MODEL,
    preciseModel: env.OPENAI_PRECISE_MODEL,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL,
    reasoningEffort: env.OPENAI_REASONING_EFFORT,
    serviceTier: env.OPENAI_SERVICE_TIER,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    rateLimitPerMinute: env.AI_RATE_LIMIT_PER_MINUTE,
    rateLimitPerHour: env.AI_RATE_LIMIT_PER_HOUR,
    monthlyBudgetUsd: env.AI_MONTHLY_BUDGET_USD ?? null,
    memberMonthlyBudgetUsd: env.AI_MEMBER_MONTHLY_BUDGET_USD,
  };
}

function toStorageSettings(env: Env): StorageSettings {
  const photosDir = resolve(process.cwd(), env.PHOTOS_DIR);
  if (env.STORAGE_DRIVER === 'local') {
    return { driver: 'local', photosDir };
  }
  return {
    driver: 's3',
    photosDir,
    s3: {
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT ?? null,
      accessKeyId: env.S3_ACCESS_KEY_ID ?? null,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? null,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
  };
}
