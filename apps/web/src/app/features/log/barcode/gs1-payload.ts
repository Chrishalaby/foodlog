import { canonicalBarcode, hasValidCheckDigit } from './gs1';

export type ScannedCode =
  | { readonly kind: 'product'; readonly code: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'other' };

export const LINEAR_FORMATS: ReadonlySet<string> = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e']);

const GROUP_SEPARATOR = '\u001d';
const GTIN_AI = '01';
const GTIN14_LENGTH = 14;
const GTIN8_PADDING = '000000';
const DIGITS = /^\d+$/;
const TWO_DIGITS = /^\d{2}$/;
const SYMBOLOGY_ID = /^\][A-Za-z][0-9A-Za-z]/;
const BRACKETED_GTIN = /\(01\)\s*(\d{14})(?!\d)/;
const DIGITAL_LINK_KEYS: ReadonlySet<string> = new Set(['01', 'gtin']);
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

const PREDEFINED_ELEMENT_LENGTHS: Readonly<Record<string, number>> = {
  '00': 20,
  '02': 16,
  '03': 16,
  '04': 18,
  '11': 8,
  '12': 8,
  '13': 8,
  '14': 8,
  '15': 8,
  '16': 8,
  '17': 8,
  '18': 8,
  '19': 8,
  '20': 4,
  '31': 10,
  '32': 10,
  '33': 10,
  '34': 10,
  '35': 10,
  '36': 10,
  '41': 16,
};

export function normalizeGtin(digits: string): string | null {
  if (!hasValidCheckDigit(digits)) {
    return null;
  }
  const padded = digits.padStart(GTIN14_LENGTH, '0');
  return canonicalBarcode(
    padded.startsWith(GTIN8_PADDING) ? padded.slice(GTIN8_PADDING.length) : digits,
  );
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function gtinFromDigitalLink(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!WEB_PROTOCOLS.has(url.protocol)) {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean).map(safeDecode);
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index].toLowerCase();
    const value = segments[index + 1];
    const code = DIGITAL_LINK_KEYS.has(key) && DIGITS.test(value) ? normalizeGtin(value) : null;
    if (code) {
      return code;
    }
  }
  return null;
}

export function gtinFromBracketedElements(text: string): string | null {
  const match = BRACKETED_GTIN.exec(text);
  return match ? normalizeGtin(match[1]) : null;
}

export function gtinFromElementString(text: string): string | null {
  const data = text.replace(SYMBOLOGY_ID, '');
  let index = 0;
  while (index < data.length) {
    if (data[index] === GROUP_SEPARATOR) {
      index += 1;
      continue;
    }
    const ai = data.slice(index, index + 2);
    if (!TWO_DIGITS.test(ai)) {
      return null;
    }
    if (ai === GTIN_AI) {
      const gtin = data.slice(index + 2, index + 2 + GTIN14_LENGTH);
      return gtin.length === GTIN14_LENGTH && DIGITS.test(gtin) ? normalizeGtin(gtin) : null;
    }
    const fixed = PREDEFINED_ELEMENT_LENGTHS[ai];
    if (fixed !== undefined) {
      index += fixed;
      continue;
    }
    const next = data.indexOf(GROUP_SEPARATOR, index);
    if (next < 0) {
      return null;
    }
    index = next + 1;
  }
  return null;
}

export function gtinFromPayload(raw: string): string | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  if (DIGITS.test(text) && text.length <= GTIN14_LENGTH) {
    return normalizeGtin(text);
  }
  return (
    gtinFromDigitalLink(text) ?? gtinFromBracketedElements(text) ?? gtinFromElementString(text)
  );
}

export function readScannedCode(rawValue: string, format: string): ScannedCode {
  if (LINEAR_FORMATS.has(format)) {
    const code = canonicalBarcode(rawValue, format);
    return code ? { kind: 'product', code } : { kind: 'invalid' };
  }
  const code = gtinFromPayload(rawValue);
  return code ? { kind: 'product', code } : { kind: 'other' };
}
