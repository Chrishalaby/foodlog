import {
  EXIF_SCAN_BYTES,
  exifDateToDate,
  exifTakenAt,
  parseExifOffset,
  readExifDates,
  readPhotoTakenAt,
} from './exif';

const DATE_TIME_ORIGINAL = 0x9003;
const OFFSET_TIME_ORIGINAL = 0x9011;
const EXIF_IFD_POINTER = 0x8769;
const MAKE = 0x010f;

interface AsciiTag {
  tag: number;
  value: string;
}

interface TiffOptions {
  little?: boolean;
  ifd0?: AsciiTag[];
  exif?: AsciiTag[] | null;
  exifPointer?: number;
}

function ascii(value: string): number[] {
  return [...Array.from(value, (char) => char.charCodeAt(0)), 0];
}

function buildTiff(options: TiffOptions = {}): Uint8Array<ArrayBuffer> {
  const little = options.little ?? true;
  const ifd0 = options.ifd0 ?? [{ tag: MAKE, value: 'Pixel' }];
  const exif = options.exif === undefined ? [] : options.exif;
  const buffer = new ArrayBuffer(4096);
  const view = new DataView(buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d, false);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  const ifd0Count = ifd0.length + (exif ? 1 : 0);
  const exifAt = 8 + 2 + ifd0Count * 12 + 4;
  let dataAt = exif ? exifAt + 2 + exif.length * 12 + 4 : exifAt;

  const writeIfd = (at: number, tags: AsciiTag[], pointer: number | null): void => {
    view.setUint16(at, tags.length + (pointer === null ? 0 : 1), little);
    let entry = at + 2;
    for (const { tag, value } of tags) {
      const bytes = ascii(value);
      view.setUint16(entry, tag, little);
      view.setUint16(entry + 2, 2, little);
      view.setUint32(entry + 4, bytes.length, little);
      if (bytes.length <= 4) {
        bytes.forEach((byte, index) => view.setUint8(entry + 8 + index, byte));
      } else {
        view.setUint32(entry + 8, dataAt, little);
        bytes.forEach((byte, index) => view.setUint8(dataAt + index, byte));
        dataAt += bytes.length;
      }
      entry += 12;
    }
    if (pointer !== null) {
      view.setUint16(entry, EXIF_IFD_POINTER, little);
      view.setUint16(entry + 2, 4, little);
      view.setUint32(entry + 4, 1, little);
      view.setUint32(entry + 8, pointer, little);
      entry += 12;
    }
    view.setUint32(entry, 0, little);
  };

  writeIfd(8, ifd0, exif ? (options.exifPointer ?? exifAt) : null);
  if (exif) {
    writeIfd(exifAt, exif, null);
  }
  return new Uint8Array(buffer.slice(0, dataAt));
}

