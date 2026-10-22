import {
  computeBodyMetrics,
  computeTargets,
  type ProfileDto,
  type ProfileResponse,
} from '@food/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { AiConfigService } from '../ai/ai-config.service.js';
import type { Profile } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageService } from '../usage/usage.service.js';
import type { UpdateProfileDto } from './profile.dto.js';
import { profileData, toProfileDto } from './profile.mapper.js';

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiConfigService,
    private readonly usage: UsageService,
  ) {}

  async getProfile(userId: string): Promise<ProfileDto> {
    return this.toDto(await this.ensureRow(userId));
  }

  async getResponse(userId: string): Promise<ProfileResponse> {
    return this.toResponse(userId, await this.getProfile(userId));
  }

  async update(
    userId: string,
    dto: UpdateProfileDto,
    now: Date = new Date(),
  ): Promise<ProfileResponse> {
    this.assertSelectableModel(dto.aiModel);
    const data = {
      ...profileData(dto),
      aiModel: this.selectableModel(dto.aiModel),
    };
    const saved = await this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...data, onboardedAt: dto.onboarded ? now : null },
      update: data,
    });
    const row = await this.markOnboarded(saved, dto.onboarded, now);
    return this.toResponse(userId, this.toDto(row));
  }

  private async markOnboarded(
    row: Profile,
    onboarded: boolean | undefined,
    now: Date,
  ): Promise<Profile> {
    if (onboarded !== true || row.onboardedAt !== null) {
      return row;
    }
    return this.prisma.profile.update({
      where: { userId: row.userId },
      data: { onboardedAt: now },
    });
  }

  private async ensureRow(userId: string): Promise<Profile> {
    const existing = await this.prisma.profile.findUnique({
      where: { userId },
    });
    if (existing) {
      return existing;
    }
    await this.prisma.profile.createMany({
      data: [{ userId }],
      skipDuplicates: true,
    });
    return this.prisma.profile.findUniqueOrThrow({ where: { userId } });
  }

  private toDto(row: Profile): ProfileDto {
    const profile = toProfileDto(row);
    return { ...profile, aiModel: this.selectableModel(profile.aiModel) };
  }

  private selectableModel(model: string | null): string | null {
    if (model === null || !this.ai.isSelectableModel(model)) {
      return null;
    }
    return this.ai.resolveModel(model, false);
  }

  private assertSelectableModel(model: string | null): void {
    if (model === null || this.ai.isSelectableModel(model)) {
      return;
    }
    const options = this.ai
      .availableModels()
      .map((option) => option.id)
      .join(', ');
    throw new BadRequestException([
      `aiModel must be null or one of: ${options}`,
    ]);
  }

  private async toResponse(
    userId: string,
    profile: ProfileDto,
  ): Promise<ProfileResponse> {
    return {
      profile,
      targets: computeTargets(profile),
      body: computeBodyMetrics(profile),
      ai: this.ai.describe(
        profile.aiModel,
        await this.usage.userBudgetUsd(userId),
      ),
    };
  }
}
