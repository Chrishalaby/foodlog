import {
  MICRO_GROUPS,
  MICRO_KEYS,
  MICRO_META,
  isFiniteNumber,
  microPercent,
  microTargets,
  roundTo,
  type MicroGroup,
  type MicroKey,
  type MicroTarget,
  type MicroTargets,
  type Micros,
  type MicrosCoverage,
  type ProfileDto,
} from '@food/shared';
import { formatNumber } from '../../utils/format';

export const MICROS_TITLE = 'Vitamins & minerals';
export const MICROS_DISCLAIMER = 'Rough estimates to spot gaps, not exact amounts';
export const MICROS_NO_DATA = 'No vitamin data yet';

export type MicrosScope = 'day' | 'week' | 'meal';
export type MicroTone = 'unknown' | 'progress' | 'met' | 'limit' | 'warn';

export const MICRO_GROUP_TITLES: Record<MicroGroup, string> = {
  vitamin: 'Vitamins',
  mineral: 'Minerals',
  other: 'Other',
};

export interface MicroRow {
  key: MicroKey;
  label: string;
  known: boolean;
  limit: boolean;
  amountText: string;
  targetText: string;
  percent: number | null;
  percentText: string;
  fill: number;
  tone: MicroTone;
  note: string | null;
  srText: string;
}

export interface MicroGroupView {
  group: MicroGroup;
  title: string;
  rows: MicroRow[];
}

export interface MicrosSummary {
  text: string;
  warn: boolean;
}

export function microTargetsFor(profile: Pick<ProfileDto, 'sex' | 'age'> | null): MicroTargets {
  return microTargets(profile?.sex ?? null, profile?.age ?? null);
}

function withUnit(key: MicroKey, text: string): string {
  return `${text} ${MICRO_META[key].unit}`;
}

export function formatMicroAmount(key: MicroKey, amount: number): string {
  const decimals = MICRO_META[key].decimals;
  if (amount > 0 && roundTo(amount, decimals) === 0) {
    return withUnit(key, `<${formatNumber(10 ** -decimals, decimals)}`);
  }
  return withUnit(key, formatNumber(amount, decimals));
}

function targetAmountText(key: MicroKey, amount: number): string {
  return withUnit(key, formatNumber(amount, MICRO_META[key].decimals));
}

export function upperLimitNote(key: MicroKey, upperLimit: number): string {
  return `Above the usual upper limit (${targetAmountText(key, upperLimit)}/day)`;
}

export function overLimitNote(key: MicroKey, limit: number): string {
  return `Over the ${targetAmountText(key, limit)}/day limit`;
}

function knownAmount(micros: Micros | null | undefined, key: MicroKey): number | null {
  const value = micros?.[key];
  return isFiniteNumber(value) && value >= 0 ? value : null;
}

function unknownRow(key: MicroKey, target: MicroTarget): MicroRow {
  const label = MICRO_META[key].label;
  const limit = target.kind === 'limit';
  return {
    key,
    label,
    known: false,
    limit,
    amountText: '—',
    targetText: targetAmountText(key, target.amount),
    percent: null,
    percentText: '',
    fill: 0,
    tone: 'unknown',
    note: null,
    srText: `${label}: no estimate.`,
  };
}

function rowNote(key: MicroKey, amount: number, target: MicroTarget): string | null {
  if (target.kind === 'limit') {
    return target.amount > 0 && amount > target.amount ? overLimitNote(key, target.amount) : null;
  }
  return target.upperLimit !== null && amount > target.upperLimit
    ? upperLimitNote(key, target.upperLimit)
    : null;
}

function rowTone(target: MicroTarget, percent: number, note: string | null): MicroTone {
  if (note !== null) {
    return 'warn';
  }
  if (target.kind === 'limit') {
    return 'limit';
  }
  return percent >= 100 ? 'met' : 'progress';
}

function rowSrText(row: Omit<MicroRow, 'srText'>, target: MicroTarget): string {
  const share =
    target.kind === 'limit'
      ? `${row.percentText} of the ${row.targetText} daily limit`
      : `${row.percentText} of the ${row.targetText} daily target`;
  const base = `${row.label}: ${row.amountText}, ${share}.`;
  return row.note ? `${base} ${row.note}.` : base;
}

export function microRow(key: MicroKey, amount: number | null, target: MicroTarget): MicroRow {
  if (amount === null) {
    return unknownRow(key, target);
  }
  const percent = microPercent(amount, target.amount);
  const note = rowNote(key, amount, target);
  const row = {
    key,
    label: MICRO_META[key].label,
    known: true,
    limit: target.kind === 'limit',
    amountText: formatMicroAmount(key, amount),
    targetText: targetAmountText(key, target.amount),
    percent,
    percentText: `${formatNumber(percent)}%`,
    fill: Math.min(100, Math.max(0, percent)),
    tone: rowTone(target, percent, note),
    note,
  };
  return { ...row, srText: rowSrText(row, target) };
}

export function microGroups(
  micros: Micros | null | undefined,
  targets: MicroTargets,
): MicroGroupView[] {
  return MICRO_GROUPS.map((group) => ({
    group,
    title: MICRO_GROUP_TITLES[group],
    rows: MICRO_KEYS.filter((key) => MICRO_META[key].group === group).map((key) =>
      microRow(key, knownAmount(micros, key), targets[key]),
    ),
  }));
}

function foods(count: number): string {
  return count === 1 ? 'food' : 'foods';
}

export function microsCoverageText(
  coverage: MicrosCoverage | null | undefined,
  scope: MicrosScope,
): string | null {
  const items = Math.max(0, Math.round(coverage?.items ?? 0));
  const known = Math.min(items, Math.max(0, Math.round(coverage?.withMicros ?? 0)));
  if (items === 0) {
    return null;
  }
  const older = scope === 'meal' ? '' : '; older logs have no vitamin data';
  if (known === items) {
    return items === 1 ? 'Estimated for 1 food' : `Estimated for all ${items} foods`;
  }
  if (known === 0) {
    return `No estimates for ${items === 1 ? 'this food' : `these ${items} foods`}${older}`;
  }
  return `Estimated for ${known} of ${items} ${foods(items)}${older}`;
}

function shortCoverage(coverage: MicrosCoverage | null | undefined): string {
  const items = Math.max(0, Math.round(coverage?.items ?? 0));
  const known = Math.min(items, Math.max(0, Math.round(coverage?.withMicros ?? 0)));
  if (items === 0) {
    return 'Rough estimate';
  }
  if (known === items) {
    return items === 1 ? 'Estimated for 1 food' : `Estimated for all ${items} foods`;
  }
  return `Estimated for ${known} of ${items} ${foods(items)}`;
}

export function microsSummary(
  groups: readonly MicroGroupView[],
  coverage: MicrosCoverage | null | undefined,
): MicrosSummary {
  const rows = groups.flatMap((group) => group.rows);
  const warnings = rows.filter((row) => row.tone === 'warn');
  if (warnings.length === 1) {
    const [row] = warnings;
    return {
      text: `${row.label} ${row.limit ? 'over the limit' : 'above the usual limit'}`,
      warn: true,
    };
  }
  if (warnings.length > 1) {
    return { text: `${warnings.length} above usual limits`, warn: true };
  }
  if (!rows.some((row) => row.known)) {
    return { text: MICROS_NO_DATA, warn: false };
  }
  return { text: shortCoverage(coverage), warn: false };
}
