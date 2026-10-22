import { resolve } from 'node:path';
import {
  ConfigValidationError,
  DEFAULT_CATALOG_FILE,
  DEFAULT_WEB_DIST_DIR,
  parseAiRateLimits,
  parseSettings,
} from './settings.js';

const DATABASE_URL = 'postgresql://food:food@localhost:5433/food?schema=public';

describe('parseSettings', () => {
  it('applies defaults for a minimal environment', () => {
    const settings = parseSettings({ DATABASE_URL });

    expect(settings).toMatchObject({
      nodeEnv: 'development',
      isProduction: false,
      port: 3000,
      host: '::',
      databaseUrl: DATABASE_URL,
      cookieSecure: false,
      jwtSecret: null,
      secretsKey: null,
      setupCode: null,
      adminEmails: [],
      appUrl: null,
      webDistDir: DEFAULT_WEB_DIST_DIR,
      ai: {
        provider: 'openai',
        apiKey: null,
        baseUrl: null,
        apiStyle: 'responses',
        voiceEnabled: true,
        transcribeBaseUrl: null,
        transcribeApiKey: null,
        model: 'gpt-5.6-sol',
        preciseModel: 'gpt-6-astra',
        transcribeModel: 'gpt-transcribe',
        reasoningEffort: 'low',
        serviceTier: 'default',
        timeoutMs: 90_000,
        rateLimitPerMinute: 6,
        rateLimitPerHour: 60,
        monthlyBudgetUsd: null,
        memberMonthlyBudgetUsd: 5,
      },
      storage: { driver: 'local', photosDir: resolve('./data/photos') },
      catalog: { autoload: true, file: DEFAULT_CATALOG_FILE },
      demo: { enabled: false, ttlHours: 24 },
      notesEnabled: false,
    });
    expect(parseSettings({ DATABASE_URL, HOST: '0.0.0.0' }).host).toBe(
      '0.0.0.0',
    );
    expect(
      parseSettings({ DATABASE_URL, NOTES_ENABLED: 'true' }).notesEnabled,
    ).toBe(true);
  });

  it('reads SECRETS_KEY and rejects one shorter than 32 characters', () => {
    const secretsKey = 'k'.repeat(40);
    expect(
      parseSettings({ DATABASE_URL, SECRETS_KEY: secretsKey }).secretsKey,
    ).toBe(secretsKey);
    expect(() => parseSettings({ DATABASE_URL, SECRETS_KEY: 'short' })).toThrow(
      /SECRETS_KEY: must be at least 32 characters/,
    );
  });

  it('normalizes ADMIN_EMAILS into a lowercase, de-duplicated list', () => {
    const settings = parseSettings({
      DATABASE_URL,
      ADMIN_EMAILS:
        ' Admin@Example.com, ,second@example.com,admin@example.com ',
    });

    expect(settings.adminEmails).toEqual([
      'admin@example.com',
      'second@example.com',
    ]);
  });

  it('reads APP_URL without trailing slashes', () => {
    expect(
      parseSettings({ DATABASE_URL, APP_URL: 'https://foodlog.example.com/' })
        .appUrl,
    ).toBe('https://foodlog.example.com');
    expect(
      parseSettings({ DATABASE_URL, APP_URL: 'http://localhost:4200' }).appUrl,
    ).toBe('http://localhost:4200');
  });

  it('turns on the demo with simulated AI and a sandbox lifetime', () => {
    const settings = parseSettings({
      DATABASE_URL,
      DEMO_MODE: 'true',
      DEMO_TTL_HOURS: '6',
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-real',
    });
    expect(settings.demo).toEqual({ enabled: true, ttlHours: 6 });
    expect(settings.ai.provider).toBe('mock');
    expect(() =>
      parseSettings({ DATABASE_URL, DEMO_TTL_HOURS: '500' }),
    ).toThrow();
  });

  it('loads the food catalog outside tests unless told otherwise', () => {
    expect(
      parseSettings({ DATABASE_URL, NODE_ENV: 'production' }).catalog,
    ).toEqual({
      autoload: true,
      file: DEFAULT_CATALOG_FILE,
    });
    expect(
      parseSettings({ DATABASE_URL, NODE_ENV: 'test' }).catalog.autoload,
    ).toBe(false);
    expect(
      parseSettings({
        DATABASE_URL,
        NODE_ENV: 'test',
        CATALOG_AUTOLOAD: 'true',
      }).catalog.autoload,
    ).toBe(true);
    expect(
      parseSettings({
        DATABASE_URL,
        CATALOG_AUTOLOAD: 'false',
        CATALOG_FILE: './foods.json.gz',
      }).catalog,
    ).toEqual({ autoload: false, file: resolve('./foods.json.gz') });
  });

  it('reads the settings for other OpenAI-compatible servers', () => {
    const ai = parseSettings({
      DATABASE_URL,
      OPENAI_API_KEY: 'ollama',
      OPENAI_BASE_URL: 'http://ollama.lan:11434/v1',
      AI_API_STYLE: 'chat',
      VOICE_ENABLED: 'false',
      TRANSCRIBE_BASE_URL: 'http://whisper.lan:8000/v1/',
      TRANSCRIBE_API_KEY: 'local',
    }).ai;
    expect(ai).toMatchObject({
      apiStyle: 'chat',
      voiceEnabled: false,
      transcribeBaseUrl: 'http://whisper.lan:8000/v1',
      transcribeApiKey: 'local',
    });
    expect(() =>
      parseSettings({ DATABASE_URL, AI_API_STYLE: 'completions' }),
    ).toThrow();
  });

  it('reads OPENAI_BASE_URL without trailing slashes and ignores a blank one', () => {
    expect(
      parseSettings({
        DATABASE_URL,
        OPENAI_BASE_URL: 'http://ollama.lan:11434/v1/',
      }).ai.baseUrl,
    ).toBe('http://ollama.lan:11434/v1');
    expect(
      parseSettings({ DATABASE_URL, OPENAI_BASE_URL: '' }).ai.baseUrl,
    ).toBeNull();
    expect(() =>
      parseSettings({ DATABASE_URL, OPENAI_BASE_URL: 'ollama:11434' }),
    ).toThrow();
  });

  it('treats an empty member budget as unlimited and an absent one as the default', () => {
    expect(
      parseSettings({ DATABASE_URL, AI_MEMBER_MONTHLY_BUDGET_USD: '' }).ai
        .memberMonthlyBudgetUsd,
    ).toBeNull();
    expect(
      parseSettings({
        DATABASE_URL,
        AI_MEMBER_MONTHLY_BUDGET_USD: ' unlimited ',
      }).ai.memberMonthlyBudgetUsd,
    ).toBeNull();
    expect(
      parseSettings({ DATABASE_URL, AI_MEMBER_MONTHLY_BUDGET_USD: '2.5' }).ai
        .memberMonthlyBudgetUsd,
    ).toBe(2.5);
    expect(
      parseSettings({ DATABASE_URL, AI_MEMBER_MONTHLY_BUDGET_USD: '0' }).ai
        .memberMonthlyBudgetUsd,
    ).toBe(0);
  });

  it('points the default web build at apps/web/dist/web/browser', () => {
    expect(DEFAULT_WEB_DIST_DIR).toBe(
      resolve(import.meta.dirname, '../../../web/dist/web/browser'),
    );
  });

  it('treats blank values as unset', () => {
    const settings = parseSettings({
      DATABASE_URL,
      JWT_SECRET: '',
      SETUP_CODE: '  ',
      OPENAI_API_KEY: '',
      AI_MONTHLY_BUDGET_USD: '',
    });

    expect(settings.jwtSecret).toBeNull();
    expect(settings.setupCode).toBeNull();
    expect(settings.ai.apiKey).toBeNull();
    expect(settings.ai.monthlyBudgetUsd).toBeNull();
  });

  it('derives secure cookies from NODE_ENV when COOKIE_SECURE is auto', () => {
    expect(
      parseSettings({ DATABASE_URL, NODE_ENV: 'production' }).cookieSecure,
    ).toBe(true);
    expect(
      parseSettings({
        DATABASE_URL,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }).cookieSecure,
    ).toBe(false);
    expect(
      parseSettings({ DATABASE_URL, COOKIE_SECURE: 'true' }).cookieSecure,
    ).toBe(true);
  });

  it('parses numeric and s3 settings', () => {
    const settings = parseSettings({
      DATABASE_URL,
      PORT: '8080',
      AI_MONTHLY_BUDGET_USD: '12.5',
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'photos',
      S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
    });

    expect(settings.port).toBe(8080);
    expect(settings.ai.monthlyBudgetUsd).toBe(12.5);
    expect(settings.storage).toEqual({
      driver: 's3',
      photosDir: resolve('./data/photos'),
      s3: {
        bucket: 'photos',
        region: 'auto',
        endpoint: 'https://example.r2.cloudflarestorage.com',
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        forcePathStyle: true,
      },
    });
  });

  it.each([
    [{ DATABASE_URL: 'mysql://nope' }, 'DATABASE_URL'],
    [
      { DATABASE_URL, JWT_SECRET: 'too-short' },
      'JWT_SECRET: must be at least 32 characters',
    ],
    [
      { DATABASE_URL, STORAGE_DRIVER: 's3' },
      'S3_BUCKET: is required when STORAGE_DRIVER=s3',
    ],
    [{ DATABASE_URL, S3_ACCESS_KEY_ID: 'key' }, 'S3_SECRET_ACCESS_KEY'],
    [{ DATABASE_URL, AI_PROVIDER: 'anthropic' }, 'AI_PROVIDER'],
    [{ DATABASE_URL, PORT: 'eighty' }, 'PORT'],
    [{ DATABASE_URL, COOKIE_SECURE: 'yes' }, 'COOKIE_SECURE'],
    [{ DATABASE_URL, ADMIN_EMAILS: 'owner@example.com,nope' }, 'ADMIN_EMAILS'],
    [{ DATABASE_URL, APP_URL: 'foodlog.example.com' }, 'APP_URL'],
    [{ DATABASE_URL, APP_URL: 'ftp://foodlog.example.com' }, 'APP_URL'],
    [{ DATABASE_URL, APP_URL: 'https://foodlog.example.com/?a=1' }, 'APP_URL'],
    [
      { DATABASE_URL, AI_MEMBER_MONTHLY_BUDGET_USD: '-1' },
      'AI_MEMBER_MONTHLY_BUDGET_USD',
    ],
    [
      { DATABASE_URL, AI_MEMBER_MONTHLY_BUDGET_USD: 'lots' },
      'AI_MEMBER_MONTHLY_BUDGET_USD',
    ],
    [{}, 'DATABASE_URL'],
  ])('rejects invalid configuration %#', (env, expected) => {
    expect(() => parseSettings(env)).toThrow(ConfigValidationError);
    expect(() => parseSettings(env)).toThrow(expected);
  });
});

describe('parseAiRateLimits', () => {
  it('reads the AI rate limits without requiring the rest of the config', () => {
    expect(parseAiRateLimits({})).toEqual({ perMinute: 6, perHour: 60 });
    expect(
      parseAiRateLimits({
        AI_RATE_LIMIT_PER_MINUTE: '2',
        AI_RATE_LIMIT_PER_HOUR: '20',
      }),
    ).toEqual({ perMinute: 2, perHour: 20 });
  });

  it('rejects non-positive limits', () => {
    expect(() => parseAiRateLimits({ AI_RATE_LIMIT_PER_MINUTE: '0' })).toThrow(
      'AI_RATE_LIMIT_PER_MINUTE',
    );
  });
});
