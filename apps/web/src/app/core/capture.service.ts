import { Injectable, type WritableSignal, inject, signal } from '@angular/core';
import { type NavigationBehaviorOptions, Router } from '@angular/router';
import { API_LIMITS, BARCODE_PATTERN, type AnalysisMode, type ImageRole } from '@food/shared';
import { onSessionReset } from './session-scope';

export type CaptureSource = 'camera' | 'library' | 'text';
export type ImageCaptureSource = Exclude<CaptureSource, 'text'>;

export interface CaptureRequest {
  file: File | null;
  mode: AnalysisMode;
  source: CaptureSource;
  description?: string;
  barcode?: string;
}

export interface CaptureInputs {
  camera: HTMLInputElement;
  library: HTMLInputElement;
}

export interface SearchRequest {
  id: number;
  query: string | null;
}

export interface ScanRequest {
  id: number;
}

export interface PhotoAddition {
  id: number;
  files: File[];
  skipped: number;
  source: ImageCaptureSource;
  role: ImageRole | null;
}

export interface AddPhotoOptions {
  role?: ImageRole;
  max?: number;
}

interface RequestedAddition {
  role: ImageRole | null;
  max: number;
}

export const LOG_PATH = '/log';
export const SEARCH_PATH = '/log?search=1';
export const SCAN_PATH = '/log?scan=1';

function cleanDescription(text: string | undefined): string | undefined {
  const trimmed = text?.trim().slice(0, API_LIMITS.descriptionMax);
  return trimmed ? trimmed : undefined;
}

function chosenFiles(input: HTMLInputElement): File[] {
  const list = input.files;
  const files: File[] = [];
  for (let index = 0; list && index < list.length; index++) {
    const file = list.item(index);
    if (file) {
      files.push(file);
    }
  }
  return files;
}

function additionLimit(max: number | undefined): number {
  return Math.min(Math.max(Math.floor(max ?? 1), 1), API_LIMITS.analyzeImagesMax);
}

@Injectable({ providedIn: 'root' })
export class CaptureService {
  private readonly router = inject(Router);
  private readonly pendingState = signal<CaptureRequest | null>(null);
  private readonly searchState = signal<SearchRequest | null>(null);
  private readonly scanState = signal<ScanRequest | null>(null);
  private readonly additionState = signal<PhotoAddition | null>(null);
  private inputs: CaptureInputs | null = null;
  private requestedMode: AnalysisMode = 'food_photo';
  private requestedDescription: string | undefined;
  private requestedBarcode: string | undefined;
  private requestedAddition: RequestedAddition | null = null;
  private searchSeq = 0;
  private scanSeq = 0;
  private additionSeq = 0;

  readonly pending = this.pendingState.asReadonly();
  readonly searchRequest = this.searchState.asReadonly();
  readonly scanRequest = this.scanState.asReadonly();
  readonly addition = this.additionState.asReadonly();

  constructor() {
    onSessionReset(() => this.reset());
  }

  attachInputs(inputs: CaptureInputs): () => void {
    const listeners: [HTMLInputElement, () => void][] = [
      [inputs.camera, () => this.onInputChange('camera', inputs.camera)],
      [inputs.library, () => this.onInputChange('library', inputs.library)],
    ];
    listeners.forEach(([input, listener]) => input.addEventListener('change', listener));
    this.inputs = inputs;
    return () => {
      listeners.forEach(([input, listener]) => input.removeEventListener('change', listener));
      if (this.inputs === inputs) {
        this.inputs = null;
      }
    };
  }

  requestCamera(mode: AnalysisMode = 'food_photo', description?: string): void {
    this.openPicker('camera', mode, description);
  }

  requestLibrary(mode: AnalysisMode = 'food_photo', description?: string): void {
    this.openPicker('library', mode, description);
  }

  requestLabelScan(barcode: string): void {
    this.openPicker('camera', 'nutrition_label', undefined, barcode);
  }

  requestAddPhoto(source: ImageCaptureSource, options: AddPhotoOptions = {}): void {
    const input = this.inputs?.[source];
    if (!input) {
      return;
    }
    const max = additionLimit(options.max);
    this.requestedAddition = { role: options.role ?? null, max };
    this.requestedDescription = undefined;
    this.requestedBarcode = undefined;
    input.multiple = source === 'library' && max > 1;
    input.value = '';
    input.click();
  }

