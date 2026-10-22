import { WEEKDAY_SHORT, addDays, isValidLocalDate, weekdayOf } from '@food/shared';
import { calendarDateFor, dayStartHour, logicalDate } from './day-start';

export const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

export function nowIso(): string {
  return new Date().toISOString();
}

export function localDateOf(date: Date, hour: number = dayStartHour()): string {
  return logicalDate(date, hour);
}

export function todayLocalDate(now: Date = new Date()): string {
  return localDateOf(now);
}

export function localClockTime(date: Date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function shortDateLabel(localDate: string, today: string = todayLocalDate()): string {
  if (!isValidLocalDate(localDate)) {
    return localDate;
  }
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  const label = `${WEEKDAY_SHORT[weekdayOf(localDate)]} ${day} ${MONTH_SHORT[month - 1]}`;
  return year === Number(today.slice(0, 4)) ? label : `${label} ${year}`;
}

export function relativeDayLabel(localDate: string, today: string = todayLocalDate()): string {
  if (localDate === today) {
    return 'Today';
  }
  if (localDate === addDays(today, -1)) {
    return 'Yesterday';
  }
  if (localDate === addDays(today, 1)) {
    return 'Tomorrow';
  }
  return shortDateLabel(localDate, today);
}

export function localDateTimeToIso(
  localDate: string,
  time: string,
  hour: number = dayStartHour(),
): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!isValidLocalDate(localDate) || !match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  const calendar = calendarDateFor(localDate, time, hour);
  const [year, month, day] = calendar.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}
