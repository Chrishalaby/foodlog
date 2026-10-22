import { addDays, diffDays, eachDate, isValidLocalDate, startOfWeek } from '@food/shared';
import { MONTH_SHORT } from '../../core/time';

export const WEEK_STARTS_ON = 1;
export const WEEK_LENGTH = 7;

export interface WeekRange {
  start: string;
  end: string;
  to: string;
  dates: string[];
  isCurrent: boolean;
}

export function currentWeekStart(today: string): string {
  return startOfWeek(today, WEEK_STARTS_ON);
}

export function normalizeWeekStart(value: string | null | undefined, today: string): string {
  const current = currentWeekStart(today);
  if (!isValidLocalDate(value)) {
    return current;
  }
  const start = startOfWeek(value, WEEK_STARTS_ON);
  return start > current ? current : start;
}

export function weekRange(start: string, today: string): WeekRange {
  const end = addDays(start, WEEK_LENGTH - 1);
  return {
    start,
    end,
    to: end < today ? end : today,
    dates: eachDate(start, end),
    isCurrent: start === currentWeekStart(today),
  };
}

export function shiftWeek(start: string, weeks: number, today: string): string {
  return normalizeWeekStart(addDays(start, weeks * WEEK_LENGTH), today);
}

export function canShowNextWeek(start: string, today: string): boolean {
  return start < currentWeekStart(today);
}

function dateParts(localDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function dayMonthLabel(localDate: string): string {
  const { month, day } = dateParts(localDate);
  return `${day} ${MONTH_SHORT[month - 1]}`;
}

export function formatDateRange(from: string, to: string, today: string): string {
  if (!isValidLocalDate(from) || !isValidLocalDate(to)) {
    return '';
  }
  const a = dateParts(from);
  const b = dateParts(to);
  const currentYear = dateParts(today).year;
  if (a.year !== b.year) {
    return `${dayMonthLabel(from)} ${a.year} – ${dayMonthLabel(to)} ${b.year}`;
  }
  const yearSuffix = b.year === currentYear ? '' : ` ${b.year}`;
  if (a.month === b.month) {
    return `${a.day} – ${b.day} ${MONTH_SHORT[b.month - 1]}${yearSuffix}`;
  }
  return `${dayMonthLabel(from)} – ${dayMonthLabel(to)}${yearSuffix}`;
}

export function weekTitle(start: string, today: string): string {
  const weeksAgo = Math.round(diffDays(start, currentWeekStart(today)) / WEEK_LENGTH);
  if (weeksAgo === 0) {
    return 'This week';
  }
  if (weeksAgo === 1) {
    return 'Last week';
  }
  return `${weeksAgo} weeks ago`;
}
