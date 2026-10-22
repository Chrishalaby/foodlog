import type { BarcodeReader, DetectedCode, DetectSource } from './barcode-reader';
import { MAX_READ_GAP_MS, ReadConfirmer, pickCandidate } from './read-confirmer';
import {
  FOREIGN_HOLD_MS,
  ScanLoop,
  decodeStill,
  readFrame,
  stillResult,
  validCodes,
  videoFrameScheduler,
  type FrameScheduler,
} from './scan-loop';

const EAN = '5281234567896';
const OTHER = '4006381333931';
const GTIN14 = '09506000134352';

class ManualScheduler implements FrameScheduler {
  private pending: (() => void) | null = null;
  requests = 0;
  cancels = 0;

  request(callback: () => void): () => void {
    this.requests += 1;
    this.pending = callback;
    return () => {
      this.cancels += 1;
      this.pending = null;
    };
  }

  get waiting(): boolean {
    return this.pending !== null;
  }

  async frame(): Promise<void> {
    const callback = this.pending;
    this.pending = null;
    callback?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function reader(reads: DetectedCode[][]): BarcodeReader & { calls: number } {
  const queue = [...reads];
  const fake = {
    kind: 'native' as const,
    calls: 0,
    detect: async (): Promise<DetectedCode[]> => {
      fake.calls += 1;
      return queue.shift() ?? [];
    },
  };
  return fake;
}

const ean = (rawValue: string, format = 'ean_13'): DetectedCode => ({ rawValue, format });
const qr = (rawValue: string): DetectedCode => ({ rawValue, format: 'qr_code' });
const VIDEO = {} as DetectSource;

describe('ReadConfirmer', () => {
  it('confirms a code only after two consecutive identical reads', () => {
    const confirmer = new ReadConfirmer();
    expect(confirmer.push(EAN, 0)).toBeNull();
    expect(confirmer.pending).toBe(EAN);
    expect(confirmer.push(EAN, 125)).toBe(EAN);
  });

  it('restarts the streak when a different code is read in between', () => {
    const confirmer = new ReadConfirmer();
    confirmer.push(EAN, 0);
    expect(confirmer.push(OTHER, 125)).toBeNull();
    expect(confirmer.push(EAN, 250)).toBeNull();
    expect(confirmer.push(EAN, 375)).toBe(EAN);
  });

  it('does not pair reads that are too far apart', () => {
    const confirmer = new ReadConfirmer();
    confirmer.push(EAN, 0);
    expect(confirmer.push(EAN, MAX_READ_GAP_MS + 1)).toBeNull();
    expect(confirmer.push(EAN, MAX_READ_GAP_MS + 100)).toBe(EAN);
    confirmer.reset();
    expect(confirmer.pending).toBeNull();
  });

  it('prefers the code it is already tracking when a frame holds several', () => {
    expect(pickCandidate([OTHER, EAN], EAN)).toBe(EAN);
    expect(pickCandidate([OTHER, EAN], null)).toBe(OTHER);
    expect(pickCandidate([], EAN)).toBeNull();
  });
});

describe('ScanLoop', () => {
  it('keeps only valid, canonical, unique codes, long ones first', () => {
    expect(
      validCodes([
        ean('12812345', 'upc_e'),
        ean(EAN),
        ean('5281234567890'),
        ean(EAN),
        ean('036000291452', 'upc_a'),
      ]),
    ).toEqual([
      { code: EAN, short: false },
      { code: '0036000291452', short: false },
      { code: '0128120000035', short: true },
    ]);
  });

  it('reads GTINs from QR codes and flags QR content without one', () => {
    expect(readFrame([qr(`https://id.gs1.org/01/${GTIN14}/10/LOT1`)])).toEqual({
      candidates: [{ code: '9506000134352', short: false }],
      foreign: false,
    });
    expect(readFrame([qr('https://cafe.example/menu'), ean(EAN)])).toEqual({
      candidates: [{ code: EAN, short: false }],
      foreign: true,
    });
    expect(readFrame([qr(`01${GTIN14}`), ean('9506000134352')])).toEqual({
      candidates: [{ code: '9506000134352', short: false }],
      foreign: false,
    });
    expect(readFrame([ean('5281234567890')])).toEqual({ candidates: [], foreign: false });
  });

  it('confirms a GS1 QR code like a barcode', async () => {
    const scheduler = new ManualScheduler();
    const link = qr(`https://id.gs1.org/01/${GTIN14}`);
    const onConfirmed = vi.fn();
    const loop = new ScanLoop({
      reader: reader([[link], [link]]),
      scheduler,
      source: () => VIDEO,
      onConfirmed,
    });
    loop.start();
    await scheduler.frame();
    await scheduler.frame();
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith('9506000134352');
  });

  it('reports a QR without a product code while it stays in view', async () => {
    const scheduler = new ManualScheduler();
    const menu = qr('https://cafe.example/menu');
    const onForeign = vi.fn();
    const onConfirmed = vi.fn();
    let now = 0;
    const loop = new ScanLoop({
      reader: reader([[menu], [], [], [ean(EAN)], [menu], [ean(EAN)]]),
      scheduler,
      source: () => VIDEO,
      onConfirmed,
      onForeign,
      now: () => now,
    });
    loop.start();
    expect(onForeign).toHaveBeenLastCalledWith(false);
    await scheduler.frame();
    expect(onForeign).toHaveBeenLastCalledWith(true);
    now = FOREIGN_HOLD_MS - 1;
    await scheduler.frame();
    expect(onForeign).toHaveBeenCalledTimes(2);
    now = FOREIGN_HOLD_MS + 1;
    await scheduler.frame();
    expect(onForeign).toHaveBeenLastCalledWith(false);
    await scheduler.frame();
    await scheduler.frame();
    expect(onForeign).toHaveBeenLastCalledWith(true);
    await scheduler.frame();
    expect(onForeign).toHaveBeenLastCalledWith(false);
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(EAN);
  });

  it('needs a third read for short UPC-E and EAN-8 codes, a common misread', async () => {
    const scheduler = new ManualScheduler();
    const upcE = ean('12812345', 'upc_e');
    const detect = reader([[upcE], [upcE], [upcE]]);
    const onConfirmed = vi.fn();
    const loop = new ScanLoop({ reader: detect, scheduler, source: () => VIDEO, onConfirmed });
    loop.start();
    await scheduler.frame();
    await scheduler.frame();
    expect(onConfirmed).not.toHaveBeenCalled();
    await scheduler.frame();
    expect(onConfirmed).toHaveBeenCalledWith('0128120000035');
  });

  it('prefers a full EAN-13 over a short code seen in the same frame', async () => {
    const scheduler = new ManualScheduler();
    const upcE = ean('12812345', 'upc_e');
    const detect = reader([[upcE], [upcE, ean(EAN)], [ean(EAN), upcE]]);
    const onConfirmed = vi.fn();
    const loop = new ScanLoop({ reader: detect, scheduler, source: () => VIDEO, onConfirmed });
    loop.start();
    await scheduler.frame();
    await scheduler.frame();
    expect(onConfirmed).not.toHaveBeenCalled();
    await scheduler.frame();
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(EAN);
  });

  it('reports the code after two matching frames and stops scheduling', async () => {
    const scheduler = new ManualScheduler();
    const detect = reader([[ean(EAN)], [ean(EAN)]]);
    const onConfirmed = vi.fn();
    const onPending = vi.fn();
    let now = 0;
    const loop = new ScanLoop({
      reader: detect,
      scheduler,
      source: () => VIDEO,
      onConfirmed,
      onPending,
      now: () => (now += 125),
    });
    loop.start();
    expect(loop.active).toBe(true);
    await scheduler.frame();
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onPending).toHaveBeenLastCalledWith(EAN);
    await scheduler.frame();
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(EAN);
    expect(loop.active).toBe(false);
    expect(scheduler.waiting).toBe(false);
  });

  it('ignores misreads with a bad check digit and survives detector errors', async () => {
    const scheduler = new ManualScheduler();
    const onConfirmed = vi.fn();
    let call = 0;
    const flaky: BarcodeReader = {
      kind: 'zxing',
      detect: async () => {
        call += 1;
        if (call === 2) {
          throw new Error('decode failed');
        }
        return call === 3 ? [ean('5281234567890')] : [ean(EAN)];
      },
    };
    const loop = new ScanLoop({ reader: flaky, scheduler, source: () => VIDEO, onConfirmed });
    loop.start();
    await scheduler.frame();
    await scheduler.frame();
    await scheduler.frame();
    expect(onConfirmed).not.toHaveBeenCalled();
    await scheduler.frame();
    expect(onConfirmed).toHaveBeenCalledWith(EAN);
  });

  it('skips frames while the video has no data yet', async () => {
    const scheduler = new ManualScheduler();
    const detect = reader([[ean(EAN)], [ean(EAN)]]);
    let ready = false;
    const loop = new ScanLoop({
      reader: detect,
      scheduler,
      source: () => (ready ? VIDEO : null),
      onConfirmed: vi.fn(),
    });
    loop.start();
    await scheduler.frame();
    expect(detect.calls).toBe(0);
    expect(scheduler.waiting).toBe(true);
    ready = true;
    await scheduler.frame();
    expect(detect.calls).toBe(1);
  });

  it('drops in-flight results after stop', async () => {
    const scheduler = new ManualScheduler();
    let resolve!: (codes: DetectedCode[]) => void;
    const slow: BarcodeReader = {
      kind: 'native',
      detect: () => new Promise((done) => (resolve = done)),
    };
    const onConfirmed = vi.fn();
    const loop = new ScanLoop({ reader: slow, scheduler, source: () => VIDEO, onConfirmed });
    loop.start();
    await scheduler.frame();
    loop.stop();
    resolve([ean(EAN)]);
    await new Promise((done) => setTimeout(done, 0));
    expect(scheduler.waiting).toBe(false);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('cancels the pending frame on stop', () => {
    const scheduler = new ManualScheduler();
    const loop = new ScanLoop({
      reader: reader([]),
      scheduler,
      source: () => VIDEO,
      onConfirmed: vi.fn(),
    });
    loop.start();
    loop.stop();
    expect(scheduler.cancels).toBe(1);
    expect(scheduler.waiting).toBe(false);
  });
});

describe('videoFrameScheduler', () => {
  it('throttles video frame callbacks to the scan interval', () => {
    const callbacks: (() => void)[] = [];
    const video = {
      requestVideoFrameCallback: (callback: () => void) => callbacks.push(callback),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;
    let now = 1000;
    const scheduler = videoFrameScheduler(video, 125, () => now);
    const tick = vi.fn();
    scheduler.request(tick);
    callbacks.shift()?.();
    expect(tick).toHaveBeenCalledTimes(1);
    scheduler.request(tick);
    now += 40;
    callbacks.shift()?.();
    expect(tick).toHaveBeenCalledTimes(1);
    now += 90;
    callbacks.shift()?.();
    expect(tick).toHaveBeenCalledTimes(2);
    const cancel = scheduler.request(tick);
    cancel();
    now += 500;
    callbacks.shift()?.();
    expect(tick).toHaveBeenCalledTimes(2);
    expect(video.cancelVideoFrameCallback).toHaveBeenCalled();
  });

  it('falls back to timers when requestVideoFrameCallback is missing', async () => {
    const scheduler = videoFrameScheduler({} as HTMLVideoElement, 5);
    const tick = vi.fn();
    scheduler.request(tick);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

describe('decodeStill', () => {
  it('returns the first valid code found in a still photo', async () => {
    const detect = vi.fn(async () => [ean('5281234567890'), ean(EAN)]);
    const result = await decodeStill({ kind: 'zxing', detect }, new Blob(['x']));
    expect(result).toEqual({ kind: 'code', code: EAN });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it('says when the photo holds no readable barcode', async () => {
    const result = await decodeStill({ kind: 'native', detect: async () => [] }, new Blob(['x']));
    expect(result).toEqual({ kind: 'none' });
  });

  it('reads a product code from a QR image and tells other QR codes apart', () => {
    expect(stillResult([qr(`(01)${GTIN14}(10)ABC`)])).toEqual({
      kind: 'code',
      code: '9506000134352',
    });
    expect(stillResult([qr('https://cafe.example/menu')])).toEqual({ kind: 'foreign' });
    expect(stillResult([qr('https://cafe.example/menu'), ean(EAN)])).toEqual({
      kind: 'code',
      code: EAN,
    });
    expect(stillResult([ean('5281234567890')])).toEqual({ kind: 'none' });
  });
});
