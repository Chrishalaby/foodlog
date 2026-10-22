import {
  API_LIMITS,
  computeBodyMetrics,
  computeTargets,
  type ProfileDto,
  type ProfileResponse,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppConfig } from '../src/config/app-config.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const DEFAULT_PROFILE: ProfileDto = {
  weightKg: null,
  heightCm: null,
  age: null,
  sex: null,
  bodyFatPct: null,
  tdeeOverride: null,
  onboarded: false,
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 0,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
  dayStartHour: 3,
  fluidTargetMl: null,
};

const COMPLETE_PROFILE: ProfileDto = {
  ...DEFAULT_PROFILE,
  weightKg: 82.5,
  heightCm: 181,
  age: 34,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 4,
  location: 'Berlin, Germany',
  theme: 'system',
};

function withoutBodyFields(profile: ProfileDto): ProfileDto {
  const {
    bodyFatPct: _bodyFatPct,
    tdeeOverride: _tdeeOverride,
    onboarded: _onboarded,
    dayStartHour: _dayStartHour,
    fluidTargetMl: _fluidTargetMl,
    ...rest
  } = profile;
  return rest;
}

function messages(body: unknown): string[] {
  const message = (body as { message?: unknown }).message;
  return Array.isArray(message) ? message.map(String) : [String(message)];
}

