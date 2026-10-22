import { csvTable, parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields, escaped quotes, commas and line breaks', () => {
    const text = '﻿name,note\r\n"Bread, pita","said ""fresh""\nnext line"\r\nEgg,\n\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Bread, pita', 'said "fresh"\nnext line'],
      ['Egg', ''],
    ]);
  });

  it('keeps a last row without a trailing newline and drops blank rows', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('\n , \n')).toEqual([]);
  });
});

describe('csvTable', () => {
  it('turns rows into records keyed by trimmed headers', () => {
    expect(csvTable(' Day , Weight \n2025-03-01, 82.4 \n2025-03-02')).toEqual({
      headers: ['Day', 'Weight'],
      rows: [
        { Day: '2025-03-01', Weight: '82.4' },
        { Day: '2025-03-02', Weight: '' },
      ],
    });
    expect(csvTable('only-one-column\n1')).toBeNull();
    expect(csvTable('')).toBeNull();
  });
});
