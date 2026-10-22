import type { DayMetaDto } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpdateDayMetaDto } from './days.dto.js';

const DAY_META_SELECT = { date: true, trainingDay: true } as const;

export function defaultDayMeta(date: string): DayMetaDto {
  return { date, trainingDay: false };
}

@Injectable()
export class DaysService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, date: string): Promise<DayMetaDto> {
    const day = await this.prisma.dayMeta.findUnique({
      where: { userId_date: { userId, date } },
      select: DAY_META_SELECT,
    });
    return day ?? defaultDayMeta(date);
  }

  put(
    userId: string,
    date: string,
    dto: UpdateDayMetaDto,
  ): Promise<DayMetaDto> {
    return this.prisma.dayMeta.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, trainingDay: dto.trainingDay },
      update: { trainingDay: dto.trainingDay },
      select: DAY_META_SELECT,
    });
  }
}
