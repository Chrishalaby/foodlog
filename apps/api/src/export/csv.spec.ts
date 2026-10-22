import {
  CSV_BOM,
  csvCell,
  csvRow,
  neutralizeFormula,
  quoteCsvField,
  toCsv,
} from './csv.js';

describe('quoteCsvField', () => {
  it('leaves simple text untouched', () => {
    expect(quoteCsvField('Greek yogurt')).toBe('Greek yogurt');
    expect(quoteCsvField('')).toBe('');
  });

  it('quotes fields containing commas, quotes, CR or LF and doubles inner quotes', () => {
    expect(quoteCsvField('rice, cooked')).toBe('"rice, cooked"');
    expect(quoteCsvField('the "big" one')).toBe('"the ""big"" one"');
    expect(quoteCsvField('line one\nline two')).toBe('"line one\nline two"');
    expect(quoteCsvField('a\r\nb')).toBe('"a\r\nb"');
    expect(quoteCsvField('"')).toBe('""""');
  });
});

describe('neutralizeFormula', () => {
  it.each(['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tTAB', '\rCR'])(
    'prefixes %j with a single quote',
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    },
  );

  it('leaves other text alone, including formula characters later in the text', () => {
    expect(neutralizeFormula('Coffee = life')).toBe('Coffee = life');
    expect(neutralizeFormula(' =1+1')).toBe(' =1+1');
    expect(neutralizeFormula("'quoted")).toBe("'quoted");
  });
});

describe('csvCell', () => {
  it('renders null and undefined as empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('renders finite numbers verbatim without formula neutralization', () => {
    expect(csvCell(0)).toBe('0');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('neutralizes formulas before quoting', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(
      '"\'=HYPERLINK(""http://x"",""y"")"',
    );
    expect(csvCell('-2, maybe')).toBe('"\'-2, maybe"');
  });
});

describe('csvRow and toCsv', () => {
  it('joins cells with commas', () => {
    expect(csvRow(['a', 1, null, 'b,c'])).toBe('a,1,,"b,c"');
  });

  it('prefixes a UTF-8 BOM and terminates every record with CRLF', () => {
    const csv = toCsv([
      ['name', 'kcal'],
      ['Café crème', 95],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}name,kcal\r\nCafé crème,95\r\n`);
  });

  it('can omit the BOM', () => {
    expect(toCsv([['a']], { bom: false })).toBe('a\r\n');
  });

  it('keeps embedded newlines inside quoted fields', () => {
    const csv = toCsv([['multi\nline', 'x']], { bom: false });
    expect(csv).toBe('"multi\nline",x\r\n');
  });
});
