import { BadRequestException } from '@nestjs/common';
import {
  BARCODE_CHECK_DIGIT_MESSAGE,
  BARCODE_FORMAT_MESSAGE,
  canonicalBarcode,
  checkBarcode,
  expandUpcE,
  gs1CheckDigit,
  hasValidCheckDigit,
  toGtin13,
} from './barcode.js';
import { ParseBarcodePipe } from './parse-barcode.pipe.js';

describe('barcode parity with the web scanner (fixtures of apps/web gs1.spec.ts)', () => {
  it('computes the mod-10 check digit from the right', () => {
    expect(gs1CheckDigit('400638133393')).toBe(1);
    expect(gs1CheckDigit('528123456789')).toBe(6);
    expect(gs1CheckDigit('03600029145')).toBe(2);
    expect(gs1CheckDigit('9638507')).toBe(4);
  });

  it('validates EAN-13, UPC-A, EAN-8 and GTIN-14 check digits', () => {
    expect(hasValidCheckDigit('4006381333931')).toBe(true);
    expect(hasValidCheckDigit('5281234567896')).toBe(true);
    expect(hasValidCheckDigit('036000291452')).toBe(true);
    expect(hasValidCheckDigit('96385074')).toBe(true);
    expect(hasValidCheckDigit('00012345600012')).toBe(true);
    expect(hasValidCheckDigit('4006381333932')).toBe(false);
    expect(hasValidCheckDigit('5281234567869')).toBe(false);
    expect(hasValidCheckDigit('12345')).toBe(false);
    expect(hasValidCheckDigit('40063813339a1')).toBe(false);
  });

  it('expands UPC-E to UPC-A', () => {
    expect(expandUpcE('01234565')).toBe('012345000065');
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(expandUpcE('23456789')).toBeNull();
  });

  it('canonicalizes codes to GTIN-13 so the same product always gets the same key', () => {
    expect(canonicalBarcode('5281234567896')).toBe('5281234567896');
    expect(canonicalBarcode(' 036000291452 ')).toBe('0036000291452');
    expect(canonicalBarcode('0036000291452')).toBe('0036000291452');
    expect(canonicalBarcode('96385074')).toBe('96385074');
    expect(canonicalBarcode('0012345000065')).toBe('0012345000065');
    expect(canonicalBarcode('00012345600012')).toBe('0012345600012');
    expect(canonicalBarcode('10012345600019')).toBe('10012345600019');
  });

  it('rejects codes with a wrong check digit or odd length', () => {
    expect(canonicalBarcode('5281234567890')).toBeNull();
    expect(canonicalBarcode('01234567')).toBeNull();
    expect(canonicalBarcode('96385075')).toBeNull();
    expect(canonicalBarcode('123456789')).toBeNull();
    expect(canonicalBarcode('')).toBeNull();
    expect(canonicalBarcode('abc')).toBeNull();
  });

  it('falls back to UPC-E for typed 8-digit codes that are not EAN-8', () => {
    expect(canonicalBarcode('04252614')).toBe('0042100005264');
    expect(canonicalBarcode('01234565')).toBe('01234565');
  });

  it.each([
    '5281234567896',
    '0036000291452',
    '96385074',
    '0012345000065',
    '0012345600012',
    '10012345600019',
    '0042100005264',
    '01234565',
  ])('keeps the web canonical form %s unchanged', (code) => {
    expect(canonicalBarcode(code)).toBe(code);
    expect(checkBarcode(code)).toEqual({ valid: true, barcode: code });
  });
});

describe('GS1 check digits', () => {
  it.each([
    ['0001234560001', 2],
    ['528000123456', 6],
  ])('computes the check digit of %s', (payload, digit) => {
    expect(gs1CheckDigit(payload)).toBe(digit);
  });

  it.each(['0036000291452', '5280001234566'])('accepts %s', (code) => {
    expect(hasValidCheckDigit(code)).toBe(true);
  });

  it.each(['036000291453', '96385075', '00012345600013', '1234567', '0'])(
    'rejects %s',
    (code) => {
      expect(hasValidCheckDigit(code)).toBe(false);
    },
  );
});

