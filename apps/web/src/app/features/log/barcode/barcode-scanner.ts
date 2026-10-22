import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Icon } from '../../../shared/ui/icon';
import { lockScroll } from '../../../shared/ui/scroll-lock';
import { Spinner } from '../../../shared/ui/spinner';
import { BarcodeImageReader, IMAGE_SCAN_MESSAGES, firstImage } from './barcode-image';
import { BarcodeReaderLoader, type BarcodeReader } from './barcode-reader';
import {
  CAMERA_OPENER,
  SCAN_ZOOM,
  cameraErrorKind,
  preferContinuousFocus,
  setTorch,
  setZoom,
  stopStream,
  supportsScanZoom,
  supportsTorch,
  type CameraErrorKind,
} from './camera';
import {
  BARCODE_INPUT_MAX,
  BARCODE_INPUT_MESSAGES,
  barcodeInputProblem,
  canonicalBarcode,
  digitsOnly,
} from './gs1';
import { FRAME_SCHEDULER, ScanLoop } from './scan-loop';
import {
  CAMERA_PROBLEMS,
  QR_WITHOUT_PRODUCT_HINT,
  READER_PROBLEM,
  type ScannerProblem,
} from './scanner-copy';

export type ScannerStatus = 'starting' | 'live' | 'paused' | 'decoding' | 'error' | 'done';

const HAVE_CURRENT_DATA = 2;
const DETECTED_VIBRATION_MS = 40;
const RETRY_ON_RETURN = new Set<CameraErrorKind>(['denied', 'in-use', 'unknown']);

@Component({
  selector: 'app-barcode-scanner',
  imports: [Icon, Spinner],
  templateUrl: './barcode-scanner.html',
  styleUrl: './barcode-scanner.css',
})
export class BarcodeScanner {
  private readonly document = inject(DOCUMENT);
  private readonly openCamera = inject(CAMERA_OPENER);
  private readonly readers = inject(BarcodeReaderLoader);
  private readonly images = inject(BarcodeImageReader);
  private readonly schedulerFor = inject(FRAME_SCHEDULER);
  private readonly injector = inject(Injector);
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly photoRef = viewChild.required<ElementRef<HTMLInputElement>>('photoInput');
  private readonly galleryRef = viewChild.required<ElementRef<HTMLInputElement>>('galleryInput');
  private readonly manualRef = viewChild<ElementRef<HTMLInputElement>>('manualInput');
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private loop: ScanLoop | null = null;
  private run = 0;
  private destroyed = false;
  private releaseScroll: (() => void) | null = null;

  readonly detected = output<string>();
  readonly closed = output<void>();

  protected readonly inputMax = BARCODE_INPUT_MAX;
  protected readonly scanZoom = SCAN_ZOOM;
  protected readonly status = signal<ScannerStatus>('starting');
  protected readonly cameraError = signal<CameraErrorKind | null>(null);
  protected readonly readerFailed = signal(false);
  protected readonly torchAvailable = signal(false);
  protected readonly torchOn = signal(false);
  protected readonly zoomAvailable = signal(false);
  protected readonly zoomedIn = signal(true);
  protected readonly previewing = signal(false);
  protected readonly steady = signal(false);
  protected readonly foreignQr = signal(false);
  protected readonly manualOpen = signal(false);
  protected readonly manualText = signal('');
  protected readonly manualSubmitted = signal(false);
  protected readonly photoMessage = signal<string | null>(null);

  protected readonly problem = computed<ScannerProblem | null>(() => {
    if (this.status() !== 'error') {
      return null;
    }
    const kind = this.cameraError();
    return kind ? CAMERA_PROBLEMS[kind] : READER_PROBLEM;
  });
  protected readonly showFrame = computed(() => {
    const status = this.status();
    return status === 'live' || status === 'starting';
  });
  protected readonly hint = computed(() => {
    if (this.status() === 'starting') {
      return this.previewing() ? 'Getting the scanner ready…' : 'Starting camera…';
    }
    if (this.steady()) {
      return 'Hold steady…';
    }
    return this.foreignQr() ? QR_WITHOUT_PRODUCT_HINT : 'Line up the barcode inside the frame';
  });
  protected readonly canUsePhoto = computed(() => !this.readerFailed());
  protected readonly manualProblem = computed(() => {
    const text = this.manualText();
    const problem = barcodeInputProblem(text);
    if (!problem) {
      return null;
    }
    const complete = digitsOnly(text).length >= 13;
    return this.manualSubmitted() || (problem === 'check' && complete)
      ? BARCODE_INPUT_MESSAGES[problem]
      : null;
  });
  protected readonly manualValid = computed(() => barcodeInputProblem(this.manualText()) === null);

