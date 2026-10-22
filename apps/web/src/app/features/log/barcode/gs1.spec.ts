import {
  BARCODE_INPUT_MESSAGES,
  barcodeInputProblem,
  canonicalBarcode,
  digitsOnly,
  expandUpcE,
  formatBarcode,
  gs1CheckDigit,
  hasValidCheckDigit,
} from './gs1';

describe('GS1 barcodes', () => {
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
    expect(canonicalBarcode('5281234567896', 'ean_13')).toBe('5281234567896');
    expect(canonicalBarcode(' 036000291452 ', 'upc_a')).toBe('0036000291452');
    expect(canonicalBarcode('0036000291452', 'ean_13')).toBe('0036000291452');
    expect(canonicalBarcode('96385074', 'ean_8')).toBe('96385074');
    expect(canonicalBarcode('01234565', 'upc_e')).toBe('0012345000065');
    expect(canonicalBarcode('00012345600012')).toBe('0012345600012');
    expect(canonicalBarcode('10012345600019')).toBe('10012345600019');
  });

  it('rejects codes with a wrong check digit or odd length', () => {
    expect(canonicalBarcode('5281234567890', 'ean_13')).toBeNull();
    expect(canonicalBarcode('01234567', 'upc_e')).toBeNull();
    expect(canonicalBarcode('96385075', 'ean_8')).toBeNull();
    expect(canonicalBarcode('123456789')).toBeNull();
    expect(canonicalBarcode('')).toBeNull();
    expect(canonicalBarcode('abc')).toBeNull();
  });

  it('falls back to UPC-E for typed 8-digit codes that are not EAN-8', () => {
    expect(canonicalBarcode('04252614')).toBe('0042100005264');
    expect(canonicalBarcode('01234565')).toBe('01234565');
  });

  it('formats codes for display', () => {
    expect(formatBarcode('5281234567896')).toBe('5 281234 567896');
    expect(formatBarcode('96385074')).toBe('9638 5074');
    expect(formatBarcode('036000291452')).toBe('0 36000 29145 2');
    expect(formatBarcode('12345678901234')).toBe('12345678901234');
  });

  it('explains what is wrong with a typed number', () => {
    expect(digitsOnly('528 1234-567896')).toBe('5281234567896');
    expect(barcodeInputProblem('')).toBe('empty');
    expect(barcodeInputProblem('52812345')).toBe('check');
    expect(barcodeInputProblem('528123456')).toBe('length');
    expect(barcodeInputProblem('5281234567890')).toBe('check');
    expect(barcodeInputProblem('5 281234 567896')).toBeNull();
    expect(BARCODE_INPUT_MESSAGES.check).toMatch(/check each digit/i);
    expect(BARCODE_INPUT_MESSAGES.length).toMatch(/8, 12, 13 or 14 digits/);
  });
});
