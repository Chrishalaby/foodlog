import { TestBed } from '@angular/core/testing';
import { BarcodeImageReader, IMAGE_SCAN_MESSAGES, firstImage } from './barcode-image';
import { BarcodeReaderLoader, type BarcodeReader, type DetectedCode } from './barcode-reader';
import {
  CODE_READER_UNAVAILABLE,
  NO_BARCODE_IN_PHOTO,
  NO_PRODUCT_IN_QR,
  PHOTO_UNREADABLE,
} from './scanner-copy';

describe('BarcodeImageReader', () => {
  const detect = vi.fn<(source: unknown) => Promise<DetectedCode[]>>();
  const load = vi.fn<() => Promise<BarcodeReader>>();
  const image = new Blob(['pixels'], { type: 'image/jpeg' });

  beforeEach(() => {
    detect.mockReset();
    load.mockReset();
    load.mockResolvedValue({ kind: 'zxing', detect });
    TestBed.configureTestingModule({
      providers: [{ provide: BarcodeReaderLoader, useValue: { load } }],
    });
  });

  const read = () => TestBed.inject(BarcodeImageReader).read(image);

  it('returns the product code from a barcode or a GS1 QR code', async () => {
    detect.mockResolvedValueOnce([{ rawValue: '5281234567896', format: 'ean_13' }]);
    expect(await read()).toEqual({ kind: 'code', code: '5281234567896' });

    detect.mockResolvedValueOnce([
      { rawValue: 'https://id.gs1.org/01/09506000134352', format: 'qr_code' },
    ]);
    expect(await read()).toEqual({ kind: 'code', code: '9506000134352' });
  });

  it('tells an image without a code apart from a QR code without a product', async () => {
    detect.mockResolvedValueOnce([]);
    expect(await read()).toEqual({ kind: 'none' });

    detect.mockResolvedValueOnce([{ rawValue: 'https://evil.example/login', format: 'qr_code' }]);
    expect(await read()).toEqual({ kind: 'foreign' });
  });

  it('reports an image the reader cannot decode', async () => {
    detect.mockRejectedValueOnce(new Error('decode'));
    expect(await read()).toEqual({ kind: 'unreadable' });
  });

  it('reports a reader that could not load instead of blaming the photo', async () => {
    load.mockRejectedValueOnce(new Error('wasm'));
    expect(await read()).toEqual({ kind: 'reader' });
    expect(detect).not.toHaveBeenCalled();
  });

  it('has a message for every miss', () => {
    expect(IMAGE_SCAN_MESSAGES).toEqual({
      none: NO_BARCODE_IN_PHOTO,
      foreign: NO_PRODUCT_IN_QR,
      unreadable: PHOTO_UNREADABLE,
      reader: CODE_READER_UNAVAILABLE,
    });
  });
});

describe('firstImage', () => {
  it('takes the first chosen file and clears the input for the next pick', () => {
    const input = document.createElement('input');
    input.type = 'file';
    const file = new File(['x'], 'code.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: { item: (index: number) => (index === 0 ? file : null), length: 1 },
    });
    const clear = vi.spyOn(input, 'value', 'set');

    expect(firstImage(input)).toBe(file);
    expect(clear).toHaveBeenCalledWith('');
  });

  it('returns null when the picker was dismissed', () => {
    const input = document.createElement('input');
    input.type = 'file';
    expect(firstImage(input)).toBeNull();
  });
});
