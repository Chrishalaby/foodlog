export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') {
        index++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
}

export function csvTable(text: string): CsvTable | null {
  const [head, ...body] = parseCsv(text);
  if (!head || head.length < 2) {
    return null;
  }
  const headers = head.map((cell) => cell.trim());
  return {
    headers,
    rows: body.map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? '').trim()])),
    ),
  };
}