  requestBarcode(): void {
    this.handOff(this.scanState, { id: ++this.scanSeq }, SCAN_PATH, {
      replaceUrl: this.onLogPage(),
    });
  }

  startText(description?: string): void {
    this.submit(this.request(null, 'text', 'text', description));
  }

  openSearch(query?: string): void {
    const text = query?.trim() ?? '';
    this.handOff(this.searchState, { id: ++this.searchSeq, query: text || null }, SEARCH_PATH);
  }

  consume(): CaptureRequest | null {
    const request = this.pendingState();
    this.pendingState.set(null);
    return request;
  }

  consumeSearch(): SearchRequest | null {
    const request = this.searchState();
    this.searchState.set(null);
    return request;
  }

  consumeScan(): ScanRequest | null {
    const request = this.scanState();
    this.scanState.set(null);
    return request;
  }

  consumeAddition(): PhotoAddition | null {
    const addition = this.additionState();
    this.additionState.set(null);
    return addition;
  }

  reset(): void {
    this.pendingState.set(null);
    this.searchState.set(null);
    this.scanState.set(null);
    this.additionState.set(null);
    this.requestedMode = 'food_photo';
    this.requestedDescription = undefined;
    this.requestedBarcode = undefined;
    this.requestedAddition = null;
  }

  private openPicker(
    source: ImageCaptureSource,
    mode: AnalysisMode,
    description: string | undefined,
    barcode?: string,
  ): void {
    const input = this.inputs?.[source];
    if (!input) {
      this.submit(this.request(null, mode, source, description, barcode));
      return;
    }
    this.requestedMode = mode;
    this.requestedDescription = description;
    this.requestedBarcode = barcode;
    this.requestedAddition = null;
    input.multiple = false;
    input.value = '';
    input.click();
  }

  private onInputChange(source: ImageCaptureSource, input: HTMLInputElement): void {
    const addition = this.requestedAddition;
    if (addition) {
      this.acceptAddition(source, input, addition);
      return;
    }
    const file = input.files?.item(0) ?? null;
    input.value = '';
    if (file) {
      this.submit(
        this.request(
          file,
          this.requestedMode,
          source,
          this.requestedDescription,
          this.requestedBarcode,
        ),
      );
    }
    this.requestedDescription = undefined;
    this.requestedBarcode = undefined;
  }

  private acceptAddition(
    source: ImageCaptureSource,
    input: HTMLInputElement,
    addition: RequestedAddition,
  ): void {
    const chosen = chosenFiles(input);
    const files = chosen.slice(0, addition.max);
    input.value = '';
    input.multiple = false;
    this.requestedAddition = null;
    if (files.length > 0) {
      this.additionState.set({
        id: ++this.additionSeq,
        files,
        skipped: chosen.length - files.length,
        source,
        role: addition.role,
      });
    }
  }

  private request(
    file: File | null,
    mode: AnalysisMode,
    source: CaptureSource,
    description: string | undefined,
    barcode?: string,
  ): CaptureRequest {
    const text = cleanDescription(description);
    const request: CaptureRequest = text
      ? { file, mode, source, description: text }
      : { file, mode, source };
    return barcode && BARCODE_PATTERN.test(barcode) ? { ...request, barcode } : request;
  }

  private submit(request: CaptureRequest): void {
    this.handOff(this.pendingState, request, LOG_PATH);
  }

  private onLogPage(): boolean {
    return this.router.url.split(/[?#]/)[0] === LOG_PATH;
  }

  private handOff<T>(
    state: WritableSignal<T | null>,
    request: T,
    url: string,
    extras?: NavigationBehaviorOptions,
  ): void {
    state.set(request);
    const navigation = extras
      ? this.router.navigateByUrl(url, extras)
      : this.router.navigateByUrl(url);
    void navigation
      .catch(() => false)
      .then((landed) => {
        if (!landed && !this.onLogPage() && state() === request) {
          state.set(null);
        }
      });
  }
}
