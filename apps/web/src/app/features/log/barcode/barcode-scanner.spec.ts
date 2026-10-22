import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { installDialogShim } from '../testing/dialog-shim';
import { BarcodeReaderLoader, type BarcodeReader, type DetectedCode } from './barcode-reader';
import { BarcodeScanner } from './barcode-scanner';
import { CAMERA_OPENER, CameraError } from './camera';
import { FRAME_SCHEDULER, type FrameScheduler } from './scan-loop';

const EAN = '5281234567896';

@Component({
  imports: [BarcodeScanner],
  template: `
    @if (show()) {
      <app-barcode-scanner (detected)="codes.push($event)" (closed)="closed = closed + 1" />
    }
  `,
})
class Host {
  readonly show = signal(true);
  readonly codes: string[] = [];
  closed = 0;
}

class ManualScheduler implements FrameScheduler {
  private pending: (() => void) | null = null;

  request(callback: () => void): () => void {
    this.pending = callback;
    return () => {
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

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities: () => Record<string, unknown>;
  applyConstraints: ReturnType<typeof vi.fn>;
}

function fakeStream(capabilities: Record<string, unknown> = {}) {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => capabilities,
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { stream: stream as unknown as MediaStream, track };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function chooseFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: { item: (index: number) => (index === 0 ? file : null), length: 1 },
  });
  input.dispatchEvent(new Event('change'));
}

const galleryInput = (el: HTMLElement): HTMLInputElement =>
  el.querySelector<HTMLInputElement>('input[type="file"]:not([capture])')!;

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );

