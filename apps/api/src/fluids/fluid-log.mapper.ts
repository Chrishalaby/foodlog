import type {
  CreateFluidLogRequest,
  FluidLogDto,
  UpdateFluidLogRequest,
} from '@food/shared';
import type { FluidLog, Prisma } from '../generated/prisma/client.js';

export const FLUID_LOG_SELECT = {
  id: true,
  localDate: true,
  timestamp: true,
  ml: true,
  kind: true,
  createdAt: true,
} as const satisfies Prisma.FluidLogSelect;

export const FLUID_LOG_ORDER = [
  { timestamp: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] as const satisfies Prisma.FluidLogOrderByWithRelationInput[];

export type FluidLogRow = Pick<
  FluidLog,
  'id' | 'localDate' | 'timestamp' | 'ml' | 'kind' | 'createdAt'
>;

export type FluidLogCreateValues = Omit<
  Prisma.FluidLogUncheckedCreateInput,
  'id' | 'userId' | 'createdAt'
>;

export function fluidLogMl(ml: number): number {
  return Math.round(ml);
}

export function toFluidLogDto(row: FluidLogRow): FluidLogDto {
  return {
    id: row.id,
    localDate: row.localDate,
    timestamp: row.timestamp.toISOString(),
    ml: row.ml,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
  };
}

export function fluidLogCreateData(
  request: CreateFluidLogRequest,
): FluidLogCreateValues {
  return {
    ml: fluidLogMl(request.ml),
    kind: request.kind,
    timestamp: new Date(request.timestamp),
    localDate: request.localDate,
  };
}

export function fluidLogUpdateData(
  request: UpdateFluidLogRequest,
): Prisma.FluidLogUpdateInput {
  return {
    ...(request.ml === undefined ? {} : { ml: fluidLogMl(request.ml) }),
    ...(request.kind === undefined ? {} : { kind: request.kind }),
    ...(request.timestamp === undefined
      ? {}
      : { timestamp: new Date(request.timestamp) }),
    ...(request.localDate === undefined
      ? {}
      : { localDate: request.localDate }),
  };
}
