export type CsvValue = string | number | null | undefined;

export const CSV_BOM = '\uFEFF';
export const CSV_LINE_BREAK = '\r\n';

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;
const NEEDS_QUOTING = /[",\r\n]/;

export function neutralizeFormula(text: string): string {
  return FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))
    ? `'${text}`
    : text;
}

export function quoteCsvField(text: string): string {
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  return quoteCsvField(neutralizeFormula(value));
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(',');
}

export function toCsv(
  rows: readonly (readonly CsvValue[])[],
  options: { bom?: boolean } = {},
): string {
  const prefix = options.bom === false ? '' : CSV_BOM;
  return prefix + rows.map((row) => csvRow(row) + CSV_LINE_BREAK).join('');
}
