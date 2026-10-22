import { Injectable, inject } from '@angular/core';
import { BarcodeReaderLoader, type BarcodeReader } from './barcode-reader';
import { decodeStill, type StillResult } from './scan-loop';
import {
  CODE_READER_UNAVAILABLE,
  NO_BARCODE_IN_PHOTO,
  NO_PRODUCT_IN_QR,
  PHOTO_UNREADABLE,
} from './scanner-copy';

export type ImageScanResult =
  StillResult | { readonly kind: 'unreadable' } | { readonly kind: 'reader' };

export type ImageScanMiss = Exclude<ImageScanResult, { kind: 'code' }>['kind'];

export const IMAGE_SCAN_MESSAGES: Record<ImageScanMiss, string> = {
  none: NO_BARCODE_IN_PHOTO,
  foreign: NO_PRODUCT_IN_QR,
  unreadable: PHOTO_UNREADABLE,
  reader: CODE_READER_UNAVAILABLE,
};

export function firstImage(input: HTMLInputElement): File | null {
  const file = input.files?.item(0) ?? null;
  input.value = '';
  return file;
}

@Injectable({ providedIn: 'root' })
export class BarcodeImageReader {
  private readonly readers = inject(BarcodeReaderLoader);

  async read(file: Blob): Promise<ImageScanResult> {
    let reader: BarcodeReader;
    try {
      reader = await this.readers.load();
    } catch {
      return { kind: 'reader' };
    }
    try {
      return await decodeStill(reader, file);
    } catch {
      return { kind: 'unreadable' };
    }
  }
}
