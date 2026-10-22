import {
  gtinFromBracketedElements,
  gtinFromDigitalLink,
  gtinFromElementString,
  gtinFromPayload,
  normalizeGtin,
  readScannedCode,
} from './gs1-payload';

const GS = '\u001d';
const EAN = '5281234567896';
const GTIN14 = '09506000134352';
const GTIN14_AS_13 = '9506000134352';

describe('normalizeGtin', () => {
  it('keeps the same key a linear scan of the product would produce', () => {
    expect(normalizeGtin(EAN)).toBe(EAN);
    expect(normalizeGtin(`0${EAN}`)).toBe(EAN);
    expect(normalizeGtin('036000291452')).toBe('0036000291452');
    expect(normalizeGtin('00036000291452')).toBe('0036000291452');
    expect(normalizeGtin('96385074')).toBe('96385074');
    expect(normalizeGtin('00000096385074')).toBe('96385074');
    expect(normalizeGtin('10012345600019')).toBe('10012345600019');
  });

  it('rejects wrong check digits and lengths that are not GTINs', () => {
    expect(normalizeGtin('5281234567890')).toBeNull();
    expect(normalizeGtin('09506000134353')).toBeNull();
    expect(normalizeGtin('123456789')).toBeNull();
    expect(normalizeGtin('04252614')).toBeNull();
    expect(normalizeGtin('')).toBeNull();
  });
});

describe('GS1 Digital Link', () => {
  it('reads the GTIN from the canonical resolver and from brand domains', () => {
    expect(gtinFromDigitalLink(`https://id.gs1.org/01/${GTIN14}`)).toBe(GTIN14_AS_13);
    expect(gtinFromDigitalLink(`https://brand.example.com/products/01/0${EAN}`)).toBe(EAN);
    expect(gtinFromDigitalLink(`http://example.org/01/${EAN}/`)).toBe(EAN);
  });

  it('ignores extra key qualifiers, attributes, query and fragment', () => {
    expect(
      gtinFromDigitalLink(
        `https://id.gs1.org/01/${GTIN14}/10/ABC123/21/12345?17=261231&3103=000500`,
      ),
    ).toBe(GTIN14_AS_13);
    expect(gtinFromDigitalLink(`https://example.com/01/${GTIN14}?linkType=gs1:pip#top`)).toBe(
      GTIN14_AS_13,
    );
  });

  it('accepts upper-case QR alphanumeric URLs, the gtin alias and encoded segments', () => {
    expect(gtinFromDigitalLink(`HTTPS://ID.GS1.ORG/01/${GTIN14}`)).toBe(GTIN14_AS_13);
    expect(gtinFromDigitalLink(`https://example.com/gtin/${GTIN14}`)).toBe(GTIN14_AS_13);
    expect(gtinFromDigitalLink(`https://example.com/%30%31/${GTIN14}`)).toBe(GTIN14_AS_13);
  });

  it('pads GTIN-8 and GTIN-12 keys like the barcode on the pack', () => {
    expect(gtinFromDigitalLink('https://id.gs1.org/01/00000096385074')).toBe('96385074');
    expect(gtinFromDigitalLink('https://id.gs1.org/01/96385074')).toBe('96385074');
    expect(gtinFromDigitalLink('https://id.gs1.org/01/036000291452')).toBe('0036000291452');
  });

  it('rejects links without a valid GTIN key and non-web schemes', () => {
    expect(gtinFromDigitalLink('https://example.com/menu')).toBeNull();
    expect(gtinFromDigitalLink('https://news.example.com/2026/01/28/story')).toBeNull();
    expect(gtinFromDigitalLink('https://id.gs1.org/01/09506000134353')).toBeNull();
    expect(gtinFromDigitalLink(`https://id.gs1.org/414/${GTIN14}`)).toBeNull();
    expect(gtinFromDigitalLink(`https://id.gs1.org/01/${GTIN14}abc`)).toBeNull();
    expect(gtinFromDigitalLink(`ftp://id.gs1.org/01/${GTIN14}`)).toBeNull();
    expect(gtinFromDigitalLink(`javascript:alert(1)//01/${GTIN14}`)).toBeNull();
    expect(gtinFromDigitalLink('not a url')).toBeNull();
  });
});

