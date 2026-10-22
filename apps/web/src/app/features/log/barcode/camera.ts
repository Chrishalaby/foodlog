import { DOCUMENT, InjectionToken, inject } from '@angular/core';

export type CameraErrorKind =
  'insecure' | 'unsupported' | 'denied' | 'no-camera' | 'in-use' | 'unknown';

export class CameraError extends Error {
  constructor(readonly kind: CameraErrorKind) {
    super(`Camera unavailable: ${kind}`);
    this.name = 'CameraError';
  }
}

interface ScanVideoConstraints extends MediaTrackConstraints {
  zoom?: boolean;
}

const SCAN_VIDEO: ScanVideoConstraints = {
  facingMode: 'environment',
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  zoom: true,
};

export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: SCAN_VIDEO,
};

export const SCAN_ZOOM = 2;

export interface CameraEnvironment {
  secure: boolean;
  mediaDevices: Pick<MediaDevices, 'getUserMedia'> | null;
}

export type CameraOpener = () => Promise<MediaStream>;

interface ExtendedCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  focusMode?: readonly string[];
  zoom?: { min: number; max: number };
}

interface ExtendedConstraintSet extends MediaTrackConstraintSet {
  torch?: boolean;
  focusMode?: string;
  zoom?: number;
}

const ERROR_KINDS: Readonly<Record<string, CameraErrorKind>> = {
  NotAllowedError: 'denied',
  PermissionDeniedError: 'denied',
  SecurityError: 'denied',
  NotFoundError: 'no-camera',
  DevicesNotFoundError: 'no-camera',
  OverconstrainedError: 'no-camera',
  NotReadableError: 'in-use',
  TrackStartError: 'in-use',
  AbortError: 'in-use',
};

export function cameraErrorKind(err: unknown): CameraErrorKind {
  if (err instanceof CameraError) {
    return err.kind;
  }
  const name =
    typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : 'Error';
  return ERROR_KINDS[name] ?? 'unknown';
}

export async function openCamera(env: CameraEnvironment): Promise<MediaStream> {
  if (!env.secure) {
    throw new CameraError('insecure');
  }
  if (typeof env.mediaDevices?.getUserMedia !== 'function') {
    throw new CameraError('unsupported');
  }
  try {
    return await env.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
  } catch (err) {
    throw new CameraError(cameraErrorKind(err));
  }
}

export const CAMERA_OPENER = new InjectionToken<CameraOpener>('CAMERA_OPENER', {
  providedIn: 'root',
  factory: () => {
    const view = inject(DOCUMENT).defaultView;
    const env: CameraEnvironment = {
      secure: view?.isSecureContext === true,
      mediaDevices: view?.navigator.mediaDevices ?? null,
    };
    return () => openCamera(env);
  },
});

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function capabilitiesOf(track: MediaStreamTrack): ExtendedCapabilities | null {
  try {
    return typeof track.getCapabilities === 'function'
      ? (track.getCapabilities() as ExtendedCapabilities)
      : null;
  } catch {
    return null;
  }
}

export function supportsTorch(track: MediaStreamTrack): boolean {
  return capabilitiesOf(track)?.torch === true;
}

async function applyAdvanced(
  track: MediaStreamTrack,
  set: ExtendedConstraintSet,
): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [set] });
    return true;
  } catch {
    return false;
  }
}

export function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  return applyAdvanced(track, { torch: on });
}

export function supportsScanZoom(track: MediaStreamTrack): boolean {
  const zoom = capabilitiesOf(track)?.zoom;
  return zoom !== undefined && zoom.min <= 1 && zoom.max >= SCAN_ZOOM;
}

export function setZoom(track: MediaStreamTrack, level: number): Promise<boolean> {
  return applyAdvanced(track, { zoom: level });
}

export function preferContinuousFocus(track: MediaStreamTrack): void {
  if (capabilitiesOf(track)?.focusMode?.includes('continuous')) {
    void applyAdvanced(track, { focusMode: 'continuous' });
  }
}
