import { DOCUMENT, Injectable, InjectionToken, inject } from '@angular/core';

export const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'] as const;

export type DetectSource = HTMLVideoElement | ImageBitmap | Blob;

export interface DetectedCode {
  rawValue: string;
  format: string;
}

export type ReaderKind = 'native' | 'zxing';

export interface BarcodeReader {
  readonly kind: ReaderKind;
  detect(source: DetectSource): Promise<DetectedCode[]>;
}

interface DetectorInstance {
  detect(source: DetectSource): Promise<readonly DetectedCode[]>;
}

export interface DetectorClass {
  new (options?: { formats?: string[] }): DetectorInstance;
  getSupportedFormats(): Promise<readonly string[]>;
}

export interface ZxingOverrides {
  locateFile: (path: string, prefix: string) => string;
}

export interface PonyfillModule {
  BarcodeDetector: DetectorClass;
  prepareZXingModule(options: {
    overrides: ZxingOverrides;
    fireImmediately: true;
  }): Promise<unknown>;
}

export interface ZxingBundle {
  ponyfill: PonyfillModule;
  wasmUrl: string;
}

export interface BarcodeEnvironment {
  nativeDetector: () => DetectorClass | null;
  loadZxing: () => Promise<ZxingBundle>;
}

function nativeDetectorClass(): DetectorClass | null {
  const candidate = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof candidate === 'function' ? (candidate as DetectorClass) : null;
}

async function importZxing(baseUri: string): Promise<ZxingBundle> {
  const [ponyfill, wasm] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('./zxing-wasm'),
  ]);
  return {
    ponyfill: ponyfill as unknown as PonyfillModule,
    wasmUrl: new URL(wasm.ZXING_WASM_FILE, baseUri).href,
  };
}

export const BARCODE_ENVIRONMENT = new InjectionToken<BarcodeEnvironment>('BARCODE_ENVIRONMENT', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return {
      nativeDetector: nativeDetectorClass,
      loadZxing: () => importZxing(document.baseURI),
    };
  },
});

function wrap(kind: ReaderKind, detector: DetectorInstance): BarcodeReader {
  return {
    kind,
    detect: async (source) =>
      (await detector.detect(source)).map(({ rawValue, format }) => ({ rawValue, format })),
  };
}

export async function nativeReader(detector: DetectorClass | null): Promise<BarcodeReader | null> {
  if (!detector) {
    return null;
  }
  try {
    const supported = await detector.getSupportedFormats();
    if (!supported.includes('ean_13')) {
      return null;
    }
    const formats = SCAN_FORMATS.filter((format) => supported.includes(format));
    return wrap('native', new detector({ formats }));
  } catch {
    return null;
  }
}

export function wasmLocator(wasmUrl: string): ZxingOverrides {
  return {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`),
  };
}

export async function zxingReader(env: BarcodeEnvironment): Promise<BarcodeReader> {
  const { ponyfill, wasmUrl } = await env.loadZxing();
  await ponyfill.prepareZXingModule({
    overrides: wasmLocator(wasmUrl),
    fireImmediately: true,
  });
  return wrap('zxing', new ponyfill.BarcodeDetector({ formats: [...SCAN_FORMATS] }));
}

export async function createBarcodeReader(env: BarcodeEnvironment): Promise<BarcodeReader> {
  return (await nativeReader(env.nativeDetector())) ?? zxingReader(env);
}

@Injectable({ providedIn: 'root' })
export class BarcodeReaderLoader {
  private readonly env = inject(BARCODE_ENVIRONMENT);
  private pending: Promise<BarcodeReader> | null = null;

  load(): Promise<BarcodeReader> {
    if (!this.pending) {
      const attempt = createBarcodeReader(this.env);
      this.pending = attempt;
      attempt.catch(() => {
        if (this.pending === attempt) {
          this.pending = null;
        }
      });
    }
    return this.pending;
  }
}
