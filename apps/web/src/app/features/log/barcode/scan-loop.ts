import { InjectionToken } from '@angular/core';
import type { BarcodeReader, DetectSource, DetectedCode } from './barcode-reader';
import { readScannedCode } from './gs1-payload';
import { REQUIRED_READS, ReadConfirmer, pickCandidate } from './read-confirmer';

export const SCAN_INTERVAL_MS = 125;
export const SHORT_CODE_READS = 3;
export const FOREIGN_HOLD_MS = 1500;

const SHORT_FORMATS = new Set(['ean_8', 'upc_e']);

export interface ScanCandidate {
  code: string;
  short: boolean;
}

export interface FrameReading {
  candidates: ScanCandidate[];
  foreign: boolean;
}

export type StillResult =
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'foreign' }
  | { readonly kind: 'none' };

export type CancelFrame = () => void;

export interface FrameScheduler {
  request(callback: () => void): CancelFrame;
}

export type FrameSchedulerFactory = (video: HTMLVideoElement) => FrameScheduler;

type Clock = () => number;

const monotonic: Clock = () => performance.now();

export function videoFrameScheduler(
  video: HTMLVideoElement,
  intervalMs: number = SCAN_INTERVAL_MS,
  now: Clock = monotonic,
): FrameScheduler {
  let last = Number.NEGATIVE_INFINITY;
  const due = (): boolean => now() - last >= intervalMs;
  const fire = (callback: () => void): void => {
    last = now();
    callback();
  };
  return {
    request(callback) {
      if (typeof video.requestVideoFrameCallback === 'function') {
        let cancelled = false;
        let handle = 0;
        const onFrame = (): void => {
          if (cancelled) {
            return;
          }
          if (due()) {
            fire(callback);
          } else {
            handle = video.requestVideoFrameCallback(onFrame);
          }
        };
        handle = video.requestVideoFrameCallback(onFrame);
        return () => {
          cancelled = true;
          video.cancelVideoFrameCallback?.(handle);
        };
      }
      const wait = Math.max(0, intervalMs - (now() - last));
      const timer = setTimeout(() => fire(callback), wait);
      return () => clearTimeout(timer);
    },
  };
}

export const FRAME_SCHEDULER = new InjectionToken<FrameSchedulerFactory>('FRAME_SCHEDULER', {
  providedIn: 'root',
  factory: () => (video) => videoFrameScheduler(video),
});

export function readFrame(detected: readonly DetectedCode[]): FrameReading {
  const candidates: ScanCandidate[] = [];
  let foreign = false;
  for (const { rawValue, format } of detected) {
    const scanned = readScannedCode(rawValue, format);
    if (scanned.kind === 'other') {
      foreign = true;
    } else if (
      scanned.kind === 'product' &&
      !candidates.some((candidate) => candidate.code === scanned.code)
    ) {
      candidates.push({
        code: scanned.code,
        short: SHORT_FORMATS.has(format) || rawValue.trim().length <= 8,
      });
    }
  }
  candidates.sort((a, b) => Number(a.short) - Number(b.short));
  return { candidates, foreign };
}

export function validCodes(detected: readonly DetectedCode[]): ScanCandidate[] {
  return readFrame(detected).candidates;
}

export function requiredReads(candidate: ScanCandidate): number {
  return candidate.short ? SHORT_CODE_READS : REQUIRED_READS;
}

export interface ScanLoopOptions {
  reader: BarcodeReader;
  scheduler: FrameScheduler;
  source: () => DetectSource | null;
  onConfirmed: (code: string) => void;
  onPending?: (code: string | null) => void;
  onForeign?: (seen: boolean) => void;
  now?: Clock;
}

export class ScanLoop {
  private readonly confirmer = new ReadConfirmer();
  private readonly now: Clock;
  private cancelFrame: CancelFrame | null = null;
  private generation = 0;
  private running = false;
  private foreignUntil = Number.NEGATIVE_INFINITY;
  private foreignShown = false;

  constructor(private readonly options: ScanLoopOptions) {
    this.now = options.now ?? monotonic;
  }

  get active(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.generation += 1;
    this.confirmer.reset();
    this.foreignUntil = Number.NEGATIVE_INFINITY;
    this.foreignShown = false;
    this.options.onPending?.(null);
    this.options.onForeign?.(false);
    this.next(this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.cancelFrame?.();
    this.cancelFrame = null;
  }

  private next(generation: number): void {
    if (!this.running || generation !== this.generation) {
      return;
    }
    this.cancelFrame = this.options.scheduler.request(() => void this.tick(generation));
  }

  private async tick(generation: number): Promise<void> {
    this.cancelFrame = null;
    if (generation !== this.generation) {
      return;
    }
    const source = this.options.source();
    let detected: DetectedCode[] = [];
    if (source) {
      try {
        detected = await this.options.reader.detect(source);
      } catch {
        detected = [];
      }
    }
    if (generation !== this.generation) {
      return;
    }
    const reading = readFrame(detected);
    this.trackForeign(reading);
    const confirmed = this.consider(reading.candidates);
    if (confirmed) {
      this.stop();
      this.options.onConfirmed(confirmed);
      return;
    }
    this.next(generation);
  }

  private trackForeign(reading: FrameReading): void {
    const now = this.now();
    if (reading.candidates.length > 0) {
      this.foreignUntil = Number.NEGATIVE_INFINITY;
    } else if (reading.foreign) {
      this.foreignUntil = now + FOREIGN_HOLD_MS;
    }
    const shown = now < this.foreignUntil;
    if (shown !== this.foreignShown) {
      this.foreignShown = shown;
      this.options.onForeign?.(shown);
    }
  }

  private consider(candidates: readonly ScanCandidate[]): string | null {
    const long = candidates.filter((candidate) => !candidate.short);
    const pool = long.length > 0 ? long : candidates;
    const code = pickCandidate(
      pool.map((candidate) => candidate.code),
      this.confirmer.pending,
    );
    const candidate = pool.find((item) => item.code === code);
    if (!candidate) {
      return null;
    }
    const confirmed = this.confirmer.push(candidate.code, this.now(), requiredReads(candidate));
    this.options.onPending?.(this.confirmer.pending);
    return confirmed;
  }
}

export const STILL_MAX_SIDE = 2048;

export function stillResult(detected: readonly DetectedCode[]): StillResult {
  const { candidates, foreign } = readFrame(detected);
  const [first] = candidates;
  if (first) {
    return { kind: 'code', code: first.code };
  }
  return foreign ? { kind: 'foreign' } : { kind: 'none' };
}

export async function decodeStill(reader: BarcodeReader, file: Blob): Promise<StillResult> {
  const bitmap = await loadBitmap(file);
  try {
    return stillResult(await reader.detect(bitmap ?? file));
  } finally {
    bitmap?.close();
  }
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = STILL_MAX_SIDE / Math.max(bitmap.width, bitmap.height);
  if (!(scale < 1)) {
    return bitmap;
  }
  try {
    const resized = await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
      resizeQuality: 'high',
    });
    bitmap.close();
    return resized;
  } catch {
    return bitmap;
  }
}