  constructor() {
    const onVisibility = (): void => this.onVisibilityChange();
    this.document.addEventListener('visibilitychange', onVisibility);
    afterNextRender(() => {
      if (this.destroyed) {
        return;
      }
      this.showDialog();
      void this.start();
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.document.removeEventListener('visibilitychange', onVisibility);
      this.shutdown();
      this.releaseScroll?.();
      this.releaseScroll = null;
    });
  }

  protected close(): void {
    if (this.status() === 'done') {
      return;
    }
    this.status.set('done');
    this.shutdown();
    this.closed.emit();
  }

  protected onCancel(event: Event): void {
    if (event.cancelable) {
      event.preventDefault();
      if (this.manualOpen()) {
        this.closeManual();
        return;
      }
    }
    this.close();
  }

  protected onNativeClose(): void {
    if (!this.destroyed) {
      this.close();
    }
  }

  protected retry(): void {
    this.readerFailed.set(false);
    this.cameraError.set(null);
    this.photoMessage.set(null);
    void this.start();
  }

  protected async toggleTorch(): Promise<void> {
    const track = this.track;
    if (!track) {
      return;
    }
    const next = !this.torchOn();
    if ((await setTorch(track, next)) && track === this.track) {
      this.torchOn.set(next);
    }
  }

  protected async setZoomedIn(on: boolean): Promise<void> {
    const track = this.track;
    if (!track || !this.zoomAvailable() || on === this.zoomedIn()) {
      return;
    }
    if ((await setZoom(track, on ? SCAN_ZOOM : 1)) && track === this.track) {
      this.zoomedIn.set(on);
    }
  }

