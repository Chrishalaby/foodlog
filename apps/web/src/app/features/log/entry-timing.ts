import { guessMealType, toLocalDateTimeInput, type MealType } from '@food/shared';
import { calendarDateFor, dayStartHour, isBeforeDayStart } from '../../core/day-start';
import {
  localClockTime,
  localDateOf,
  relativeDayLabel,
  shortDateLabel,
  todayLocalDate,
} from '../../core/time';

export interface EntryTiming {
  timestamp: string;
  localDate: string;
}

export interface LogNowTiming extends EntryTiming {
  mealType: MealType;
}

const DATE_TIME_INPUT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/;

export interface DateTimeInputParts {
  localDate: string;
  time: string;
}

export function dateTimeInputParts(value: string): DateTimeInputParts | null {
  const match = DATE_TIME_INPUT_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const [year, month, day, hours, minutes] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || hours > 23 || minutes > 59) {
    return null;
  }
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) {
    return null;
  }
  return { localDate: `${match[1]}-${match[2]}-${match[3]}`, time: `${match[4]}:${match[5]}` };
}

export function parseDateTimeInput(value: string, hour: number = dayStartHour()): Date | null {
  const parts = dateTimeInputParts(value);
  if (!parts) {
    return null;
  }
  const [year, month, day] = calendarDateFor(parts.localDate, parts.time, hour)
    .split('-')
    .map(Number) as [number, number, number];
  const [hours, minutes] = parts.time.split(':').map(Number) as [number, number];
  return new Date(year, month - 1, day, hours, minutes);
}

export function timingFromInput(value: string, hour: number = dayStartHour()): EntryTiming | null {
  const parts = dateTimeInputParts(value);
  const date = parseDateTimeInput(value, hour);
  return parts && date ? { timestamp: date.toISOString(), localDate: parts.localDate } : null;
}

export function logNowTiming(now: Date = new Date()): LogNowTiming {
  return {
    timestamp: now.toISOString(),
    localDate: localDateOf(now),
    mealType: guessMealType(now),
  };
}

export function currentDateTimeInput(
  now: Date = new Date(),
  hour: number = dayStartHour(),
): string {
  return `${localDateOf(now, hour)}T${localClockTime(now)}`;
}

export function aiLocalTime(at: Date): string {
  return toLocalDateTimeInput(at);
}

export function analysisLocalTime(dateTime: string, fallback: Date = new Date()): string {
  return aiLocalTime(parseDateTimeInput(dateTime) ?? fallback);
}

export function dateTimeInputFromIso(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? currentDateTimeInput() : currentDateTimeInput(date);
}

export function eatingDayPhrase(localDate: string, today: string = todayLocalDate()): string {
  const label = relativeDayLabel(localDate, today);
  return label === 'Today' || label === 'Yesterday' ? label.toLowerCase() : label;
}

export function afterMidnightNote(
  value: string,
  hour: number = dayStartHour(),
  today: string = todayLocalDate(),
): string | null {
  const parts = dateTimeInputParts(value);
  if (!parts || !isBeforeDayStart(parts.time, hour)) {
    return null;
  }
  const calendar = calendarDateFor(parts.localDate, parts.time, hour);
  return `After midnight (${shortDateLabel(calendar, today)}) · counts toward ${eatingDayPhrase(parts.localDate, today)}`;
}

export function mealTypeAt(value: string): MealType | null {
  const date = parseDateTimeInput(value);
  return date ? guessMealType(date) : null;
}

export const PHOTO_TIME_MAX_AGE_DAYS = 30;
export const PHOTO_TIME_FUTURE_TOLERANCE_MS = 60_000;

export function usablePhotoTime(takenAt: Date | null, now: Date = new Date()): Date | null {
  if (!takenAt || Number.isNaN(takenAt.getTime())) {
    return null;
  }
  const age = now.getTime() - takenAt.getTime();
  if (age < -PHOTO_TIME_FUTURE_TOLERANCE_MS || age > PHOTO_TIME_MAX_AGE_DAYS * 86_400_000) {
    return null;
  }
  return age < 0 ? now : takenAt;
}

export function photoTimeLabel(value: string, today: string = todayLocalDate()): string {
  const parts = dateTimeInputParts(value);
  if (!parts) {
    return '';
  }
  return parts.localDate === today
    ? parts.time
    : `${relativeDayLabel(parts.localDate, today)} ${parts.time}`;
}
