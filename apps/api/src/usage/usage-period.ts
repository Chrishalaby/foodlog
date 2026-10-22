export const MONTH_PATTERN = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;

const DAY_MS = 24 * 60 * 60 * 1000;
export const TRAILING_WINDOW_DAYS = 30;

export interface MonthRange {
  start: Date;
  end: Date;
}

export function utcMonthOf(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

export function utcMonthRange(month: string): MonthRange {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, monthIndex - 1, 1)),
    end: new Date(Date.UTC(year, monthIndex, 1)),
  };
}

export function trailingWindowStart(
  now: Date,
  days = TRAILING_WINDOW_DAYS,
): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
