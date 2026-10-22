import {
  type CreateFluidLogRequest,
  type FluidDayResponse,
  type FluidLogDto,
  fluidTargetMl,
  type UpdateFluidLogRequest,
} from '@food/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DaysService } from '../days/days.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProfileService } from '../profile/profile.service.js';
import {
  buildFluidDay,
  FLUID_DRINK_SELECT,
  toFluidDrinks,
} from './fluid-day.js';
import {
  FLUID_LOG_ORDER,
  FLUID_LOG_SELECT,
  fluidLogCreateData,
  fluidLogUpdateData,
  toFluidLogDto,
} from './fluid-log.mapper.js';

function fluidLogNotFound(): NotFoundException {
  return new NotFoundException('Fluid log not found');
}

@Injectable()
export class FluidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly days: DaysService,
  ) {}

  async day(userId: string, date: string): Promise<FluidDayResponse> {
    const [profile, meta, logs, drinks] = await Promise.all([
      this.profiles.getProfile(userId),
      this.days.get(userId, date),
      this.prisma.fluidLog.findMany({
        where: { userId, localDate: date },
        orderBy: [...FLUID_LOG_ORDER],
        select: FLUID_LOG_SELECT,
      }),
      this.prisma.entryItem.findMany({
        where: { fluidMl: { gt: 0 }, entry: { userId, localDate: date } },
        select: FLUID_DRINK_SELECT,
      }),
    ]);
    return buildFluidDay({
      date,
      targetMl: fluidTargetMl(profile, meta.trainingDay),
      logs: logs.map(toFluidLogDto),
      drinks: toFluidDrinks(drinks),
    });
  }

  async create(
    userId: string,
    request: CreateFluidLogRequest,
  ): Promise<FluidLogDto> {
    const row = await this.prisma.fluidLog.create({
      data: { userId, ...fluidLogCreateData(request) },
      select: FLUID_LOG_SELECT,
    });
    return toFluidLogDto(row);
  }

  async update(
    userId: string,
    id: string,
    request: UpdateFluidLogRequest,
  ): Promise<FluidLogDto> {
    await this.requireLog(userId, id);
    const row = await this.prisma.fluidLog.update({
      where: { id, userId },
      data: fluidLogUpdateData(request),
      select: FLUID_LOG_SELECT,
    });
    return toFluidLogDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.fluidLog.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw fluidLogNotFound();
    }
  }

  private async requireLog(userId: string, id: string): Promise<void> {
    const log = await this.prisma.fluidLog.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!log) {
      throw fluidLogNotFound();
    }
  }
}
