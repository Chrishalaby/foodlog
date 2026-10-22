import {
  CAMERA_CONSTRAINTS,
  CameraError,
  cameraErrorKind,
  openCamera,
  SCAN_ZOOM,
  preferContinuousFocus,
  setTorch,
  setZoom,
  stopStream,
  supportsScanZoom,
  supportsTorch,
  type CameraEnvironment,
} from './camera';

function track(capabilities: Record<string, unknown> = {}) {
  return {
    stop: vi.fn(),
    getCapabilities: () => capabilities,
    applyConstraints: vi.fn(async () => undefined),
  };
}

function env(overrides: Partial<CameraEnvironment> = {}): CameraEnvironment {
  return {
    secure: true,
    mediaDevices: { getUserMedia: vi.fn(async () => ({}) as MediaStream) },
    ...overrides,
  };
}

describe('camera helpers', () => {
  it('asks for the rear camera at about 1920 px wide with zoom and without audio', async () => {
    const devices = { getUserMedia: vi.fn(async () => ({}) as MediaStream) };
    await openCamera(env({ mediaDevices: devices }));
    expect(devices.getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(CAMERA_CONSTRAINTS).toEqual({
      audio: false,
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        zoom: true,
      },
    });
  });

  it('explains insecure contexts and missing camera APIs', async () => {
    await expect(openCamera(env({ secure: false }))).rejects.toMatchObject({ kind: 'insecure' });
    await expect(openCamera(env({ mediaDevices: null }))).rejects.toMatchObject({
      kind: 'unsupported',
    });
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'in-use'],
    ['TypeError', 'unknown'],
  ])('maps %s to %s', async (name, kind) => {
    const error = new DOMException('nope', name);
    const devices = { getUserMedia: vi.fn(async () => Promise.reject(error)) };
    await expect(openCamera(env({ mediaDevices: devices }))).rejects.toMatchObject({ kind });
    expect(cameraErrorKind(error)).toBe(kind);
  });

  it('keeps the kind of an existing camera error', () => {
    expect(cameraErrorKind(new CameraError('denied'))).toBe('denied');
    expect(cameraErrorKind('weird')).toBe('unknown');
  });

  it('stops every track of a stream', () => {
    const tracks = [track(), track()];
    stopStream({ getTracks: () => tracks } as unknown as MediaStream);
    stopStream(null);
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
  });

  it('detects and toggles the torch when the track supports it', async () => {
    const withTorch = track({ torch: true });
    expect(supportsTorch(withTorch as unknown as MediaStreamTrack)).toBe(true);
    expect(supportsTorch(track() as unknown as MediaStreamTrack)).toBe(false);
    expect(await setTorch(withTorch as unknown as MediaStreamTrack, true)).toBe(true);
    expect(withTorch.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    withTorch.applyConstraints.mockRejectedValueOnce(new Error('no torch'));
    expect(await setTorch(withTorch as unknown as MediaStreamTrack, false)).toBe(false);
  });

  it('asks for continuous focus only when available', () => {
    const focus = track({ focusMode: ['manual', 'continuous'] });
    const fixed = track({ focusMode: ['manual'] });
    preferContinuousFocus(focus as unknown as MediaStreamTrack);
    preferContinuousFocus(fixed as unknown as MediaStreamTrack);
    expect(focus.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    });
    expect(fixed.applyConstraints).not.toHaveBeenCalled();
  });

  it('offers the scan zoom only when the camera can reach it from 1x', () => {
    const zoomable = (zoom: unknown) =>
      supportsScanZoom(track({ zoom }) as unknown as MediaStreamTrack);
    expect(SCAN_ZOOM).toBe(2);
    expect(zoomable({ min: 1, max: 8 })).toBe(true);
    expect(zoomable({ min: 1, max: 2 })).toBe(true);
    expect(zoomable({ min: 1, max: 1.5 })).toBe(false);
    expect(zoomable({ min: 2, max: 8 })).toBe(false);
    expect(zoomable(undefined)).toBe(false);
  });

  it('sets the zoom level and reports a refusal', async () => {
    const lens = track({ zoom: { min: 1, max: 8 } });
    expect(await setZoom(lens as unknown as MediaStreamTrack, 2)).toBe(true);
    expect(lens.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] });
    lens.applyConstraints.mockRejectedValueOnce(new DOMException('nope', 'OverconstrainedError'));
    expect(await setZoom(lens as unknown as MediaStreamTrack, 1)).toBe(false);
  });
});
