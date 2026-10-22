import type { UpdateProfileRequest } from '@food/shared';
import type { AiConfigService } from '../ai/ai-config.service.js';
import type { Profile } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { UsageService } from '../usage/usage.service.js';
import { ProfileService } from './profile.service.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const NOW = new Date('2026-09-28T10:00:00.000Z');

const DTO: UpdateProfileRequest = {
  weightKg: 80,
  heightCm: 180,
  age: 35,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'cut',
  trainingDaysPerWeek: 3,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
};

function profileRow(overrides: Partial<Profile> = {}): Profile {
  return {
    userId: USER_ID,
    weightKg: 80,
    heightCm: 180,
    age: 35,
    sex: 'male',
    bodyFatPct: null,
    tdeeOverride: null,
    onboardedAt: null,
    hiddenFoods: [],
    dismissedFoodMerges: [],
    foodMergeDecisions: [],
    dayStartHour: 3,
    fluidTargetMl: null,
    activityLevel: 'moderate',
    goal: 'cut',
    trainingDaysPerWeek: 3,
    targetOverrides: {},
    location: null,
    aiModel: null,
    aiDetailFood: 'high',
    aiDetailLabel: 'high',
    theme: 'dark',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    profile: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      createMany: vi.fn(),
    },
  };
  const ai = {
    isSelectableModel: vi.fn().mockReturnValue(true),
    resolveModel: vi.fn((model: string) => model),
    availableModels: vi.fn().mockReturnValue([]),
    describe: vi.fn(
      (_model: string | null, monthlyBudgetUsd: number | null) => ({
        provider: 'mock',
        monthlyBudgetUsd,
      }),
    ),
  };
  const usage = { userBudgetUsd: vi.fn().mockResolvedValue(5) };
  const service = new ProfileService(
    prisma as unknown as PrismaService,
    ai as unknown as AiConfigService,
    usage as unknown as UsageService,
  );
  return { prisma, ai, usage, service };
}

