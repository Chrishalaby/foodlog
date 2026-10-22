import { randomUUID } from 'node:crypto';
import type { UserDto, UserRole, UserStatus } from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { SESSION_COOKIE } from '../src/auth/auth.constants.js';
import { hashPassword } from '../src/auth/passwords.js';
import { SessionsService } from '../src/auth/sessions.service.js';
import { AppConfig } from '../src/config/app-config.js';
import { type AppSettings, parseSettings } from '../src/config/settings.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { E2E_SETUP_CODE } from './e2e-environment.js';

export type TestAgent = ReturnType<typeof request.agent>;

export interface TestCredentials {
  email: string;
  password: string;
}

export interface TestAppOptions {
  throttling?: boolean;
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export interface TestUserOptions {
  email?: string;
  password?: string;
  name?: string | null;
  role?: UserRole;
  status?: UserStatus;
  aiMonthlyBudgetUsd?: number | null;
  aiBudgetUnlimited?: boolean;
}

export interface TestUser extends UserDto {
  password: string;
}

export interface SignedInTestUser {
  user: TestUser;
  agent: TestAgent;
  cookie: string;
}

export const TEST_CREDENTIALS: TestCredentials = {
  email: 'owner@example.com',
  password: 'correct horse battery staple',
};

export const TEST_MEMBER_PASSWORD = 'member password 1234';

const EXCLUDED_TABLES = ['_prisma_migrations', 'AppSecret'];

const unlimitedThrottlerStorage: ThrottlerStorage = {
  increment: () =>
    Promise.resolve({
      totalHits: 1,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
};

export async function createTestApp(
  options: TestAppOptions = {},
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!options.throttling) {
    builder = builder
      .overrideProvider(ThrottlerStorage)
      .useValue(unlimitedThrottlerStorage);
  }
  if (options.configure) {
    builder = options.configure(builder);
  }
  const moduleRef = await builder.compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestExpressApplication>({
      logger: ['error', 'warn'],
      bodyParser: false,
    }),
  );
  await app.init();
  await app.listen(0, '127.0.0.1');
  return app;
}

export function withSettings(
  overrides: Partial<AppSettings>,
): (builder: TestingModuleBuilder) => TestingModuleBuilder {
  const config = new AppConfig({
    ...parseSettings(process.env),
    ...overrides,
  });
  return (builder) => builder.overrideProvider(AppConfig).useValue(config);
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema()`;
  const names = tables
    .map(({ tablename }) => tablename)
    .filter((name) => !EXCLUDED_TABLES.includes(name))
    .map((name) => `"${name.replaceAll('"', '""')}"`);
  if (names.length > 0) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
}

export async function setupAndLogin(
  app: NestExpressApplication,
  credentials: TestCredentials = TEST_CREDENTIALS,
): Promise<TestAgent> {
  const agent = request.agent(app.getHttpServer());
  await agent
    .post('/api/auth/setup')
    .send({
      ...credentials,
      setupCode: process.env.SETUP_CODE ?? E2E_SETUP_CODE,
    })
    .expect(201);
  return agent;
}

export function getTestUser(app: NestExpressApplication): Promise<UserDto> {
  return app.get(PrismaService).user.findFirstOrThrow({
    select: { id: true, email: true, name: true, role: true },
    orderBy: { createdAt: 'asc' },
  });
}

export function sessionCookieFromResponse(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const cookie = header?.find((value) =>
    value.startsWith(`${SESSION_COOKIE}=`),
  );
  return cookie?.split(';')[0] ?? '';
}

export async function sessionCookieFor(
  app: NestExpressApplication,
  userId: string,
  userAgent = 'e2e-test',
): Promise<string> {
  const token = await app.get(SessionsService).create(userId, userAgent);
  return `${SESSION_COOKIE}=${token}`;
}

export async function createTestUser(
  app: NestExpressApplication,
  options: TestUserOptions = {},
): Promise<TestUser> {
  const password = options.password ?? TEST_MEMBER_PASSWORD;
  const user = await app.get(PrismaService).user.create({
    data: {
      email: options.email ?? `member-${randomUUID()}@example.com`,
      passwordHash: await hashPassword(password),
      name: options.name ?? null,
      role: options.role ?? 'member',
      status: options.status ?? 'active',
      aiMonthlyBudgetUsd: options.aiMonthlyBudgetUsd ?? null,
      aiBudgetUnlimited: options.aiBudgetUnlimited ?? false,
      profile: { create: {} },
    },
    select: { id: true, email: true, name: true, role: true },
  });
  return { ...user, password };
}

export async function signInAgent(
  app: NestExpressApplication,
  credentials: TestCredentials,
): Promise<{ agent: TestAgent; cookie: string }> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent
    .post('/api/auth/login')
    .send(credentials)
    .expect(200);
  return { agent, cookie: sessionCookieFromResponse(response) };
}

export async function createSignedInUser(
  app: NestExpressApplication,
  options: TestUserOptions = {},
): Promise<SignedInTestUser> {
  const user = await createTestUser(app, options);
  const { agent, cookie } = await signInAgent(app, {
    email: user.email,
    password: user.password,
  });
  return { user, agent, cookie };
}
