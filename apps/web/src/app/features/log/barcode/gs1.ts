import { BARCODE_PATTERN } from '@food/shared';

export const GTIN_LENGTHS: readonly number[] = [8, 12, 13, 14];
export const BARCODE_INPUT_MAX = 14;

const DIGITS = /^\d+$/;
const UPC_E = /^[01]\d{7}$/;

export function digitsOnly(text: string): string {
  return text.replace(/\D+/g, '');
}

export function gs1CheckDigit(body: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(code: string): boolean {
  if (!DIGITS.test(code) || !GTIN_LENGTHS.includes(code.length)) {
    return false;
  }
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

export function expandUpcE(code: string): string | null {
  if (!UPC_E.test(code)) {
    return null;
  }
  const [system, d1, d2, d3, d4, d5, d6, check] = Array.from(code);
  const last = Number(d6);
  let body: string;
  if (last <= 2) {
    body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  } else if (last === 3) {
    body = `${d1}${d2}${d3}00000${d4}${d5}`;
  } else if (last === 4) {
    body = `${d1}${d2}${d3}${d4}00000${d5}`;
  } else {
    body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
  return `${system}${body}${check}`;
}

function toGtin13(code: string): string {
  if (code.length === 12) {
    return `0${code}`;
  }
  if (code.length === 14 && code.startsWith('0')) {
    return code.slice(1);
  }
  return code;
}

function fromUpcE(code: string): string | null {
  const expanded = expandUpcE(code);
  return expanded && hasValidCheckDigit(expanded) ? toGtin13(expanded) : null;
}

export function canonicalBarcode(raw: string, format?: string): string | null {
  const code = raw.trim();
  if (!DIGITS.test(code)) {
    return null;
  }
  if (format === 'upc_e') {
    return fromUpcE(code);
  }
  if (hasValidCheckDigit(code)) {
    const canonical = toGtin13(code);
    return BARCODE_PATTERN.test(canonical) ? canonical : null;
  }
  return code.length === 8 && format === undefined ? fromUpcE(code) : null;
}

export function formatBarcode(code: string): string {
  switch (code.length) {
    case 13:
      return `${code.slice(0, 1)} ${code.slice(1, 7)} ${code.slice(7)}`;
    case 12:
      return `${code.slice(0, 1)} ${code.slice(1, 6)} ${code.slice(6, 11)} ${code.slice(11)}`;
    case 8:
      return `${code.slice(0, 4)} ${code.slice(4)}`;
    default:
      return code;
  }
}

export type BarcodeInputProblem = 'empty' | 'length' | 'check';

export function barcodeInputProblem(text: string): BarcodeInputProblem | null {
  const code = digitsOnly(text);
  if (code.length === 0) {
    return 'empty';
  }
  if (!GTIN_LENGTHS.includes(code.length)) {
    return 'length';
  }
  return canonicalBarcode(code) ? null : 'check';
}

export const BARCODE_INPUT_MESSAGES: Record<BarcodeInputProblem, string> = {
  empty: 'Type the digits under the barcode.',
  length: 'Barcodes have 8, 12, 13 or 14 digits. Check you typed them all.',
  check: "That number doesn't add up. Check each digit against the package.",
};
