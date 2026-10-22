export class FakeMediaTrack extends EventTarget {
  stopped = false;

  stop(): void {
    this.stopped = true;
  }

  end(): void {
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeMediaStream {
  readonly tracks = [new FakeMediaTrack()];

  getTracks(): FakeMediaTrack[] {
    return this.tracks;
  }

  get released(): boolean {
    return this.tracks.every((track) => track.stopped);
  }
}

export class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes: string[] = ['audio/webm;codecs=opus', 'audio/mp4'];
  static recording: Blob | null = null;
  static failOnStart = false;

  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.includes(type);
  }

  static reset(): void {
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.supportedTypes = ['audio/webm;codecs=opus', 'audio/mp4'];
    FakeMediaRecorder.recording = null;
    FakeMediaRecorder.failOnStart = false;
  }

  state: 'inactive' | 'recording' = 'inactive';
  readonly mimeType: string;
  stopCalls = 0;

  constructor(
    readonly stream: FakeMediaStream,
    readonly options?: { mimeType?: string },
  ) {
    super();
    this.mimeType = options?.mimeType ?? '';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    if (FakeMediaRecorder.failOnStart) {
      throw new DOMException('cannot start', 'NotSupportedError');
    }
    this.state = 'recording';
  }

  stop(): void {
    if (this.state === 'inactive') {
      throw new DOMException('not recording', 'InvalidStateError');
    }
    this.stopCalls += 1;
    this.state = 'inactive';
    const data = FakeMediaRecorder.recording ?? new Blob(['voice-bytes'], { type: this.mimeType });
    queueMicrotask(() => {
      const event = new Event('dataavailable');
      Object.defineProperty(event, 'data', { value: data });
      this.dispatchEvent(event);
      this.dispatchEvent(new Event('stop'));
    });
  }

  fail(): void {
    this.dispatchEvent(new Event('error'));
  }
}

export interface FakeMedia {
  readonly streams: FakeMediaStream[];
  readonly constraints: unknown[];
  rejectWith(error: unknown): void;
  holdPermission(): () => void;
  restore(): void;
}

export interface FakeMediaOptions {
  recorder?: boolean;
  devices?: boolean;
}

export function installFakeMedia(win: Window, options: FakeMediaOptions = {}): FakeMedia {
  const target = win as unknown as Record<string, unknown>;
  const navigatorTarget = win.navigator as unknown as Record<string, unknown>;
  const recorderBefore = Object.getOwnPropertyDescriptor(target, 'MediaRecorder');
  const devicesBefore = Object.getOwnPropertyDescriptor(navigatorTarget, 'mediaDevices');
  const streams: FakeMediaStream[] = [];
  const constraints: unknown[] = [];
  let rejection: unknown = null;
  let gate: Promise<void> | null = null;

  FakeMediaRecorder.reset();
  Object.defineProperty(target, 'MediaRecorder', {
    configurable: true,
    writable: true,
    value: options.recorder === false ? undefined : FakeMediaRecorder,
  });
  Object.defineProperty(navigatorTarget, 'mediaDevices', {
    configurable: true,
    value:
      options.devices === false
        ? undefined
        : {
            getUserMedia: async (requested: unknown): Promise<FakeMediaStream> => {
              constraints.push(requested);
              if (gate) {
                await gate;
              }
              if (rejection !== null) {
                throw rejection;
              }
              const stream = new FakeMediaStream();
              streams.push(stream);
              return stream;
            },
          },
  });

  const restoreProperty = (
    owner: Record<string, unknown>,
    key: string,
    descriptor: PropertyDescriptor | undefined,
  ): void => {
    if (descriptor) {
      Object.defineProperty(owner, key, descriptor);
    } else {
      Reflect.deleteProperty(owner, key);
    }
  };

  return {
    streams,
    constraints,
    rejectWith(error: unknown): void {
      rejection = error;
    },
    holdPermission(): () => void {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    restore(): void {
      restoreProperty(target, 'MediaRecorder', recorderBefore);
      restoreProperty(navigatorTarget, 'mediaDevices', devicesBefore);
      FakeMediaRecorder.reset();
    },
  };
}
