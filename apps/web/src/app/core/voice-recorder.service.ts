import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import { API_LIMITS } from '@food/shared';
import { ApiService } from './api.service';
import { apiErrorMessage, errorMessage, httpStatus } from './errors';
import { NetworkService } from './network.service';

export type VoiceState = 'idle' | 'starting' | 'recording' | 'transcribing';
export type VoiceAutoStopHandler = (text: string | null) => void;

export const VOICE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4'] as const;
export const VOICE_TICK_MS = 250;
export const VOICE_MIN_RECORDING_MS = 500;

export const VOICE_DENIED_MESSAGE =
  "Microphone access is blocked. Allow it for this app in your browser settings, or use your keyboard's dictation key.";
export const VOICE_OFFLINE_MESSAGE =
  "You're offline. Voice needs a connection; your keyboard's dictation key still works.";
export const VOICE_EMPTY_MESSAGE = "Didn't catch that. Try again.";
export const VOICE_NO_MICROPHONE_MESSAGE =
  "No microphone was found. Use your keyboard's dictation key instead.";
export const VOICE_MICROPHONE_BUSY_MESSAGE =
  'The microphone is in use by another app. Close it and try again.';
export const VOICE_RECORDING_FAILED_MESSAGE =
  "Recording didn't work. Try again, or use your keyboard's dictation key.";
export const VOICE_TOO_LARGE_MESSAGE = 'That recording is too large to send. Try a shorter one.';
export const VOICE_NOT_CONFIGURED_MESSAGE =
  "Voice isn't available because AI is not set up on the server.";
export const VOICE_TRANSCRIBE_FAILED_MESSAGE = "Couldn't transcribe that. Try again.";

const DENIED_ERRORS = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);
const MISSING_ERRORS = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);
const BUSY_ERRORS = new Set(['NotReadableError', 'TrackStartError', 'AbortError']);

export function pickVoiceMimeType(
  recorder: Pick<typeof MediaRecorder, 'isTypeSupported'> | undefined,
): string | undefined {
  if (typeof recorder?.isTypeSupported !== 'function') {
    return undefined;
  }
  return VOICE_MIME_TYPES.find((type) => recorder.isTypeSupported(type));
}

export function microphoneErrorMessage(err: unknown): string {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : null;
  if (typeof name !== 'string') {
    return VOICE_RECORDING_FAILED_MESSAGE;
  }
  if (DENIED_ERRORS.has(name)) {
    return VOICE_DENIED_MESSAGE;
  }
  if (MISSING_ERRORS.has(name)) {
    return VOICE_NO_MICROPHONE_MESSAGE;
  }
  return BUSY_ERRORS.has(name) ? VOICE_MICROPHONE_BUSY_MESSAGE : VOICE_RECORDING_FAILED_MESSAGE;
}

export function canResendRecording(err: unknown): boolean {
  const status = httpStatus(err);
  return status === null || status === 0 || status === 429 || status >= 500;
}

export function transcribeErrorMessage(err: unknown): string {
  const status = httpStatus(err);
  if (status === 0) {
    return VOICE_OFFLINE_MESSAGE;
  }
  if (status === 413) {
    return VOICE_TOO_LARGE_MESSAGE;
  }
  const serverMessage =
    status === null ? null : apiErrorMessage((err as { error?: unknown }).error);
  if (status === 503 && serverMessage && /not configured/i.test(serverMessage)) {
    return VOICE_NOT_CONFIGURED_MESSAGE;
  }
  return errorMessage(err, VOICE_TRANSCRIBE_FAILED_MESSAGE);
}

@Injectable({ providedIn: 'root' })
export class VoiceRecorderService {
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly api = inject(ApiService);
  private readonly network = inject(NetworkService);

  private readonly stateSignal = signal<VoiceState>('idle');
  private readonly secondsSignal = signal(0);
  private readonly errorSignal = signal<string | null>(null);
  private readonly resendSignal = signal(false);

  private session = 0;
  private keptAudio: Blob | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingStop: Promise<string | null> | null = null;
  private onAutoStop: VoiceAutoStopHandler | null = null;