describe('GS1 element strings', () => {
  it('reads the human-readable form with parentheses', () => {
    expect(gtinFromBracketedElements(`(01)${GTIN14}(17)261231(10)ABC`)).toBe(GTIN14_AS_13);
    expect(gtinFromBracketedElements(`(02)${GTIN14}(01) ${GTIN14}`)).toBe(GTIN14_AS_13);
    expect(gtinFromBracketedElements(`(01)${GTIN14}9`)).toBeNull();
    expect(gtinFromBracketedElements(`(01)0950600013435`)).toBeNull();
  });

  it('reads raw element strings with and without FNC1 separators', () => {
    expect(gtinFromElementString(`01${GTIN14}`)).toBe(GTIN14_AS_13);
    expect(gtinFromElementString(`01${GTIN14}10ABC123${GS}17261231`)).toBe(GTIN14_AS_13);
    expect(gtinFromElementString(`${GS}01${GTIN14}${GS}21XYZ`)).toBe(GTIN14_AS_13);
    expect(gtinFromElementString(`]Q301${GTIN14}10ABC`)).toBe(GTIN14_AS_13);
    expect(gtinFromElementString(`]d201${GTIN14}`)).toBe(GTIN14_AS_13);
  });

  it('skips fixed-length and separated elements that come before the GTIN', () => {
    expect(gtinFromElementString(`1726123101${GTIN14}`)).toBe(GTIN14_AS_13);
    expect(gtinFromElementString(`10LOT42${GS}01${GTIN14}`)).toBe(GTIN14_AS_13);
    expect(gtinFromElementString(`00123456789012345675${GS}01${GTIN14}`)).toBe(GTIN14_AS_13);
  });

  it('returns null when there is no complete, valid GTIN element', () => {
    expect(gtinFromElementString(`10LOT42`)).toBeNull();
    expect(gtinFromElementString(`01${GTIN14.slice(0, 10)}`)).toBeNull();
    expect(gtinFromElementString(`0109506000134353`)).toBeNull();
    expect(gtinFromElementString('12 apples')).toBeNull();
    expect(gtinFromElementString('hello')).toBeNull();
  });
});

describe('gtinFromPayload', () => {
  it('normalizes bare 8, 12, 13 and 14 digit codes', () => {
    expect(gtinFromPayload(` ${EAN} `)).toBe(EAN);
    expect(gtinFromPayload('036000291452')).toBe('0036000291452');
    expect(gtinFromPayload('96385074')).toBe('96385074');
    expect(gtinFromPayload(GTIN14)).toBe(GTIN14_AS_13);
  });

  it('never guesses UPC-E or accepts other digit runs', () => {
    expect(gtinFromPayload('04252614')).toBeNull();
    expect(gtinFromPayload('0501234567')).toBeNull();
    expect(gtinFromPayload('5281234567890')).toBeNull();
  });

  it('understands every GS1 carrier form', () => {
    expect(gtinFromPayload(`https://id.gs1.org/01/${GTIN14}/10/ABC`)).toBe(GTIN14_AS_13);
    expect(gtinFromPayload(`(01)${GTIN14}(10)ABC`)).toBe(GTIN14_AS_13);
    expect(gtinFromPayload(`01${GTIN14}10ABC${GS}17261231`)).toBe(GTIN14_AS_13);
    expect(gtinFromPayload(`01${GTIN14}17261231`)).toBe(GTIN14_AS_13);
  });

  it('finds no product code in ordinary QR content', () => {
    expect(gtinFromPayload('https://restaurant.example/menu?table=5')).toBeNull();
    expect(gtinFromPayload('WIFI:S:Cafe;T:WPA;P:secret;;')).toBeNull();
    expect(gtinFromPayload('Hello there')).toBeNull();
    expect(gtinFromPayload('   ')).toBeNull();
  });
});

describe('readScannedCode', () => {
  it('canonicalizes linear barcodes with their symbology rules', () => {
    expect(readScannedCode('01234565', 'upc_e')).toEqual({
      kind: 'product',
      code: '0012345000065',
    });
    expect(readScannedCode('036000291452', 'upc_a')).toEqual({
      kind: 'product',
      code: '0036000291452',
    });
    expect(readScannedCode('5281234567890', 'ean_13')).toEqual({ kind: 'invalid' });
  });

  it('reads product codes from QR codes and flags other QR content', () => {
    expect(readScannedCode(`https://id.gs1.org/01/${GTIN14}`, 'qr_code')).toEqual({
      kind: 'product',
      code: GTIN14_AS_13,
    });
    expect(readScannedCode(`01${GTIN14}`, 'qr_code')).toEqual({
      kind: 'product',
      code: GTIN14_AS_13,
    });
    expect(readScannedCode('https://example.com/promo', 'qr_code')).toEqual({ kind: 'other' });
  });
});
