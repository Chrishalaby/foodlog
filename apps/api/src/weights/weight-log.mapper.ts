import {
  roundTo,
  type UpsertWeightRequest,
  type WeightLogDto,
  type WeightPoint,
} from '@food/shared';
import type { WeightLog } from '../generated/prisma/client.js';

export const WEIGHT_LOG_SELECT = {
  date: true,
  weightKg: true,
  bodyFatPct: true,
} as const;

export type WeightLogRow = Pick<WeightLog, 'date' | 'weightKg' | 'bodyFatPct'>;

export interface WeightLogValues {
  weightKg: number;
  bodyFatPct?: number | null;
}

export interface ProfileBodySync {
  weightKg: number;
  bodyFatPct?: number;
}

export function roundBodyValue(value: number): number {
  return roundTo(value, 1);
}

export function weightLogValues(request: UpsertWeightRequest): WeightLogValues {
  const weightKg = roundBodyValue(request.weightKg);
  if (request.bodyFatPct === undefined) {
    return { weightKg };
  }
  return {
    weightKg,
    bodyFatPct:
      request.bodyFatPct === null ? null : roundBodyValue(request.bodyFatPct),
  };
}

export function toWeightLogDto(row: WeightLogRow): WeightLogDto {
  return {
    date: row.date,
    weightKg: row.weightKg,
    bodyFatPct: row.bodyFatPct,
  };
}

export function toWeightPoint(log: WeightLogRow): WeightPoint {
  return { date: log.date, weightKg: log.weightKg };
}

export function profileBodySync(log: WeightLogValues): ProfileBodySync {
  return typeof log.bodyFatPct === 'number'
    ? { weightKg: log.weightKg, bodyFatPct: log.bodyFatPct }
    : { weightKg: log.weightKg };
}
