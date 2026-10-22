import type { MealType } from './enums.js';

export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n: number): string => String(n).padStart(2, '0');

export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function isValidLocalDateTime(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  return match !== null && isValidLocalDate(match[1]);
}

export function toLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalDateTimeInput(date: Date): string {
  return `${toLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const DAY_START_HOURS = [0, 1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_DAY_START_HOUR = 3;

const CLOCK_TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function dayStartOrDefault(dayStartHour: number): number {
  return (DAY_START_HOURS as readonly number[]).includes(dayStartHour) ? dayStartHour : DEFAULT_DAY_START_HOUR;
}

export function logicalDate(date: Date, dayStartHour: number): string {
  const calendar = toLocalDate(date);
  return date.getHours() < dayStartOrDefault(dayStartHour) ? addDays(calendar, -1) : calendar;
}

export function logicalDateInTimeZone(date: Date, timeZone: string, dayStartHour: number): string {
  const calendar = localDateInTimeZone(date, timeZone);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .find((p) => p.type === 'hour')?.value ?? '0',
  );
  return hour < dayStartOrDefault(dayStartHour) ? addDays(calendar, -1) : calendar;
}

export function isBeforeDayStart(time: string, dayStartHour: number): boolean {
  const match = CLOCK_TIME_PATTERN.exec(time.trim());
  if (!match) {
    return false;
  }
  const hours = Number(match[1]);
  return hours <= 23 && hours < dayStartOrDefault(dayStartHour);
}

export function calendarDateFor(localDate: string, time: string, dayStartHour: number): string {
  return isBeforeDayStart(time, dayStartHour) ? addDays(localDate, 1) : localDate;
}

function parseUtc(localDate: string): Date {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function formatUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(localDate: string, days: number): string {
  const date = parseUtc(localDate);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtc(date);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseUtc(to).getTime() - parseUtc(from).getTime()) / 86_400_000);
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const span = diffDays(from, to);
  for (let i = 0; i <= span; i++) {
    out.push(addDays(from, i));
  }
  return out;
}

export function weekdayOf(localDate: string): number {
  return parseUtc(localDate).getUTCDay();
}

export function startOfWeek(localDate: string, weekStartsOn = 1): string {
  const weekday = weekdayOf(localDate);
  const offset = (weekday - weekStartsOn + 7) % 7;
  return addDays(localDate, -offset);
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function guessMealType(date: Date): MealType {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 4 * 60 && minutes < 11 * 60) {
    return 'breakfast';
  }
  if (minutes >= 11 * 60 && minutes < 15 * 60 + 30) {
    return 'lunch';
  }
  if (minutes >= 15 * 60 + 30 && minutes < 17 * 60 + 30) {
    return 'snack';
  }
  if (minutes >= 17 * 60 + 30 && minutes < 22 * 60 + 30) {
    return 'dinner';
  }
  return 'snack';
}