function segment(marker: number, payload: readonly number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

const JFIF = segment(0xe0, [...ascii('JFIF'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const XMP = segment(0xe1, [...ascii('http://ns.adobe.com/xap/1.0/'), ...ascii('<x:xmpmeta/>')]);
const SCAN = [0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9];

function exifSegment(tiff: Uint8Array): number[] {
  return segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]);
}

function jpeg(...parts: number[][]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([0xff, 0xd8, ...parts.flat()]);
}

const TAKEN = [
  { tag: DATE_TIME_ORIGINAL, value: '2026:09:27 13:05:42' },
  { tag: OFFSET_TIME_ORIGINAL, value: '+03:00' },
];

describe('readExifDates', () => {
  it('reads DateTimeOriginal and OffsetTimeOriginal from a JPEG after a JFIF segment', () => {
    const file = jpeg(JFIF, exifSegment(buildTiff({ exif: TAKEN })), SCAN);
    expect(readExifDates(file)).toEqual({
      dateTimeOriginal: '2026:09:27 13:05:42',
      offsetTimeOriginal: '+03:00',
    });
  });

  it('reads big-endian (Motorola) EXIF data', () => {
    const file = jpeg(exifSegment(buildTiff({ little: false, exif: TAKEN })), SCAN);
    expect(readExifDates(file)?.dateTimeOriginal).toBe('2026:09:27 13:05:42');
    expect(readExifDates(file.buffer)?.offsetTimeOriginal).toBe('+03:00');
  });

  it('reads a bare TIFF file', () => {
    expect(readExifDates(buildTiff({ exif: TAKEN }))?.dateTimeOriginal).toBe('2026:09:27 13:05:42');
  });

  it('skips an XMP segment and padding bytes before the EXIF segment', () => {
    const file = jpeg(XMP, [0xff, 0xff], exifSegment(buildTiff({ exif: TAKEN })), SCAN);
    expect(readExifDates(file)?.dateTimeOriginal).toBe('2026:09:27 13:05:42');
  });

  it('reads short values stored inline in the IFD entry', () => {
    const tiff = buildTiff({
      exif: [
        { tag: DATE_TIME_ORIGINAL, value: '2026:09:27 13:05:42' },
        { tag: OFFSET_TIME_ORIGINAL, value: 'Z' },
      ],
    });
    expect(readExifDates(tiff)?.offsetTimeOriginal).toBe('Z');
  });

  it('falls back to a DateTimeOriginal written into the first IFD', () => {
    const tiff = buildTiff({
      ifd0: [{ tag: DATE_TIME_ORIGINAL, value: '2026:09:01 07:30:00' }],
      exif: null,
    });
    expect(readExifDates(tiff)).toEqual({
      dateTimeOriginal: '2026:09:01 07:30:00',
      offsetTimeOriginal: null,
    });
  });

  it('returns null when there is no EXIF date', () => {
    expect(readExifDates(jpeg(JFIF, SCAN))).toBeNull();
    expect(readExifDates(jpeg(exifSegment(buildTiff({ exif: [] })), SCAN))).toBeNull();
    expect(readExifDates(new Uint8Array())).toBeNull();
    expect(readExifDates(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBeNull();
  });

  it('ignores EXIF that only appears after the image data starts', () => {
    const file = jpeg(JFIF, SCAN.slice(0, 6), exifSegment(buildTiff({ exif: TAKEN })));
    expect(readExifDates(file)).toBeNull();
  });

  it('never throws on any truncation of a valid file', () => {
    const file = jpeg(JFIF, exifSegment(buildTiff({ exif: TAKEN })), SCAN);
    const complete = readExifDates(file);
    for (let length = 0; length <= file.length; length++) {
      const result = readExifDates(file.subarray(0, length));
      if (result?.dateTimeOriginal) {
        expect(result.dateTimeOriginal).toBe(complete?.dateTimeOriginal);
      }
    }
  });

  it('survives corrupted pointers, counts and random bytes', () => {
    const outOfRange = buildTiff({ exif: TAKEN, exifPointer: 0xfffffff0 });
    expect(readExifDates(outOfRange)).toBeNull();

    const hugeCount = buildTiff({ exif: TAKEN });
    new DataView(hugeCount.buffer).setUint16(8, 0xffff, true);
    expect(readExifDates(hugeCount)).toBeNull();

    const badLength = jpeg([0xff, 0xe1, 0x00, 0x01]);
    expect(readExifDates(badLength)).toBeNull();

    let seed = 42;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % 256;
    };
    for (let run = 0; run < 200; run++) {
      const noise = Array.from({ length: 64 + (run % 64) }, random);
      expect(() => readExifDates(jpeg(noise))).not.toThrow();
      expect(() => readExifDates(Uint8Array.from([0x49, 0x49, 42, 0, ...noise]))).not.toThrow();
    }
  });

  it('reads from a view into a larger buffer', () => {
    const file = jpeg(exifSegment(buildTiff({ exif: TAKEN })), SCAN);
    const padded = new Uint8Array(file.length + 16);
    padded.set(file, 8);
    expect(readExifDates(padded.subarray(8))?.dateTimeOriginal).toBe('2026:09:27 13:05:42');
  });
});

describe('parseExifOffset', () => {
  it('parses signed hour and minute offsets', () => {
    expect(parseExifOffset('+03:00')).toBe(180);
    expect(parseExifOffset('-05:30')).toBe(-330);
    expect(parseExifOffset('+0545')).toBe(345);
  });

  it('rejects blanks and impossible offsets', () => {
    expect(parseExifOffset(null)).toBeNull();
    expect(parseExifOffset('   :  ')).toBeNull();
    expect(parseExifOffset('Z')).toBeNull();
    expect(parseExifOffset('+15:00')).toBeNull();
    expect(parseExifOffset('+03:75')).toBeNull();
  });
});

describe('exifDateToDate', () => {
  it('uses the recorded offset to find the exact instant', () => {
    expect(exifDateToDate('2026:09:27 13:05:42', '+03:00')?.toISOString()).toBe(
      '2026-09-27T10:05:42.000Z',
    );
    expect(exifDateToDate('2026:09:27 23:30:00', '-04:00')?.toISOString()).toBe(
      '2026-09-28T03:30:00.000Z',
    );
  });

  it('reads the wall-clock time as device-local time without an offset', () => {
    const date = exifDateToDate('2026:09:27 13:05:42');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(27);
    expect(date?.getHours()).toBe(13);
    expect(date?.getMinutes()).toBe(5);
    expect(date?.getSeconds()).toBe(42);
    expect(exifDateToDate('2026:09:27 13:05:42', 'garbage')?.getTime()).toBe(date?.getTime());
  });

  it('accepts dashes, a T separator and missing seconds', () => {
    expect(exifDateToDate('2026-09-27T13:05', '+00:00')?.toISOString()).toBe(
      '2026-09-27T13:05:00.000Z',
    );
  });

  it('rejects blank, zeroed and impossible dates', () => {
    expect(exifDateToDate('')).toBeNull();
    expect(exifDateToDate('    :  :     :  :  ')).toBeNull();
    expect(exifDateToDate('0000:00:00 00:00:00')).toBeNull();
    expect(exifDateToDate('2026:02:30 10:00:00')).toBeNull();
    expect(exifDateToDate('2026:13:01 10:00:00')).toBeNull();
    expect(exifDateToDate('2026:09:27 24:00:00')).toBeNull();
    expect(exifDateToDate('2026:09:27 12:60:00')).toBeNull();
  });
});

describe('exifTakenAt', () => {
  it('needs a DateTimeOriginal', () => {
    expect(exifTakenAt(null)).toBeNull();
    expect(exifTakenAt({ dateTimeOriginal: null, offsetTimeOriginal: '+03:00' })).toBeNull();
    expect(
      exifTakenAt({
        dateTimeOriginal: '2026:09:27 13:05:42',
        offsetTimeOriginal: '+03:00',
      })?.toISOString(),
    ).toBe('2026-09-27T10:05:42.000Z');
  });
});

describe('readPhotoTakenAt', () => {
  it('reads the capture time from the start of a photo file', async () => {
    const bytes = jpeg(JFIF, exifSegment(buildTiff({ exif: TAKEN })), SCAN);
    const file = new File([bytes, new Uint8Array(1024)], 'IMG_0001.jpg', { type: 'image/jpeg' });
    expect((await readPhotoTakenAt(file))?.toISOString()).toBe('2026-09-27T10:05:42.000Z');
  });

  it('only scans the first bytes of the file', async () => {
    const bytes = jpeg(JFIF, exifSegment(buildTiff({ exif: TAKEN })), SCAN);
    const file = new Blob([bytes]);
    expect(await readPhotoTakenAt(file, 24)).toBeNull();
    expect(EXIF_SCAN_BYTES).toBeGreaterThanOrEqual(64 * 1024);
  });

  it('resolves to null for files without EXIF or unreadable blobs', async () => {
    expect(await readPhotoTakenAt(new Blob(['not an image']))).toBeNull();
    const broken = { slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) };
    expect(await readPhotoTakenAt(broken as unknown as Blob)).toBeNull();
  });
});
