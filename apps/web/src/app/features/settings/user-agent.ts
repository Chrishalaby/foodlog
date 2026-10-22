export type DeviceKind = 'phone' | 'tablet' | 'desktop' | 'unknown';

export interface DeviceDescription {
  label: string;
  kind: DeviceKind;
  browser: string | null;
  platform: string | null;
}

interface Rule {
  test: RegExp;
  name: string;
}

const BROWSERS: readonly Rule[] = [
  { test: /EdgA?\/|EdgiOS\//, name: 'Edge' },
  { test: /OPR\/|Opera/, name: 'Opera' },
  { test: /SamsungBrowser\//, name: 'Samsung Internet' },
  { test: /Firefox\/|FxiOS\//, name: 'Firefox' },
  { test: /CriOS\/|Chrome\/|Chromium\//, name: 'Chrome' },
  { test: /Version\/[\d.]+.*Safari\/|AppleWebKit\/.*Mobile\//, name: 'Safari' },
];

function detectBrowser(ua: string): string | null {
  return BROWSERS.find((rule) => rule.test.test(ua))?.name ?? null;
}

function detectPlatform(ua: string): { platform: string | null; kind: DeviceKind } {
  if (/iPad/.test(ua)) {
    return { platform: 'iPad', kind: 'tablet' };
  }
  if (/iPhone|iPod/.test(ua)) {
    return { platform: 'iPhone', kind: 'phone' };
  }
  if (/Android/.test(ua)) {
    return /Mobile/.test(ua)
      ? { platform: 'Android phone', kind: 'phone' }
      : { platform: 'Android tablet', kind: 'tablet' };
  }
  if (/CrOS/.test(ua)) {
    return { platform: 'Chromebook', kind: 'desktop' };
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    return { platform: 'Mac', kind: 'desktop' };
  }
  if (/Windows/.test(ua)) {
    return { platform: 'Windows', kind: 'desktop' };
  }
  if (/Linux|X11/.test(ua)) {
    return { platform: 'Linux', kind: 'desktop' };
  }
  return { platform: null, kind: 'unknown' };
}

export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  const ua = (userAgent ?? '').trim();
  if (!ua) {
    return { label: 'Unknown device', kind: 'unknown', browser: null, platform: null };
  }
  const browser = detectBrowser(ua);
  const { platform, kind } = detectPlatform(ua);
  let label = 'Unknown device';
  if (browser && platform) {
    label = `${browser} on ${platform}`;
  } else if (platform) {
    label = platform;
  } else if (browser) {
    label = browser;
  }
  return { label, kind, browser, platform };
}
