import {
  isFiniteNumber,
  roundTo,
  TARGET_KEYS,
  TARGET_META,
  TARGET_OVERRIDE_BOUNDS,
  type TargetKey,
  type TargetOverrides,
} from '@food/shared';

const TARGET_KEY_SET: ReadonlySet<string> = new Set(TARGET_KEYS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTargetKey(key: string): key is TargetKey {
  return TARGET_KEY_SET.has(key);
}

function isWithinBounds(key: TargetKey, value: number): boolean {
  const { min, max } = TARGET_OVERRIDE_BOUNDS[key];
  return value >= min && value <= max;
}

function overrideDecimals(key: TargetKey): number {
  return TARGET_META[key].unit === 'g' ? 1 : 0;
}

export function targetOverrideProblems(value: unknown): string[] {
  if (!isPlainObject(value)) {
    return ['targetOverrides must be an object'];
  }
  return Object.entries(value).flatMap(([key, override]) => {
    if (!isTargetKey(key)) {
      return [`targetOverrides.${key} is not a known target`];
    }
    if (override === null || override === undefined) {
      return [];
    }
    if (isFiniteNumber(override) && isWithinBounds(key, override)) {
      return [];
    }
    const { min, max } = TARGET_OVERRIDE_BOUNDS[key];
    return [
      `targetOverrides.${key} must be a number between ${min} and ${max}, or null`,
    ];
  });
}

export function normalizeTargetOverrides(value: unknown): TargetOverrides {
  const source = isPlainObject(value) ? value : {};
  const overrides: TargetOverrides = {};
  for (const key of TARGET_KEYS) {
    const override = source[key];
    if (isFiniteNumber(override) && isWithinBounds(key, override)) {
      overrides[key] = roundTo(override, overrideDecimals(key));
    }
  }
  return overrides;
}