describe('toGtin13', () => {
  it('stores a 12-digit UPC-A in its EAN-13 form', () => {
    expect(toGtin13('036000291452')).toBe('0036000291452');
  });

  it('drops the zero indicator of a GTIN-14', () => {
    expect(toGtin13('00036000291452')).toBe('0036000291452');
  });

  it.each(['0036000291452', '4006381333931', '96385074', '10012345600019'])(
    'keeps %s unchanged',
    (code) => {
      expect(toGtin13(code)).toBe(code);
    },
  );
});

describe('expandUpcE', () => {
  it.each([
    ['04963406', '049000006346'],
    ['01234531', '012300000451'],
    ['01234543', '012340000053'],
    ['01234572', '012345000072'],
    ['01234523', '012200003453'],
  ])('expands %s to the UPC-A %s', (code, upcA) => {
    expect(expandUpcE(code)).toBe(upcA);
  });

  it('expands without judging the check digit, which canonicalBarcode verifies', () => {
    expect(expandUpcE('04252615')).toBe('042100005265');
    expect(canonicalBarcode('04252615')).toBeNull();
  });

  it.each(['24252614', '0425261', '042526140'])('rejects %s', (code) => {
    expect(expandUpcE(code)).toBeNull();
  });
});

describe('checkBarcode', () => {
  it('maps every scanner form of the same UPC product to one code', () => {
    const forms = ['036000291452', '0036000291452', '00036000291452'];
    expect(forms.map(checkBarcode)).toEqual(
      forms.map(() => ({ valid: true, barcode: '0036000291452' })),
    );
  });

  it('maps a UPC-E code to the EAN-13 form of its UPC-A expansion', () => {
    expect(checkBarcode('04252614')).toEqual({
      valid: true,
      barcode: '0042100005264',
    });
    expect(checkBarcode('042100005264')).toEqual(checkBarcode('04252614'));
  });

  it('keeps an 8-digit code with a valid EAN-8 check digit as EAN-8', () => {
    expect(checkBarcode('01234565')).toEqual({
      valid: true,
      barcode: '01234565',
    });
  });

  it('ignores surrounding whitespace like the web does', () => {
    expect(checkBarcode(' 4006381333931\n')).toEqual({
      valid: true,
      barcode: '4006381333931',
    });
  });

  it.each([
    '',
    '   ',
    '12345',
    '123456',
    '1234567',
    '123456789',
    '1234567890',
    '12345678901',
    '123456789012345',
    '40063813339a1',
    '4006-381333931',
    '4006 381333931',
    '+4006381333931',
    '４００６３８１３３３９３１',
  ])('rejects the format of %j', (code) => {
    expect(checkBarcode(code)).toEqual({
      valid: false,
      message: BARCODE_FORMAT_MESSAGE,
    });
  });

  it.each([
    '4006381333932',
    '036000291453',
    '96385075',
    '00012345600013',
    '04252615',
    '01234567',
  ])('rejects the check digit of %s', (code) => {
    expect(checkBarcode(code)).toEqual({
      valid: false,
      message: BARCODE_CHECK_DIGIT_MESSAGE,
    });
  });

  it('returns canonical codes that stay unchanged when sent again', () => {
    for (let n = 0; n < 2000; n += 1) {
      const payload = String(n * 7919).padStart(11, '0');
      const upcA = `${payload}${gs1CheckDigit(payload)}`;
      for (const code of [upcA, `0${upcA}`, `00${upcA}`, upcA.slice(4)]) {
        const result = checkBarcode(code);
        const canonical = canonicalBarcode(code);
        expect(result.valid ? result.barcode : null).toBe(canonical);
        if (canonical !== null) {
          expect(canonicalBarcode(canonical)).toBe(canonical);
        }
      }
    }
  });
});

describe('ParseBarcodePipe', () => {
  const pipe = new ParseBarcodePipe();

  it('returns the canonical barcode', () => {
    expect(pipe.transform('036000291452')).toBe('0036000291452');
  });

  it.each([
    ['4006381333932', BARCODE_CHECK_DIGIT_MESSAGE],
    ['abc', BARCODE_FORMAT_MESSAGE],
    ['123456', BARCODE_FORMAT_MESSAGE],
    [undefined, BARCODE_FORMAT_MESSAGE],
    [4006381333931, BARCODE_FORMAT_MESSAGE],
  ])('rejects %j with 400', (value, message) => {
    expect(() => pipe.transform(value)).toThrow(
      new BadRequestException(message),
    );
  });
});