  protected openManual(): void {
    this.manualOpen.set(true);
    this.manualSubmitted.set(false);
    this.photoMessage.set(null);
    afterNextRender(() => this.manualRef()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeManual(): void {
    this.manualOpen.set(false);
    this.manualText.set('');
    this.manualSubmitted.set(false);
  }

  protected onManualInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = digitsOnly(input.value).slice(0, BARCODE_INPUT_MAX);
    if (input.value !== digits) {
      input.value = digits;
    }
    if (digits !== this.manualText()) {
      this.manualSubmitted.set(false);
    }
    this.manualText.set(digits);
  }

  protected submitManual(event: Event): void {
    event.preventDefault();
    this.manualSubmitted.set(true);
    const code = this.manualValid() ? canonicalBarcode(digitsOnly(this.manualText())) : null;
    if (code) {
      this.finish(code, false);
    }
  }

  protected takePhoto(): void {
    this.pick(this.photoRef().nativeElement);
  }

  protected chooseFromGallery(): void {
    this.pick(this.galleryRef().nativeElement);
  }

  protected async onImage(input: HTMLInputElement): Promise<void> {
    const file = firstImage(input);
    if (!file) {
      this.resume();
      return;
    }
    const run = ++this.run;
    this.stopCamera();
    this.status.set('decoding');
    const result = await this.images.read(file);
    if (run !== this.run || this.destroyed) {
      return;
    }
    if (result.kind === 'code') {
      this.finish(result.code, true);
      return;
    }
    this.photoMessage.set(IMAGE_SCAN_MESSAGES[result.kind]);
    this.resume();
  }

  protected onPhotoCancel(): void {
    this.resume();
  }

  private pick(input: HTMLInputElement): void {
    this.photoMessage.set(null);
    this.pause();
    input.value = '';
    input.click();
  }

  private showDialog(): void {
    const dialog = this.dialogRef().nativeElement;
    if (!dialog.open) {
      dialog.showModal();
    }
    this.releaseScroll ??= lockScroll(this.document);
  }

  private async start(): Promise<void> {
    const run = ++this.run;
    this.stopCamera();
    this.status.set('starting');
    const reader = this.readers.load();
    reader.catch(() => undefined);
    let stream: MediaStream;
    try {
      stream = await this.openCamera();
    } catch (err) {
      if (run === this.run && !this.destroyed) {
        this.cameraError.set(cameraErrorKind(err));
        this.status.set('error');
      }
      return;
    }
    if (run !== this.run || this.destroyed) {
      stopStream(stream);
      return;
    }
    this.attach(stream);
    let loaded: BarcodeReader;
    try {
      loaded = await reader;
    } catch {
      if (run === this.run && !this.destroyed) {
        this.stopCamera();
        this.readerFailed.set(true);
        this.status.set('error');
      }
      return;
    }
    if (run !== this.run || this.destroyed) {
      return;
    }
    this.startLoop(loaded);
  }

  private attach(stream: MediaStream): void {
    this.stream = stream;
    this.cameraError.set(null);
    const track = stream.getVideoTracks()[0] ?? null;
    this.track = track;
    this.torchOn.set(false);
    this.torchAvailable.set(track !== null && supportsTorch(track));
    if (track) {
      preferContinuousFocus(track);
      this.offerZoom(track);
    }
    const video = this.videoRef()?.nativeElement;
    if (video) {
      video.muted = true;
      video.srcObject = stream;
      void playVideo(video).then(() => this.onPlaying(stream, track));
    }
  }

  private onPlaying(stream: MediaStream, track: MediaStreamTrack | null): void {
    if (this.stream !== stream || this.destroyed) {
      return;
    }
    this.previewing.set(true);
    if (!track) {
      return;
    }
    if (!this.torchAvailable()) {
      this.torchAvailable.set(supportsTorch(track));
    }
    this.offerZoom(track);
  }

  private offerZoom(track: MediaStreamTrack): void {
    if (this.zoomAvailable() || !supportsScanZoom(track)) {
      return;
    }
    this.zoomAvailable.set(true);
    if (!this.zoomedIn()) {
      return;
    }
    void setZoom(track, SCAN_ZOOM).then((applied) => {
      if (!applied && track === this.track) {
        this.zoomAvailable.set(false);
      }
    });
  }

  private startLoop(reader: BarcodeReader): void {
    const video = this.videoRef()?.nativeElement;
    if (!video) {
      return;
    }
    this.loop = new ScanLoop({
      reader,
      scheduler: this.schedulerFor(video),
      source: () => (video.readyState >= HAVE_CURRENT_DATA && video.videoWidth > 0 ? video : null),
      onPending: (code) => this.steady.set(code !== null),
      onForeign: (seen) => this.foreignQr.set(seen),
      onConfirmed: (code) => this.finish(code, true),
    });
    this.status.set('live');
    this.loop.start();
  }

  private finish(code: string, vibrate: boolean): void {
    if (this.status() === 'done') {
      return;
    }
    this.status.set('done');
    this.shutdown();
    if (vibrate) {
      this.vibrate();
    }
    this.detected.emit(code);
  }

  private vibrate(): void {
    const navigator = this.document.defaultView?.navigator;
    if (typeof navigator?.vibrate === 'function') {
      navigator.vibrate(DETECTED_VIBRATION_MS);
    }
  }

  private pause(): void {
    const status = this.status();
    if (status === 'done' || status === 'decoding') {
      return;
    }
    this.run += 1;
    this.stopCamera();
    if (status !== 'error') {
      this.status.set('paused');
    }
  }

  private resume(): void {
    const status = this.status();
    if (this.destroyed || status === 'done' || status === 'live' || status === 'starting') {
      return;
    }
    if (this.cameraError() !== null || this.readerFailed()) {
      this.status.set('error');
      return;
    }
    void this.start();
  }

  private onVisibilityChange(): void {
    if (this.destroyed || this.status() === 'done') {
      return;
    }
    if (this.document.visibilityState === 'hidden') {
      this.pause();
      return;
    }
    const kind = this.cameraError();
    if (this.status() === 'paused') {
      this.resume();
    } else if (this.status() === 'error' && kind !== null && RETRY_ON_RETURN.has(kind)) {
      this.retry();
    }
  }

  private shutdown(): void {
    this.run += 1;
    this.stopCamera();
  }

  private stopCamera(): void {
    this.loop?.stop();
    this.loop = null;
    stopStream(this.stream);
    this.stream = null;
    this.track = null;
    this.torchAvailable.set(false);
    this.torchOn.set(false);
    this.zoomAvailable.set(false);
    this.previewing.set(false);
    this.steady.set(false);
    this.foreignQr.set(false);
    const video = this.videoRef()?.nativeElement;
    if (video?.srcObject) {
      video.srcObject = null;
    }
  }
}

async function playVideo(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play();
  } catch {
    return;
  }
}
