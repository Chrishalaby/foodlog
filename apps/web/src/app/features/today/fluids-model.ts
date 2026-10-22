import {
  FLUID_KIND_LABELS,
  FLUID_LIMITS,
  fluidCaffeineMg,
  isFiniteNumber,
  type FluidDayResponse,
  type FluidKind,
  type FluidLogDto,
} from '@food/shared';
import { toTimeLabel } from '../../core/time';

export const FLUID_QUICK_AMOUNTS_ML = [250, 500] as const;
export const FLUID_SHEET_AMOUNTS_ML = [150, 250, 330, 500, 750] as const;
export const FLUID_DEFAULT_SHEET_ML = 250;
export const FLUID_PENDING_PREFIX = 'pending-';
export const FLUID_LOGS_COLLAPSED = 3;

export interface FluidLogRow {
  id: string;
  kind: FluidKind;
  title: string;
  amount: string;
  time: string;
  pending: boolean;
  label: string;
}

export interface FluidDrinkRow {
  key: string;
  name: string;
  amount: string;
  entryName: string;
  label: string;
}

export function isPendingFluid(log: Pick<FluidLogDto, 'id'>): boolean {
  return log.id.startsWith(FLUID_PENDING_PREFIX);
}

export function formatLitres(ml: number): string {
  const safe = Math.max(0, isFiniteNumber(ml) ? ml : 0);
  return (Math.round(safe / 10) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

export function fluidTotalLitres(totalMl: number): string {
  const safe = Math.max(0, isFiniteNumber(totalMl) ? totalMl : 0);
  return formatLitres(Math.floor(safe / 10) * 10);
}

export function formatMl(ml: number): string {
  return `${Math.round(Math.max(0, isFiniteNumber(ml) ? ml : 0)).toLocaleString('en-US')} ml`;
}

export function fluidProgressText(totalMl: number, targetMl: number): string {
  return `${fluidTotalLitres(totalMl)} / ${formatLitres(targetMl)} L`;
}

export function fluidPercent(totalMl: number, targetMl: number): number {
  if (!isFiniteNumber(totalMl) || !isFiniteNumber(targetMl) || targetMl <= 0) {
    return 0;
  }
  return Math.floor((Math.max(0, totalMl) / targetMl) * 100);
}

export function fluidTargetReached(totalMl: number, targetMl: number): boolean {
  return isFiniteNumber(totalMl) && isFiniteNumber(targetMl) && targetMl > 0 && totalMl >= targetMl;
}

export function fluidKindLabel(kind: FluidKind): string {
  return FLUID_KIND_LABELS[kind] ?? FLUID_KIND_LABELS.other;
}

export function fluidAddLabel(ml: number, kind: FluidKind): string {
  return `${formatMl(ml)} ${fluidKindLabel(kind).toLowerCase()}`;
}

export function isValidFluidMl(ml: number | null): ml is number {
  return (
    ml !== null &&
    isFiniteNumber(ml) &&
    Number.isInteger(ml) &&
    ml >= FLUID_LIMITS.logMinMl &&
    ml <= FLUID_LIMITS.logMaxMl
  );
}

export function fluidMlError(ml: number | null): string | null {
  if (ml === null) {
    return 'Enter an amount in ml.';
  }
  return isValidFluidMl(ml)
    ? null
    : `Enter ${FLUID_LIMITS.logMinMl}–${FLUID_LIMITS.logMaxMl.toLocaleString('en-US')} ml.`;
}

function byTime(a: FluidLogDto, b: FluidLogDto): number {
  return a.timestamp.localeCompare(b.timestamp) || a.createdAt.localeCompare(b.createdAt);
}

export function sumLogsMl(logs: readonly FluidLogDto[]): number {
  return logs.reduce((sum, log) => sum + (isFiniteNumber(log.ml) ? log.ml : 0), 0);
}

export function logsCaffeineMg(logs: readonly FluidLogDto[]): number {
  return logs.reduce((sum, log) => sum + fluidCaffeineMg(log.kind, log.ml), 0);
}

export function withFluidLog(day: FluidDayResponse, log: FluidLogDto): FluidDayResponse {
  if (log.localDate !== day.date || day.logs.some((existing) => existing.id === log.id)) {
    return day;
  }
  return recomputeDay(day, [...day.logs, log]);
}

export function withoutFluidLog(day: FluidDayResponse, id: string): FluidDayResponse {
  return day.logs.some((log) => log.id === id)
    ? recomputeDay(
        day,
        day.logs.filter((log) => log.id !== id),
      )
    : day;
}

export function recomputeDay(
  day: FluidDayResponse,
  logs: readonly FluidLogDto[],
): FluidDayResponse {
  const sorted = [...logs].sort(byTime);
  const logsMl = sumLogsMl(sorted);
  return {
    ...day,
    logs: sorted,
    logsMl,
    totalMl: logsMl + day.foodMl,
    caffeineMg: logsCaffeineMg(sorted),
  };
}

export function fluidDayView(
  day: FluidDayResponse,
  pending: readonly FluidLogDto[],
  removing: ReadonlySet<string>,
): FluidDayResponse {
  const visible = day.logs.filter((log) => !removing.has(log.id));
  const extra = pending.filter(
    (log) => log.localDate === day.date && !visible.some((existing) => existing.id === log.id),
  );
  if (visible.length === day.logs.length && extra.length === 0) {
    return day;
  }
  return recomputeDay(day, [...visible, ...extra]);
}

export function fluidLogRows(logs: readonly FluidLogDto[]): FluidLogRow[] {
  return [...logs].reverse().map((log) => {
    const title = fluidKindLabel(log.kind);
    const amount = formatMl(log.ml);
    const time = toTimeLabel(log.timestamp);
    return {
      id: log.id,
      kind: log.kind,
      title,
      amount,
      time,
      pending: isPendingFluid(log),
      label: `${title}, ${amount}${time ? ` at ${time}` : ''}`,
    };
  });
}

export function fluidDrinkRows(day: Pick<FluidDayResponse, 'drinks'>): FluidDrinkRow[] {
  return [...day.drinks]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .map((drink) => {
      const amount = formatMl(drink.ml);
      return {
        key: `${drink.entryId}:${drink.itemId}`,
        name: drink.name,
        amount,
        entryName: drink.entryName,
        label: `${drink.name}, ${amount}, from ${drink.entryName}`,
      };
    });
}

export function fluidSummaryNote(day: Pick<FluidDayResponse, 'foodMl' | 'caffeineMg'>): string {
  const parts: string[] = [];
  if (day.foodMl > 0) {
    parts.push(`${formatMl(day.foodMl)} from meals`);
  }
  if (day.caffeineMg > 0) {
    parts.push(`${Math.round(day.caffeineMg)} mg caffeine from coffee & tea`);
  }
  return parts.join(' · ');
}