  readonly supported =
    typeof this.window?.navigator?.mediaDevices?.getUserMedia === 'function' &&
    typeof this.window.MediaRecorder === 'function';
  readonly maxSeconds = API_LIMITS.voiceMaxSeconds;
  readonly state = this.stateSignal.asReadonly();
  readonly seconds = this.secondsSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly canResend = this.resendSignal.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  async start(onAutoStop: VoiceAutoStopHandler | null = null): Promise<boolean> {
    const win = this.window;
    if (!this.supported || !win || this.stateSignal() !== 'idle') {
      return false;
    }
    this.errorSignal.set(null);
    this.keptAudio = null;
    this.resendSignal.set(false);
    if (!this.network.online()) {
      this.errorSignal.set(VOICE_OFFLINE_MESSAGE);
      return false;
    }
    const session = ++this.session;
    this.secondsSignal.set(0);
    this.stateSignal.set('starting');
    let stream: MediaStream;
    try {
      stream = await win.navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (session === this.session) {
        this.fail(microphoneErrorMessage(err));
      }
      return false;
    }
    if (session !== this.session) {
      stopTracks(stream);
      return false;
    }
    this.stream = stream;
    try {
      this.recorder = this.createRecorder(win.MediaRecorder, stream, session);
      this.recorder.start();
    } catch {
      this.fail(VOICE_RECORDING_FAILED_MESSAGE);
      return false;
    }
    this.onAutoStop = onAutoStop;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), VOICE_TICK_MS);
    this.stateSignal.set('recording');
    return true;
  }

  stop(): Promise<string | null> {
    if (this.pendingStop) {
      return this.pendingStop;
    }
    if (this.stateSignal() !== 'recording') {
      return Promise.resolve(null);
    }
    const pending = this.finish().finally(() => {
      if (this.pendingStop === pending) {
        this.pendingStop = null;
      }
    });
    this.pendingStop = pending;
    return pending;
  }

  resend(): Promise<string | null> {
    const audio = this.keptAudio;
    if (!audio || this.stateSignal() !== 'idle') {
      return Promise.resolve(null);
    }
    this.errorSignal.set(null);
    this.resendSignal.set(false);
    const session = ++this.session;
    this.stateSignal.set('transcribing');
    return this.send(audio, session);
  }

  cancel(): void {
    this.reset();
    this.errorSignal.set(null);
  }

  dismissError(): void {
    this.errorSignal.set(null);
  }

  private createRecorder(
    Recorder: typeof MediaRecorder,
    stream: MediaStream,
    session: number,
  ): MediaRecorder {
    const mimeType = pickVoiceMimeType(Recorder);
    const recorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream);
    this.chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (session === this.session && event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    recorder.addEventListener('error', () => {
      if (session === this.session && this.stateSignal() === 'recording') {
        this.fail(VOICE_RECORDING_FAILED_MESSAGE);
      }
    });
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        if (session === this.session && this.stateSignal() === 'recording') {
          this.autoStop();
        }
      });
    }
    return recorder;
  }

  private tick(): void {
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    this.secondsSignal.set(Math.min(elapsed, this.maxSeconds));
    if (elapsed >= this.maxSeconds) {
      this.autoStop();
    }
  }

  private autoStop(): void {
    const notify = this.onAutoStop;
    void this.stop().then((text) => notify?.(text));
  }

  private async finish(): Promise<string | null> {
    const session = this.session;
    const elapsedMs = Date.now() - this.startedAt;
    this.clearTimer();
    this.stateSignal.set('transcribing');
    const audio = await this.collect();
    if (session !== this.session) {
      return null;
    }
    if (!audio || audio.size === 0 || elapsedMs < VOICE_MIN_RECORDING_MS) {
      this.fail(VOICE_EMPTY_MESSAGE);
      return null;
    }
    return this.send(audio, session);
  }

  private async send(audio: Blob, session: number): Promise<string | null> {
    if (!this.network.online()) {
      this.keep(audio, VOICE_OFFLINE_MESSAGE);
      return null;
    }
    try {
      const { text } = await this.api.transcribe(audio);
      if (session !== this.session) {
        return null;
      }
      const transcript = text.trim();
      if (!transcript) {
        this.fail(VOICE_EMPTY_MESSAGE);
        return null;
      }
      this.reset();
      return transcript;
    } catch (err) {
      if (session !== this.session) {
        return null;
      }
      const offline = !this.network.online();
      const message = offline ? VOICE_OFFLINE_MESSAGE : transcribeErrorMessage(err);
      if (offline || canResendRecording(err)) {
        this.keep(audio, message);
      } else {
        this.fail(message);
      }
      return null;
    }
  }

  private keep(audio: Blob, message: string): void {
    this.fail(message);
    this.keptAudio = audio;
    this.resendSignal.set(true);
  }

  private collect(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder) {
      return Promise.resolve(null);
    }
    return new Promise<Blob | null>((resolve) => {
      const done = (): void =>
        resolve(new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0]?.type || '' }));
      if (recorder.state === 'inactive') {
        done();
        return;
      }
      recorder.addEventListener('stop', done, { once: true });
      try {
        recorder.stop();
      } catch {
        done();
      }
    }).finally(() => this.releaseMicrophone());
  }

  private fail(message: string): void {
    this.reset();
    this.errorSignal.set(message);
  }

  private reset(): void {
    this.session += 1;
    this.clearTimer();
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        this.chunks = [];
      }
    }
    this.releaseMicrophone();
    this.chunks = [];
    this.onAutoStop = null;
    this.keptAudio = null;
    this.resendSignal.set(false);
    this.secondsSignal.set(0);
    this.stateSignal.set('idle');
  }

  private releaseMicrophone(): void {
    const stream = this.stream;
    this.stream = null;
    if (stream) {
      stopTracks(stream);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