describe('BarcodeScanner', () => {
  let restoreDialog: () => void;
  let scheduler: ManualScheduler;
  let opener: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>;
  let reads: DetectedCode[][];
  let reader: BarcodeReader;
  let vibrate: ReturnType<typeof vi.fn>;
  const originalVibrate = Object.getOwnPropertyDescriptor(Navigator.prototype, 'vibrate');

  beforeEach(() => {
    restoreDialog = installDialogShim();
    scheduler = new ManualScheduler();
    reads = [];
    reader = { kind: 'zxing', detect: vi.fn(async () => reads.shift() ?? []) };
    opener = vi.fn<() => Promise<MediaStream>>();
    vibrate = vi.fn(() => true);
    Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: vibrate });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: CAMERA_OPENER, useValue: opener },
        { provide: BarcodeReaderLoader, useValue: { load: () => Promise.resolve(reader) } },
        { provide: FRAME_SCHEDULER, useValue: () => scheduler },
      ],
    });
  });

  afterEach(() => {
    restoreDialog();
    vi.restoreAllMocks();
    setVisibility('visible');
    if (originalVibrate) {
      Object.defineProperty(Navigator.prototype, 'vibrate', originalVibrate);
    } else {
      Reflect.deleteProperty(Navigator.prototype, 'vibrate');
    }
  });

  async function render(): Promise<{ fixture: ComponentFixture<Host>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function makeVideoReady(el: HTMLElement): HTMLVideoElement {
    const video = el.querySelector('video')!;
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
    return video;
  }

  it('opens full screen, confirms two matching reads, vibrates and stops the camera', async () => {
    const { stream, track } = fakeStream();
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    expect(opener).toHaveBeenCalledTimes(1);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    const video = makeVideoReady(el);
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(el.textContent).toContain('Line up the barcode inside the frame');

    reads.push([{ rawValue: EAN, format: 'ean_13' }], [{ rawValue: EAN, format: 'ean_13' }]);
    await scheduler.frame();
    await fixture.whenStable();
    expect(el.textContent).toContain('Hold steady');
    expect(fixture.componentInstance.codes).toEqual([]);
    await scheduler.frame();
    await fixture.whenStable();

    expect(fixture.componentInstance.codes).toEqual([EAN]);
    expect(track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(vibrate).toHaveBeenCalledWith(40);
    expect(scheduler.waiting).toBe(false);
  });

  it('stops every track when the scanner is destroyed', async () => {
    const { stream, track } = fakeStream();
    opener.mockResolvedValue(stream);
    const { fixture } = await render();
    fixture.componentInstance.show.set(false);
    await fixture.whenStable();
    expect(track.stop).toHaveBeenCalled();
    expect(document.documentElement.hasAttribute('data-scroll-locked')).toBe(false);
  });

  it('closes from the close button and releases the camera', async () => {
    const { stream, track } = fakeStream();
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('button[aria-label="Close scanner"]')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.closed).toBe(1);
    expect(track.stop).toHaveBeenCalled();
  });

  it('backs out of the typed number first, then closes and releases the camera', async () => {
    const { stream, track } = fakeStream();
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    const dialog = el.querySelector('dialog')!;
    buttonWith(el, 'Type number')!.click();
    await fixture.whenStable();
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await fixture.whenStable();
    expect(el.querySelector('#barcode-number')).toBeNull();
    expect(fixture.componentInstance.closed).toBe(0);
    expect(track.stop).not.toHaveBeenCalled();

    buttonWith(el, 'Type number')!.click();
    await fixture.whenStable();
    dialog.dispatchEvent(new Event('cancel', { cancelable: false }));
    dialog.close();
    await fixture.whenStable();
    expect(fixture.componentInstance.closed).toBe(1);
    expect(track.stop).toHaveBeenCalled();
  });

  it('releases the camera when the browser closes the dialog on its own', async () => {
    const { stream, track } = fakeStream();
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    el.querySelector('dialog')!.close();
    await fixture.whenStable();
    expect(fixture.componentInstance.closed).toBe(1);
    expect(track.stop).toHaveBeenCalled();
  });

  it('stops the camera while the page is hidden and restarts it when visible', async () => {
    const first = fakeStream();
    const second = fakeStream();
    opener.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const { fixture, el } = await render();
    setVisibility('hidden');
    await fixture.whenStable();
    expect(first.track.stop).toHaveBeenCalled();
    expect(el.textContent).toContain('Camera paused');
    setVisibility('visible');
    await flush();
    await fixture.whenStable();
    expect(opener).toHaveBeenCalledTimes(2);
    expect(el.querySelector('video')?.srcObject).toBe(second.stream);
    expect(second.track.stop).not.toHaveBeenCalled();
  });

  it('explains a denied permission and keeps both fallbacks', async () => {
    opener.mockRejectedValue(new CameraError('denied'));
    const { el } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Camera access is off');
    expect(buttonWith(el, 'Try again')).toBeDefined();
    expect(buttonWith(el, 'Type number')).toBeDefined();
    expect(buttonWith(el, 'Take photo')).toBeDefined();
    expect(el.querySelector('button[aria-label="Choose from gallery"]')).not.toBeNull();
  });

  it('explains an insecure context without a retry button', async () => {
    opener.mockRejectedValue(new CameraError('insecure'));
    const { el } = await render();
    expect(el.textContent).toContain('The camera needs a secure connection');
    expect(buttonWith(el, 'Try again')).toBeUndefined();
  });

  it('validates a typed number before looking it up', async () => {
    opener.mockRejectedValue(new CameraError('no-camera'));
    const { fixture, el } = await render();
    buttonWith(el, 'Type number')!.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#barcode-number')!;
    expect(input.getAttribute('inputmode')).toBe('numeric');

    input.value = '5281 2345 6789 0';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(input.value).toBe('5281234567890');
    expect(el.textContent).toContain("That number doesn't add up");
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.codes).toEqual([]);

    input.value = '036000291452';
    input.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.codes).toEqual(['0036000291452']);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('stops flagging a typed number while it is being retyped', async () => {
    opener.mockRejectedValue(new CameraError('no-camera'));
    const { fixture, el } = await render();
    buttonWith(el, 'Type number')!.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#barcode-number')!;
    const form = el.querySelector('form')!;
    const retype = async (value: string): Promise<void> => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };

    await retype('5285008140958');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(el.textContent).toContain("That number doesn't add up");
    expect(fixture.componentInstance.codes).toEqual([]);

    await retype('52850');
    expect(el.querySelector('#barcode-number-error')).toBeNull();
    expect(el.querySelector('#barcode-number-help')).not.toBeNull();
    expect(input.hasAttribute('aria-invalid')).toBe(false);

    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(el.textContent).toContain('8, 12, 13 or 14 digits');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    await retype('5285008140957');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.codes).toEqual(['5285008140957']);
  });

  it('reads the barcode from a photo instead', async () => {
    const { stream, track } = fakeStream();
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    const photo = el.querySelector<HTMLInputElement>('input[type="file"][capture]')!;
    expect(photo.getAttribute('capture')).toBe('environment');
    const click = vi.spyOn(photo, 'click').mockImplementation(() => undefined);
    buttonWith(el, 'Take photo')!.click();
    expect(click).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();

    reads.push([{ rawValue: EAN, format: 'ean_13' }]);
    const file = new File(['x'], 'barcode.jpg', { type: 'image/jpeg' });
    Object.defineProperty(photo, 'files', {
      configurable: true,
      value: { item: (index: number) => (index === 0 ? file : null), length: 1 },
    });
    photo.dispatchEvent(new Event('change'));
    await flush();
    await fixture.whenStable();
    expect(reader.detect).toHaveBeenCalledWith(file);
    expect(fixture.componentInstance.codes).toEqual([EAN]);
  });

  it('says so when a photo has no barcode and restarts the camera', async () => {
    opener.mockImplementation(async () => fakeStream().stream);
    const { fixture, el } = await render();
    const photo = el.querySelector<HTMLInputElement>('input[type="file"][capture]')!;
    vi.spyOn(photo, 'click').mockImplementation(() => undefined);
    buttonWith(el, 'Take photo')!.click();
    chooseFile(photo, new File(['x'], 'blurry.jpg', { type: 'image/jpeg' }));
    await flush();
    await fixture.whenStable();
    expect(el.textContent).toContain('No barcode found in that photo');
    expect(opener).toHaveBeenCalledTimes(2);
  });

  it('reads a barcode or GS1 QR code from a gallery image without the camera capture hint', async () => {
    const { stream, track } = fakeStream();
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    const gallery = galleryInput(el);
    expect(gallery.hasAttribute('capture')).toBe(false);
    expect(gallery.getAttribute('accept')).toBe('image/*');
    const click = vi.spyOn(gallery, 'click').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="Choose from gallery"]')!.click();
    expect(click).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();

    reads.push([{ rawValue: 'https://id.gs1.org/01/09506000134352/10/LOT7', format: 'qr_code' }]);
    const file = new File(['x'], 'screenshot.png', { type: 'image/png' });
    chooseFile(gallery, file);
    await flush();
    await fixture.whenStable();
    expect(reader.detect).toHaveBeenCalledWith(file);
    expect(fixture.componentInstance.codes).toEqual(['9506000134352']);
    expect(gallery.value).toBe('');
  });

  it('explains a gallery QR without a product code and never follows its link', async () => {
    opener.mockImplementation(async () => fakeStream().stream);
    const { fixture, el } = await render();
    const gallery = galleryInput(el);
    vi.spyOn(gallery, 'click').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    el.querySelector<HTMLButtonElement>('button[aria-label="Choose from gallery"]')!.click();
    reads.push([{ rawValue: 'https://cafe.example/menu', format: 'qr_code' }]);
    chooseFile(gallery, new File(['x'], 'menu.png', { type: 'image/png' }));
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No product code in this QR');
    expect(fixture.componentInstance.codes).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(opener).toHaveBeenCalledTimes(2);
  });

  it('restarts the camera when the gallery picker is dismissed', async () => {
    opener.mockImplementation(async () => fakeStream().stream);
    const { fixture, el } = await render();
    const gallery = galleryInput(el);
    vi.spyOn(gallery, 'click').mockImplementation(() => undefined);
    el.querySelector<HTMLButtonElement>('button[aria-label="Choose from gallery"]')!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Camera paused');
    gallery.dispatchEvent(new Event('cancel'));
    await flush();
    await fixture.whenStable();
    expect(opener).toHaveBeenCalledTimes(2);
    expect(el.textContent).not.toContain('Camera paused');
  });

  it('reports an unreadable gallery image', async () => {
    opener.mockImplementation(async () => fakeStream().stream);
    const { fixture, el } = await render();
    const gallery = galleryInput(el);
    vi.spyOn(gallery, 'click').mockImplementation(() => undefined);
    vi.mocked(reader.detect).mockRejectedValueOnce(new Error('corrupt'));
    el.querySelector<HTMLButtonElement>('button[aria-label="Choose from gallery"]')!.click();
    chooseFile(gallery, new File(['x'], 'broken.jpg', { type: 'image/jpeg' }));
    await flush();
    await fixture.whenStable();
    expect(el.textContent).toContain("Couldn't read that photo");
  });

  it('points out a live QR code that has no product code', async () => {
    opener.mockResolvedValue(fakeStream().stream);
    const { fixture, el } = await render();
    makeVideoReady(el);
    reads.push([{ rawValue: 'https://cafe.example/menu', format: 'qr_code' }]);
    await scheduler.frame();
    await fixture.whenStable();
    expect(el.querySelector('[role="status"]')?.textContent).toContain(
      'No product code in this QR',
    );
    expect(fixture.componentInstance.codes).toEqual([]);

    const link = { rawValue: '(01)09506000134352', format: 'qr_code' };
    reads.push([link], [link]);
    await scheduler.frame();
    await fixture.whenStable();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Hold steady');
    await scheduler.frame();
    await fixture.whenStable();
    expect(fixture.componentInstance.codes).toEqual(['9506000134352']);
  });

  it('toggles the torch when the camera supports it', async () => {
    const { stream, track } = fakeStream({ torch: true });
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    const torch = el.querySelector<HTMLButtonElement>('button[aria-label="Flashlight"]')!;
    expect(torch.getAttribute('aria-pressed')).toBe('false');
    torch.click();
    await flush();
    await fixture.whenStable();
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(torch.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides the torch button when the camera has no torch', async () => {
    opener.mockResolvedValue(fakeStream().stream);
    const { el } = await render();
    expect(el.querySelector('button[aria-label="Flashlight"]')).toBeNull();
  });

  it('offers the torch when the camera reports it only once the video plays', async () => {
    const capabilities: Record<string, unknown> = {};
    opener.mockResolvedValue(fakeStream(capabilities).stream);
    let playing: () => void = () => undefined;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          playing = () => {
            capabilities['torch'] = true;
            resolve();
          };
        }),
    );
    const { fixture, el } = await render();
    expect(el.querySelector('button[aria-label="Flashlight"]')).toBeNull();
    playing();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('button[aria-label="Flashlight"]')).not.toBeNull();
  });

  it('starts zoomed in to 2x when the camera can zoom and switches back to 1x', async () => {
    const { stream, track } = fakeStream({ zoom: { min: 1, max: 8 } });
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
    const one = buttonWith(el, '1×')!;
    const two = buttonWith(el, '2×')!;
    expect(two.getAttribute('aria-pressed')).toBe('true');
    expect(one.getAttribute('aria-pressed')).toBe('false');

    one.click();
    await flush();
    await fixture.whenStable();
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1 }] });
    expect(one.getAttribute('aria-pressed')).toBe('true');
    expect(two.getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps 1x after the camera restarts', async () => {
    const first = fakeStream({ zoom: { min: 1, max: 8 } });
    const second = fakeStream({ zoom: { min: 1, max: 8 } });
    opener.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const { fixture, el } = await render();
    buttonWith(el, '1×')!.click();
    await flush();
    await fixture.whenStable();
    setVisibility('hidden');
    await fixture.whenStable();
    setVisibility('visible');
    await flush();
    await fixture.whenStable();
    expect(second.track.applyConstraints).not.toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
    expect(buttonWith(el, '1×')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides the zoom switch when the camera cannot zoom far enough', async () => {
    opener.mockResolvedValueOnce(fakeStream({ zoom: { min: 1, max: 1.5 } }).stream);
    const { el } = await render();
    expect(el.querySelector('[aria-label="Camera zoom"]')).toBeNull();
  });

  it('hides the zoom switch when the camera refuses to zoom', async () => {
    const { stream, track } = fakeStream({ zoom: { min: 1, max: 8 } });
    track.applyConstraints.mockRejectedValue(new DOMException('nope', 'OverconstrainedError'));
    opener.mockResolvedValue(stream);
    const { fixture, el } = await render();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('[aria-label="Camera zoom"]')).toBeNull();
  });

  it('shows the camera preview while the barcode reader is still loading', async () => {
    opener.mockResolvedValue(fakeStream().stream);
    let ready: (value: BarcodeReader) => void = () => undefined;
    TestBed.overrideProvider(BarcodeReaderLoader, {
      useValue: { load: () => new Promise<BarcodeReader>((resolve) => (ready = resolve)) },
    });
    const { fixture, el } = await render();
    const video = el.querySelector('video')!;
    expect(video.classList.contains('opacity-0')).toBe(false);
    expect(el.textContent).toContain('Getting the scanner ready');
    expect(scheduler.waiting).toBe(false);

    ready(reader);
    await flush();
    await fixture.whenStable();
    expect(el.textContent).toContain('Line up the barcode');
    expect(scheduler.waiting).toBe(true);

    fixture.componentInstance.show.set(false);
    await fixture.whenStable();
  });
});
