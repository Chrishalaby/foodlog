import { TestBed } from '@angular/core/testing';
import {
  BARCODE_ENVIRONMENT,
  BarcodeReaderLoader,
  SCAN_FORMATS,
  createBarcodeReader,
  wasmLocator,
  type BarcodeEnvironment,
  type DetectedCode,
  type DetectorClass,
  type PonyfillModule,
  type ZxingOverrides,
} from './barcode-reader';

const WASM_URL = 'https://app.example/media/zxing_reader-ABC123.wasm';

function detectorClass(supported: readonly string[] | Error, codes: DetectedCode[] = []) {
  const constructed: { formats?: string[] }[] = [];
  const Detector = class {
    constructor(options: { formats?: string[] } = {}) {
      constructed.push(options);
    }

    static getSupportedFormats(): Promise<readonly string[]> {
      return supported instanceof Error ? Promise.reject(supported) : Promise.resolve(supported);
    }

    detect(): Promise<DetectedCode[]> {
      return Promise.resolve(codes.map((code) => ({ ...code, boundingBox: {} })));
    }
  };
  return { Detector: Detector as unknown as DetectorClass, constructed };
}

function ponyfill(): {
  module: PonyfillModule;
  constructed: { formats?: string[] }[];
  overrides: ZxingOverrides[];
} {
  const { Detector, constructed } = detectorClass(
    ['ean_13'],
    [{ rawValue: '5281234567896', format: 'ean_13' }],
  );
  const overrides: ZxingOverrides[] = [];
  return {
    module: {
      BarcodeDetector: Detector,
      prepareZXingModule: async (options) => {
        overrides.push(options.overrides);
        return {};
      },
    },
    constructed,
    overrides,
  };
}

function environment(
  native: DetectorClass | null,
  loadZxing: BarcodeEnvironment['loadZxing'],
): BarcodeEnvironment {
  return { nativeDetector: () => native, loadZxing };
}

describe('barcode reader selection', () => {
  it('uses the native BarcodeDetector when it supports EAN-13', async () => {
    const native = detectorClass(
      ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'code_128'],
      [{ rawValue: '5281234567896', format: 'ean_13' }],
    );
    const loadZxing = vi.fn();
    const reader = await createBarcodeReader(environment(native.Detector, loadZxing));
    expect(reader.kind).toBe('native');
    expect(native.constructed).toEqual([{ formats: ['ean_13', 'ean_8', 'upc_a', 'qr_code'] }]);
    expect(loadZxing).not.toHaveBeenCalled();
    expect(await reader.detect(new Blob())).toEqual([
      { rawValue: '5281234567896', format: 'ean_13' },
    ]);
  });

  it('falls back to the ZXing ponyfill when the native detector lacks EAN-13', async () => {
    const native = detectorClass(['qr_code', 'aztec']);
    const fallback = ponyfill();
    const reader = await createBarcodeReader(
      environment(native.Detector, async () => ({ ponyfill: fallback.module, wasmUrl: WASM_URL })),
    );
    expect(reader.kind).toBe('zxing');
    expect(native.constructed).toEqual([]);
    expect(fallback.constructed).toEqual([{ formats: [...SCAN_FORMATS] }]);
  });

  it('falls back when there is no native detector or it fails', async () => {
    const broken = detectorClass(new Error('unsupported'));
    const first = ponyfill();
    const second = ponyfill();
    expect(
      (
        await createBarcodeReader(
          environment(null, async () => ({ ponyfill: first.module, wasmUrl: WASM_URL })),
        )
      ).kind,
    ).toBe('zxing');
    expect(
      (
        await createBarcodeReader(
          environment(broken.Detector, async () => ({
            ponyfill: second.module,
            wasmUrl: WASM_URL,
          })),
        )
      ).kind,
    ).toBe('zxing');
  });

  it('points ZXing at the wasm served by the app, never a CDN', async () => {
    const fallback = ponyfill();
    await createBarcodeReader(
      environment(null, async () => ({ ponyfill: fallback.module, wasmUrl: WASM_URL })),
    );
    const locate = fallback.overrides[0]!.locateFile;
    expect(locate('zxing_reader.wasm', 'https://fastly.jsdelivr.net/npm/zxing-wasm/')).toBe(
      WASM_URL,
    );
    expect(locate('zxing_reader.js', '/assets/')).toBe('/assets/zxing_reader.js');
    expect(wasmLocator(WASM_URL).locateFile('x.wasm', 'https://cdn/')).not.toContain('cdn');
  });

  it('serves the wasm build that matches the bundled ponyfill from our own origin', async () => {
    const [pony, reader] = await Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader'),
    ]);
    expect(pony.ZXING_WASM_VERSION).toBe(reader.ZXING_WASM_VERSION);
    expect(pony.ZXING_WASM_SHA256).toBe(reader.ZXING_WASM_SHA256);

    const bundle = await TestBed.inject(BARCODE_ENVIRONMENT).loadZxing();
    const url = new URL(bundle.wasmUrl);
    expect(url.origin).toBe(new URL(document.baseURI).origin);
    expect(url.pathname).toMatch(/zxing_reader[^/]*\.wasm$/);
    expect(typeof bundle.ponyfill.prepareZXingModule).toBe('function');
  });

  it('loads the reader once and retries after a failure', async () => {
    const fallback = ponyfill();
    const loadZxing = vi
      .fn<BarcodeEnvironment['loadZxing']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ponyfill: fallback.module, wasmUrl: WASM_URL });
    TestBed.configureTestingModule({
      providers: [{ provide: BARCODE_ENVIRONMENT, useValue: environment(null, loadZxing) }],
    });
    const loader = TestBed.inject(BarcodeReaderLoader);
    await expect(loader.load()).rejects.toThrow('offline');
    const [a, b] = await Promise.all([loader.load(), loader.load()]);
    expect(a).toBe(b);
    expect(await loader.load()).toBe(a);
    expect(loadZxing).toHaveBeenCalledTimes(2);
  });
});