describe('ProfileService.getProfile', () => {
  it('returns the stored profile without writing', async () => {
    const { prisma, service } = setup();
    prisma.profile.findUnique.mockResolvedValue(profileRow({ goal: 'bulk' }));

    await expect(service.getProfile(USER_ID)).resolves.toMatchObject({
      goal: 'bulk',
    });
    expect(prisma.profile.createMany).not.toHaveBeenCalled();
  });

  it('creates a missing profile without failing when another request creates it first', async () => {
    const { prisma, service } = setup();
    prisma.profile.findUnique.mockResolvedValue(null);
    prisma.profile.createMany.mockResolvedValue({ count: 0 });
    prisma.profile.findUniqueOrThrow.mockResolvedValue(profileRow());

    await expect(service.getProfile(USER_ID)).resolves.toMatchObject({
      weightKg: 80,
      onboarded: false,
    });
    expect(prisma.profile.createMany).toHaveBeenCalledWith({
      data: [{ userId: USER_ID }],
      skipDuplicates: true,
    });
    expect(prisma.profile.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
  });
});

describe('ProfileService.getResponse', () => {
  it('reports the effective AI budget of the caller', async () => {
    const { ai, prisma, service, usage } = setup();
    prisma.profile.findUnique.mockResolvedValue(
      profileRow({ aiModel: 'gpt-6-sol' }),
    );
    usage.userBudgetUsd.mockResolvedValue(12.5);

    const response = await service.getResponse(USER_ID);

    expect(usage.userBudgetUsd).toHaveBeenCalledWith(USER_ID);
    expect(ai.describe).toHaveBeenCalledWith('gpt-6-sol', 12.5);
    expect(response.ai.monthlyBudgetUsd).toBe(12.5);
  });

  it('reports an unlimited caller as having no budget', async () => {
    const { prisma, service, usage } = setup();
    prisma.profile.findUnique.mockResolvedValue(profileRow());
    usage.userBudgetUsd.mockResolvedValue(null);

    const response = await service.getResponse(USER_ID);

    expect(response.ai.monthlyBudgetUsd).toBeNull();
  });
});

describe('ProfileService.update', () => {
  it('leaves the optional body fields and onboarding untouched when absent', async () => {
    const { prisma, service } = setup();
    prisma.profile.upsert.mockResolvedValue(
      profileRow({ bodyFatPct: 20, tdeeOverride: 2500 }),
    );

    const response = await service.update(USER_ID, DTO, NOW);

    const call = prisma.profile.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.create).toMatchObject({ userId: USER_ID, onboardedAt: null });
    expect(call.update.bodyFatPct).toBeUndefined();
    expect(call.update.tdeeOverride).toBeUndefined();
    expect(call.update).not.toHaveProperty('onboardedAt');
    expect(prisma.profile.update).not.toHaveBeenCalled();
    expect(response.profile).toMatchObject({
      bodyFatPct: 20,
      tdeeOverride: 2500,
      onboarded: false,
    });
    expect(response.ai.monthlyBudgetUsd).toBe(5);
  });

  it('keeps the stored day start and fluids target for clients that omit them', async () => {
    const { prisma, service } = setup();
    prisma.profile.upsert.mockResolvedValue(
      profileRow({ dayStartHour: 5, fluidTargetMl: 3000 }),
    );

    const response = await service.update(USER_ID, DTO, NOW);

    const call = prisma.profile.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.update.dayStartHour).toBeUndefined();
    expect(call.update.fluidTargetMl).toBeUndefined();
    expect(call.create.dayStartHour).toBeUndefined();
    expect(response.profile).toMatchObject({
      dayStartHour: 5,
      fluidTargetMl: 3000,
    });
  });

  it('saves the day start and fluids target sent during onboarding', async () => {
    const { prisma, service } = setup();
    prisma.profile.upsert.mockResolvedValue(
      profileRow({ onboardedAt: NOW, dayStartHour: 2, fluidTargetMl: null }),
    );

    const response = await service.update(
      USER_ID,
      { ...DTO, onboarded: true, dayStartHour: 2, fluidTargetMl: null },
      NOW,
    );

    const call = prisma.profile.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.create).toMatchObject({
      dayStartHour: 2,
      fluidTargetMl: null,
      onboardedAt: NOW,
    });
    expect(call.update).toMatchObject({ dayStartHour: 2, fluidTargetMl: null });
    expect(response.profile).toMatchObject({
      onboarded: true,
      dayStartHour: 2,
      fluidTargetMl: null,
    });
  });

  it('sets onboardedAt when onboarding completes on an existing profile', async () => {
    const { prisma, service } = setup();
    prisma.profile.upsert.mockResolvedValue(profileRow());
    prisma.profile.update.mockResolvedValue(profileRow({ onboardedAt: NOW }));

    const response = await service.update(
      USER_ID,
      { ...DTO, onboarded: true },
      NOW,
    );

    expect(prisma.profile.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { onboardedAt: NOW },
    });
    expect(response.profile.onboarded).toBe(true);
  });

  it('creates new profiles as onboarded in one write', async () => {
    const { prisma, service } = setup();
    prisma.profile.upsert.mockResolvedValue(profileRow({ onboardedAt: NOW }));

    await service.update(USER_ID, { ...DTO, onboarded: true }, NOW);

    const call = prisma.profile.upsert.mock.calls[0]![0] as {
      create: Record<string, unknown>;
    };
    expect(call.create.onboardedAt).toBe(NOW);
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });

  it('keeps the original onboarding time and never clears it', async () => {
    const earlier = new Date('2026-09-01T09:00:00.000Z');
    const { prisma, service } = setup();
    prisma.profile.upsert.mockResolvedValue(
      profileRow({ onboardedAt: earlier }),
    );

    const again = await service.update(
      USER_ID,
      { ...DTO, onboarded: true },
      NOW,
    );
    const off = await service.update(
      USER_ID,
      { ...DTO, onboarded: false },
      NOW,
    );

    expect(prisma.profile.update).not.toHaveBeenCalled();
    expect(again.profile.onboarded).toBe(true);
    expect(off.profile.onboarded).toBe(true);
  });

  it('computes targets and body metrics from body fat and the burn override', async () => {
    const { prisma, service } = setup();
    prisma.profile.upsert.mockResolvedValue(
      profileRow({ bodyFatPct: 20, tdeeOverride: 2600 }),
    );

    const response = await service.update(USER_ID, DTO, NOW);

    expect(response.targets).toMatchObject({
      bmrFormula: 'katch_mcardle',
      bmr: 1752,
      tdee: 2600,
      tdeeSource: 'override',
    });
    expect(response.body).toMatchObject({
      bmi: 24.7,
      bmiCategory: 'normal',
      leanMassKg: 64,
      fatMassKg: 16,
    });
  });
});
