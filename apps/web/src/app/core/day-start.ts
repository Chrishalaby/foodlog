import { signal } from '@angular/core';
import {
  calendarDateFor as calendarDateForHour,
  DAY_START_HOURS,
  DEFAULT_DAY_START_HOUR,
  isBeforeDayStart as isBeforeHour,
  logicalDate as logicalDateForHour,
} from '@food/shared';

export { DAY_START_HOURS, DEFAULT_DAY_START_HOUR };
export const DAY_START_STORAGE_KEY = 'foodlog.dayStartHour';
export const DAY_BOUNDARY_SLACK_MS = 1000;

export function isDayStartHour(value: unknown): value is number {
  return typeof value === 'number' && (DAY_START_HOURS as readonly number[]).includes(value);
}

export function normalizeDayStartHour(value: unknown): number {
  return isDayStartHour(value) ? value : DEFAULT_DAY_START_HOUR;
}

function deviceStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredDayStartHour(storage: Storage | null = deviceStorage()): number {
  try {
    const raw = storage?.getItem(DAY_START_STORAGE_KEY) ?? null;
    return raw === null || raw.trim() === ''
      ? DEFAULT_DAY_START_HOUR
      : normalizeDayStartHour(Number(raw));
  } catch {
    return DEFAULT_DAY_START_HOUR;
  }
}

const dayStartState = signal(readStoredDayStartHour());

export const dayStartHour = dayStartState.asReadonly();

export function setDayStartHour(hour: unknown, storage: Storage | null = deviceStorage()): void {
  const next = normalizeDayStartHour(hour);
  dayStartState.set(next);
  try {
    storage?.setItem(DAY_START_STORAGE_KEY, String(next));
  } catch {
    return;
  }
}

export function logicalDate(date: Date, hour: number = dayStartHour()): string {
  return logicalDateForHour(date, hour);
}

export function isBeforeDayStart(time: string, hour: number = dayStartHour()): boolean {
  return isBeforeHour(time, hour);
}

export function calendarDateFor(
  localDate: string,
  time: string,
  hour: number = dayStartHour(),
): string {
  return calendarDateForHour(localDate, time, hour);
}

export function dayStartLabel(hour: number): string {
  const safe = normalizeDayStartHour(hour);
  return safe === 0 ? 'Midnight' : `${safe} am`;
}

export function dayStartHint(hour: number): string {
  const safe = normalizeDayStartHour(hour);
  return safe === 0
    ? 'Each day starts at midnight.'
    : `Food you log before ${dayStartLabel(safe)} counts toward the day before.`;
}

export function dayEndsNote(now: Date, hour: number = dayStartHour()): string | null {
  const safe = normalizeDayStartHour(hour);
  return safe > 0 && now.getHours() < safe ? `Day ends at ${dayStartLabel(safe)}` : null;
}

export function msUntilNextDayBoundary(now: Date, hour: number = dayStartHour()): number {
  const safe = normalizeDayStartHour(hour);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), safe);
  const start =
    startToday.getTime() > now.getTime()
      ? startToday
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, safe);
  const next = Math.min(midnight.getTime(), start.getTime());
  return Math.max(0, next - now.getTime()) + DAY_BOUNDARY_SLACK_MS;
}