describe('profile (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  beforeEach(async () => {
    await prisma.profile.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function putProfile(
    profile: object,
    status = 200,
  ): Promise<request.Response> {
    return agent.put('/api/profile').send(profile).expect(status);
  }

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/profile').expect(401);
    await request(app.getHttpServer())
      .put('/api/profile')
      .send(COMPLETE_PROFILE)
      .expect(401);
  });

  it('creates the default profile on first read and reuses it afterwards', async () => {
    const first = await agent.get('/api/profile').expect(200);
    const body = first.body as ProfileResponse;

    expect(body.profile).toEqual(DEFAULT_PROFILE);
    expect(body.targets).toEqual(computeTargets(DEFAULT_PROFILE));
    expect(body.body).toEqual(computeBodyMetrics(DEFAULT_PROFILE));
    expect(body.body.bmi).toBeNull();
    expect(body.targets.complete).toBe(false);
    expect(body.targets.warnings[0]).toContain('Profile incomplete');
    expect(body.ai).toMatchObject({
      provider: 'mock',
      activeModel: body.ai.defaultModel,
    });
    expect(body.ai.availableModels.length).toBeGreaterThan(0);

    await agent.get('/api/profile').expect(200);
    await expect(prisma.profile.count({ where: { userId } })).resolves.toBe(1);
  });

  it('serves concurrent first reads without conflicts', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => agent.get('/api/profile')),
    );
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200,
    ]);
    await expect(prisma.profile.count({ where: { userId } })).resolves.toBe(1);
  });

  it('upserts the full profile and returns targets computed from it', async () => {
    const response = await putProfile(COMPLETE_PROFILE);
    const body = response.body as ProfileResponse;

    expect(body.profile).toEqual(COMPLETE_PROFILE);
    expect(body.targets).toEqual(computeTargets(COMPLETE_PROFILE));
    expect(body.targets.complete).toBe(true);
    expect(body.targets.bmr).toBeGreaterThan(1500);
    expect(body.targets).toMatchObject({
      bmrFormula: 'mifflin_st_jeor',
      tdeeSource: 'formula',
    });
    expect(body.body).toEqual(computeBodyMetrics(COMPLETE_PROFILE));

    const stored = await agent.get('/api/profile').expect(200);
    expect((stored.body as ProfileResponse).profile).toEqual(COMPLETE_PROFILE);
  });

  it('changes targets when the goal and training days change', async () => {
    const maintain = (await putProfile(COMPLETE_PROFILE))
      .body as ProfileResponse;
    const cut = (await putProfile({ ...COMPLETE_PROFILE, goal: 'cut' }))
      .body as ProfileResponse;
    const noTraining = (
      await putProfile({ ...COMPLETE_PROFILE, trainingDaysPerWeek: 0 })
    ).body as ProfileResponse;

    expect(cut.targets.base.calories).toBeLessThan(
      maintain.targets.base.calories,
    );
    expect(cut.targets.base.protein).toBeGreaterThan(
      maintain.targets.base.protein,
    );
    expect(maintain.targets.restDeltaKcal).toBeLessThan(0);
    expect(noTraining.targets.restDeltaKcal).toBe(0);
    expect(noTraining.targets.trainingDeltaKcal).toBeGreaterThan(0);
  });

  it('accepts a profile without the optional body fields and returns their defaults', async () => {
    const response = await putProfile(withoutBodyFields(COMPLETE_PROFILE));
    expect((response.body as ProfileResponse).profile).toEqual(
      COMPLETE_PROFILE,
    );
  });

  it('stores body fat and the burn override and keeps them when absent', async () => {
    const saved = await putProfile({
      ...COMPLETE_PROFILE,
      bodyFatPct: 18.5,
      tdeeOverride: 2700,
    });
    expect((saved.body as ProfileResponse).profile).toMatchObject({
      bodyFatPct: 18.5,
      tdeeOverride: 2700,
    });

    const merged = await putProfile({
      ...withoutBodyFields(COMPLETE_PROFILE),
      goal: 'cut',
    });
    expect((merged.body as ProfileResponse).profile).toMatchObject({
      goal: 'cut',
      bodyFatPct: 18.5,
      tdeeOverride: 2700,
    });

    const cleared = await putProfile({
      ...COMPLETE_PROFILE,
      bodyFatPct: null,
      tdeeOverride: null,
    });
    expect((cleared.body as ProfileResponse).profile).toMatchObject({
      bodyFatPct: null,
      tdeeOverride: null,
    });
    const row = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(row).toMatchObject({ bodyFatPct: null, tdeeOverride: null });
  });

  it('stores the day start and fluids target and keeps them when a client omits them', async () => {
    const saved = await putProfile({
      ...COMPLETE_PROFILE,
      dayStartHour: 1,
      fluidTargetMl: 3200,
    });
    expect((saved.body as ProfileResponse).profile).toMatchObject({
      dayStartHour: 1,
      fluidTargetMl: 3200,
    });
    const read = await agent.get('/api/profile').expect(200);
    expect((read.body as ProfileResponse).profile).toEqual({
      ...COMPLETE_PROFILE,
      dayStartHour: 1,
      fluidTargetMl: 3200,
    });

    const older = await putProfile({
      ...withoutBodyFields(COMPLETE_PROFILE),
      goal: 'cut',
    });
    expect((older.body as ProfileResponse).profile).toMatchObject({
      goal: 'cut',
      dayStartHour: 1,
      fluidTargetMl: 3200,
    });

    const { dayStartHour: _dayStartHour, ...withoutDayStart } =
      COMPLETE_PROFILE;
    const automatic = await putProfile({
      ...withoutDayStart,
      fluidTargetMl: null,
    });
    expect((automatic.body as ProfileResponse).profile).toMatchObject({
      dayStartHour: 1,
      fluidTargetMl: null,
    });
    await expect(
      prisma.profile.findUniqueOrThrow({ where: { userId } }),
    ).resolves.toMatchObject({ dayStartHour: 1, fluidTargetMl: null });
  });

  it('saves the day start chosen during onboarding on a new profile', async () => {
    const response = await putProfile({
      ...COMPLETE_PROFILE,
      onboarded: true,
      dayStartHour: 0,
      fluidTargetMl: 2500,
    });

    expect((response.body as ProfileResponse).profile).toMatchObject({
      onboarded: true,
      dayStartHour: 0,
      fluidTargetMl: 2500,
    });
    await expect(
      prisma.profile.findUniqueOrThrow({ where: { userId } }),
    ).resolves.toMatchObject({ dayStartHour: 0, fluidTargetMl: 2500 });
  });

  it('marks the profile as onboarded once and never un-marks it', async () => {
    await agent.get('/api/profile').expect(200);
    const before = Date.now();
    const onboarded = await putProfile({
      ...COMPLETE_PROFILE,
      onboarded: true,
    });
    const after = Date.now();
    expect((onboarded.body as ProfileResponse).profile.onboarded).toBe(true);
    const first = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(first.onboardedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(first.onboardedAt?.getTime()).toBeLessThanOrEqual(after);

    await putProfile({ ...COMPLETE_PROFILE, onboarded: true });
    const falseResponse = await putProfile({
      ...COMPLETE_PROFILE,
      onboarded: false,
    });
    const absentResponse = await putProfile(
      withoutBodyFields(COMPLETE_PROFILE),
    );
    expect((falseResponse.body as ProfileResponse).profile.onboarded).toBe(
      true,
    );
    expect((absentResponse.body as ProfileResponse).profile.onboarded).toBe(
      true,
    );
    const last = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(last.onboardedAt).toEqual(first.onboardedAt);
  });

  it('creates a new profile as onboarded when onboarding finishes first', async () => {
    const response = await putProfile({ ...COMPLETE_PROFILE, onboarded: true });
    expect((response.body as ProfileResponse).profile.onboarded).toBe(true);
    const row = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(row.onboardedAt).toBeInstanceOf(Date);
  });

  it('switches to Katch-McArdle when body fat is known', async () => {
    const withBodyFat: ProfileDto = { ...COMPLETE_PROFILE, bodyFatPct: 15 };
    const mifflin = (await putProfile(COMPLETE_PROFILE))
      .body as ProfileResponse;
    const katch = (await putProfile(withBodyFat)).body as ProfileResponse;

    expect(katch.targets).toEqual(computeTargets(withBodyFat));
    expect(katch.targets.bmrFormula).toBe('katch_mcardle');
    const katchBmr = 370 + 21.6 * 82.5 * 0.85;
    expect(katch.targets.bmr).toBe(Math.round(katchBmr));
    expect(katch.targets.tdee).toBe(Math.round(katchBmr * 1.55));
    expect(katch.targets.bmr).not.toBe(mifflin.targets.bmr);
    expect(katch.targets.base.calories).not.toBe(mifflin.targets.base.calories);
  });

  it('uses the burn override instead of the formula TDEE', async () => {
    const overridden: ProfileDto = {
      ...COMPLETE_PROFILE,
      goal: 'cut',
      tdeeOverride: 3000,
    };
    const response = (await putProfile(overridden)).body as ProfileResponse;

    expect(response.targets).toEqual(computeTargets(overridden));
    expect(response.targets).toMatchObject({
      tdee: 3000,
      tdeeSource: 'override',
      bmrFormula: 'mifflin_st_jeor',
      complete: true,
    });
    expect(response.targets.base.calories).toBe(2400);

    const incomplete: ProfileDto = {
      ...DEFAULT_PROFILE,
      weightKg: 70,
      tdeeOverride: 2200,
    };
    const partial = (await putProfile(incomplete)).body as ProfileResponse;
    expect(partial.targets).toMatchObject({
      bmr: null,
      tdee: 2200,
      tdeeSource: 'override',
      complete: true,
    });
    expect(partial.targets.base.calories).toBe(2200);
  });

  it('returns BMI and FFMI body metrics', async () => {
    const lean: ProfileDto = { ...COMPLETE_PROFILE, bodyFatPct: 15 };
    const response = (await putProfile(lean)).body as ProfileResponse;

    expect(response.body).toEqual(computeBodyMetrics(lean));
    expect(response.body).toEqual({
      bmi: 25.2,
      bmiCategory: 'overweight',
      leanMassKg: 70.1,
      fatMassKg: 12.4,
      ffmi: 21.4,
      ffmiNormalized: 21.3,
      ffmiCategory: 'above_average',
    });

    const withoutFat = (await putProfile(COMPLETE_PROFILE))
      .body as ProfileResponse;
    expect(withoutFat.body).toMatchObject({
      bmi: 25.2,
      leanMassKg: null,
      ffmi: null,
      ffmiCategory: null,
    });
  });

  it('applies target overrides, treating null as automatic', async () => {
    const response = await putProfile({
      ...COMPLETE_PROFILE,
      targetOverrides: { calories: 2600, protein: 190.26, sodiumMax: null },
    });
    const body = response.body as ProfileResponse;

    expect(body.profile.targetOverrides).toEqual({
      calories: 2600,
      protein: 190.3,
    });
    expect(body.targets.base.calories).toBe(2600);
    expect(body.targets.base.protein).toBe(190.3);
    expect(body.targets.base.sodiumMax).toBe(2300);
    const row = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(row.targetOverrides).toEqual({ calories: 2600, protein: 190.3 });
  });

  it('trims the location and stores blank strings as null', async () => {
    const trimmed = await putProfile({
      ...COMPLETE_PROFILE,
      location: '  Lisbon  ',
      aiModel: '   ',
    });
    expect((trimmed.body as ProfileResponse).profile).toMatchObject({
      location: 'Lisbon',
      aiModel: null,
    });

    const blank = await putProfile({ ...COMPLETE_PROFILE, location: '   ' });
    expect((blank.body as ProfileResponse).profile.location).toBeNull();
  });

  it('accepts a selectable AI model and reflects it as the active model', async () => {
    const response = await putProfile({
      ...COMPLETE_PROFILE,
      aiModel: 'gpt-6-sol',
      aiDetailFood: 'low',
      aiDetailLabel: 'high',
    });
    const body = response.body as ProfileResponse;
    expect(body.profile).toMatchObject({
      aiModel: 'gpt-6-sol',
      aiDetailFood: 'low',
      aiDetailLabel: 'high',
    });
    expect(body.ai.activeModel).toBe('gpt-6-sol');
  });

  it('stores the canonical id when the AI model is given as an alias or dated snapshot', async () => {
    const alias = await putProfile({ ...COMPLETE_PROFILE, aiModel: 'gpt-5.6' });
    expect((alias.body as ProfileResponse).profile.aiModel).toBe('gpt-5.6-sol');

    const dated = await putProfile({
      ...COMPLETE_PROFILE,
      aiModel: ' gpt-6-sol-2026-05-01 ',
    });
    expect((dated.body as ProfileResponse).profile.aiModel).toBe('gpt-6-sol');
    const row = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(row.aiModel).toBe('gpt-6-sol');
  });

  it('reports a stored model that is no longer selectable as the default so the profile can be saved again', async () => {
    await prisma.profile.create({ data: { userId, aiModel: 'gpt-4.1' } });

    const read = (await agent.get('/api/profile').expect(200))
      .body as ProfileResponse;
    expect(read.profile.aiModel).toBeNull();
    expect(read.ai.activeModel).toBe(read.ai.defaultModel);

    const saved = await putProfile({ ...read.profile, theme: 'light' });
    expect((saved.body as ProfileResponse).profile).toMatchObject({
      aiModel: null,
      theme: 'light',
    });
  });

  it('reports the caller’s own effective AI budget', async () => {
    const memberDefault = app.get(AppConfig).ai.memberMonthlyBudgetUsd;
    const member = await createSignedInUser(app);
    const budgetOf = async (target: TestAgent): Promise<number | null> =>
      ((await target.get('/api/profile').expect(200)).body as ProfileResponse)
        .ai.monthlyBudgetUsd;
    const setBudget = async (id: string, body: object): Promise<void> => {
      await agent.patch(`/api/admin/users/${id}`).send(body).expect(200);
    };

    try {
      await expect(budgetOf(agent)).resolves.toBeNull();
      await expect(budgetOf(member.agent)).resolves.toBe(memberDefault);

      await setBudget(member.user.id, { aiMonthlyBudgetUsd: 7.5 });
      await setBudget(userId, { aiMonthlyBudgetUsd: 30 });
      await expect(budgetOf(member.agent)).resolves.toBe(7.5);
      await expect(budgetOf(agent)).resolves.toBe(30);
      const saved = await member.agent
        .put('/api/profile')
        .send(COMPLETE_PROFILE)
        .expect(200);
      expect((saved.body as ProfileResponse).ai.monthlyBudgetUsd).toBe(7.5);

      await setBudget(member.user.id, { aiBudgetUnlimited: true });
      await expect(budgetOf(member.agent)).resolves.toBeNull();
    } finally {
      await setBudget(userId, { aiMonthlyBudgetUsd: null });
      await prisma.user.delete({ where: { id: member.user.id } });
    }
  });

  it('rejects unknown or non-selectable AI models', async () => {
    const unknown = await putProfile(
      { ...COMPLETE_PROFILE, aiModel: 'gpt-99-ultra' },
      400,
    );
    expect(messages(unknown.body)[0]).toContain(
      'aiModel must be null or one of',
    );

    await putProfile({ ...COMPLETE_PROFILE, aiModel: 'gpt-4.1' }, 400);
    await expect(prisma.profile.count()).resolves.toBe(0);
  });

  it('rejects unknown target override keys and out-of-range overrides', async () => {
    const unknownKey = await putProfile(
      { ...COMPLETE_PROFILE, targetOverrides: { vitaminC: 90 } },
      400,
    );
    expect(messages(unknownKey.body)).toContain(
      'targetOverrides.vitaminC is not a known target',
    );

    const outOfRange = await putProfile(
      { ...COMPLETE_PROFILE, targetOverrides: { calories: 500 } },
      400,
    );
    expect(messages(outOfRange.body)).toContain(
      'targetOverrides.calories must be a number between 800 and 8000, or null',
    );

    await putProfile(
      { ...COMPLETE_PROFILE, targetOverrides: { protein: '150' } },
      400,
    );
    await putProfile({ ...COMPLETE_PROFILE, targetOverrides: [2000] }, 400);
    await putProfile({ ...COMPLETE_PROFILE, targetOverrides: null }, 400);
  });

  it.each([
    ['weightKg below range', { weightKg: 24.9 }],
    ['weightKg above range', { weightKg: 400.1 }],
    ['heightCm below range', { heightCm: 99 }],
    ['bodyFatPct below range', { bodyFatPct: 2.9 }],
    ['bodyFatPct above range', { bodyFatPct: 70.1 }],
    ['non-numeric bodyFatPct', { bodyFatPct: '20' }],
    ['tdeeOverride below range', { tdeeOverride: 799 }],
    ['tdeeOverride above range', { tdeeOverride: 8001 }],
    ['fractional tdeeOverride', { tdeeOverride: 2500.5 }],
    ['null onboarded', { onboarded: null }],
    ['non-boolean onboarded', { onboarded: 'yes' }],
    ['heightCm above range', { heightCm: 251 }],
    ['fractional age', { age: 30.5 }],
    ['age below range', { age: 12 }],
    ['age above range', { age: 101 }],
    ['unknown sex', { sex: 'other' }],
    ['unknown activity level', { activityLevel: 'couch' }],
    ['unknown goal', { goal: 'shred' }],
    ['training days above 7', { trainingDaysPerWeek: 8 }],
    ['fractional training days', { trainingDaysPerWeek: 2.5 }],
    ['negative training days', { trainingDaysPerWeek: -1 }],
    ['location too long', { location: 'x'.repeat(API_LIMITS.locationMax + 1) }],
    ['non-string location', { location: 42 }],
    ['unknown image detail', { aiDetailFood: 'medium' }],
    ['unknown theme', { theme: 'neon' }],
    ['numeric strings', { weightKg: '80' }],
    ['unknown property', { favouriteColour: 'green' }],
    ['day start before midnight', { dayStartHour: -1 }],
    ['day start after 6 am', { dayStartHour: 7 }],
    ['fractional day start', { dayStartHour: 2.5 }],
    ['text day start', { dayStartHour: '3' }],
    ['null day start', { dayStartHour: null }],
    ['fluids target below range', { fluidTargetMl: 499 }],
    ['fluids target above range', { fluidTargetMl: 8001 }],
    ['fractional fluids target', { fluidTargetMl: 2500.5 }],
    ['text fluids target', { fluidTargetMl: '2500' }],
  ])('rejects %s with 400', async (_label, patch) => {
    await putProfile({ ...COMPLETE_PROFILE, ...patch }, 400);
  });

  it('requires every field of the profile', async () => {
    const { theme: _theme, ...withoutTheme } = COMPLETE_PROFILE;
    await putProfile(withoutTheme, 400);
    const { weightKg: _weight, ...withoutWeight } = COMPLETE_PROFILE;
    await putProfile(withoutWeight, 400);
  });

  it('accepts null for every nullable field and the boundary values', async () => {
    await putProfile({
      ...COMPLETE_PROFILE,
      weightKg: null,
      heightCm: null,
      age: null,
      sex: null,
      bodyFatPct: null,
      tdeeOverride: null,
      location: null,
      aiModel: null,
    });
    const boundaries = await putProfile({
      ...COMPLETE_PROFILE,
      weightKg: 25,
      heightCm: 250,
      age: 13,
      bodyFatPct: 3,
      tdeeOverride: 800,
      trainingDaysPerWeek: 7,
      location: 'y'.repeat(API_LIMITS.locationMax),
      dayStartHour: 0,
      fluidTargetMl: 500,
    });
    await putProfile({
      ...COMPLETE_PROFILE,
      weightKg: 400,
      heightCm: 100,
      age: 100,
      bodyFatPct: 70,
      tdeeOverride: 8000,
      trainingDaysPerWeek: 0,
      dayStartHour: 6,
      fluidTargetMl: 8000,
    });
    expect((boundaries.body as ProfileResponse).targets.restDeltaKcal).toBe(0);
  });
});
