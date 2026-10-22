export interface ExifDateFields {
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
}

export const EXIF_SCAN_BYTES = 256 * 1024;

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TYPE_ASCII = 2;
const IFD_ENTRY_BYTES = 12;
const MAX_IFD_ENTRIES = 1024;
const MAX_ASCII_BYTES = 64;
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] as const;
const MAX_OFFSET_MINUTES = 14 * 60;

const DATE_TIME_PATTERN = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;
const OFFSET_PATTERN = /^([+-])(\d{2}):?(\d{2})$/;

interface IfdEntry {
  type: number;
  count: number;
  valueOffset: number;
}

type Ifd = ReadonlyMap<number, IfdEntry>;

function toView(data: ArrayBuffer | ArrayBufferView): DataView {
  return data instanceof ArrayBuffer
    ? new DataView(data)
    : new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function uint8(view: DataView, offset: number): number | null {
  return offset >= 0 && offset < view.byteLength ? view.getUint8(offset) : null;
}

function uint16(view: DataView, offset: number, little: boolean): number | null {
  return offset >= 0 && offset + 2 <= view.byteLength ? view.getUint16(offset, little) : null;
}

function uint32(view: DataView, offset: number, little: boolean): number | null {
  return offset >= 0 && offset + 4 <= view.byteLength ? view.getUint32(offset, little) : null;
}

function hasExifHeader(view: DataView, offset: number): boolean {
  return EXIF_HEADER.every((byte, index) => uint8(view, offset + index) === byte);
}

function byteOrder(view: DataView): boolean | null {
  const mark = uint16(view, 0, false);
  const little = mark === 0x4949 ? true : mark === 0x4d4d ? false : null;
  return little !== null && uint16(view, 2, little) === 42 ? little : null;
}

function isStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
}

function jpegTiff(view: DataView): DataView | null {
  let offset = 2;
  while (offset + 1 < view.byteLength) {
    if (uint8(view, offset) !== 0xff) {
      return null;
    }
    const marker = uint8(view, offset + 1) ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (isStandaloneMarker(marker)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const length = uint16(view, offset + 2, false);
    if (length === null || length < 2) {
      return null;
    }
    const start = offset + 4;
    const end = offset + 2 + length;
    if (marker === 0xe1 && hasExifHeader(view, start)) {
      const tiffStart = start + EXIF_HEADER.length;
      const tiffEnd = Math.min(end, view.byteLength);
      return tiffEnd > tiffStart
        ? new DataView(view.buffer, view.byteOffset + tiffStart, tiffEnd - tiffStart)
        : null;
    }
    offset = end;
  }
  return null;
}

function locateTiff(view: DataView): DataView | null {
  if (byteOrder(view) !== null) {
    return view;
  }
  return uint8(view, 0) === 0xff && uint8(view, 1) === 0xd8 ? jpegTiff(view) : null;
}

function readIfd(view: DataView, offset: number | null, little: boolean): Ifd {
  const entries = new Map<number, IfdEntry>();
  if (offset === null || offset < 8) {
    return entries;
  }
  const count = uint16(view, offset, little);
  if (count === null || count > MAX_IFD_ENTRIES) {
    return entries;
  }
  for (let index = 0; index < count; index++) {
    const at = offset + 2 + index * IFD_ENTRY_BYTES;
    const tag = uint16(view, at, little);
    const type = uint16(view, at + 2, little);
    const valueCount = uint32(view, at + 4, little);
    if (
      tag === null ||
      type === null ||
      valueCount === null ||
      at + IFD_ENTRY_BYTES > view.byteLength
    ) {
      break;
    }
    if (!entries.has(tag)) {
      entries.set(tag, { type, count: valueCount, valueOffset: at + 8 });
    }
  }
  return entries;
}

function readAscii(view: DataView, entry: IfdEntry | undefined, little: boolean): string | null {
  if (!entry || entry.type !== TYPE_ASCII || entry.count === 0) {
    return null;
  }
  const start = entry.count <= 4 ? entry.valueOffset : uint32(view, entry.valueOffset, little);
  if (start === null) {
    return null;
  }
  let text = '';
  for (let index = 0; index < Math.min(entry.count, MAX_ASCII_BYTES); index++) {
    const code = uint8(view, start + index);
    if (code === null) {
      return null;
    }
    if (code === 0) {
      break;
    }
    text += String.fromCharCode(code);
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTiffDates(view: DataView): ExifDateFields | null {
  const little = byteOrder(view);
  if (little === null) {
    return null;
  }
  const ifd0 = readIfd(view, uint32(view, 4, little), little);
  const pointer = ifd0.get(TAG_EXIF_IFD);
  const exifIfd = pointer ? readIfd(view, uint32(view, pointer.valueOffset, little), little) : null;
  const pick = (tag: number): string | null =>
    readAscii(view, exifIfd?.get(tag), little) ?? readAscii(view, ifd0.get(tag), little);
  const fields: ExifDateFields = {
    dateTimeOriginal: pick(TAG_DATE_TIME_ORIGINAL),
    offsetTimeOriginal: pick(TAG_OFFSET_TIME_ORIGINAL),
  };
  return fields.dateTimeOriginal === null && fields.offsetTimeOriginal === null ? null : fields;
}

export function readExifDates(data: ArrayBuffer | ArrayBufferView): ExifDateFields | null {
  try {
    const tiff = locateTiff(toView(data));
    return tiff ? readTiffDates(tiff) : null;
  } catch {
    return null;
  }
}

export function parseExifOffset(value: string | null): number | null {
  const match = value ? OFFSET_PATTERN.exec(value.trim()) : null;
  if (!match) {
    return null;
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const total = hours * 60 + minutes;
  if (minutes > 59 || total > MAX_OFFSET_MINUTES) {
    return null;
  }
  return match[1] === '-' ? -total : total;
}

export function exifDateToDate(dateTime: string, offset: string | null = null): Date | null {
  const match = DATE_TIME_PATTERN.exec(dateTime.trim());
  if (!match) {
    return null;
  }
  const [year, month, day, hours, minutes] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const seconds = match[6] === undefined ? 0 : Number(match[6]);
  if (
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return null;
  }
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return null;
  }
  const zone = parseExifOffset(offset);
  if (zone !== null) {
    return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds) - zone * 60_000);
  }
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

export function exifTakenAt(fields: ExifDateFields | null): Date | null {
  return fields?.dateTimeOriginal
    ? exifDateToDate(fields.dateTimeOriginal, fields.offsetTimeOriginal)
    : null;
}

export async function readPhotoTakenAt(
  file: Blob,
  maxBytes: number = EXIF_SCAN_BYTES,
): Promise<Date | null> {
  try {
    const buffer = await file.slice(0, maxBytes).arrayBuffer();
    return exifTakenAt(readExifDates(buffer));
  } catch {
    return null;
  }
}
