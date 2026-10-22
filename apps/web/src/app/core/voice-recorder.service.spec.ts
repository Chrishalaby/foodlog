import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_LIMITS, type TranscribeResponse } from '@food/shared';
import { ApiService } from './api.service';
import { RATE_LIMIT_MESSAGE } from './errors';
import { NetworkService } from './network.service';
import { FakeMediaRecorder, installFakeMedia, type FakeMedia } from './testing/fake-media';
import {
  VOICE_DENIED_MESSAGE,
  VOICE_EMPTY_MESSAGE,
  VOICE_MICROPHONE_BUSY_MESSAGE,
  VOICE_MIN_RECORDING_MS,
  VOICE_NOT_CONFIGURED_MESSAGE,
  VOICE_NO_MICROPHONE_MESSAGE,
  VOICE_OFFLINE_MESSAGE,
  VOICE_RECORDING_FAILED_MESSAGE,
  VOICE_TOO_LARGE_MESSAGE,
  VOICE_TRANSCRIBE_FAILED_MESSAGE,
  VoiceRecorderService,
  canResendRecording,
  microphoneErrorMessage,
  pickVoiceMimeType,
  transcribeErrorMessage,
} from './voice-recorder.service';

const httpError = (status: number, message?: string): HttpErrorResponse =>
  new HttpErrorResponse({ status, error: message ? { message } : null });

describe('pickVoiceMimeType', () => {
  const supporting = (...types: string[]) => ({
    isTypeSupported: (type: string) => types.includes(type),
  });

  it('prefers Opus in WebM, then MP4, then the browser default', () => {
    expect(pickVoiceMimeType(supporting('audio/webm;codecs=opus', 'audio/mp4'))).toBe(
      'audio/webm;codecs=opus',
    );
    expect(pickVoiceMimeType(supporting('audio/mp4'))).toBe('audio/mp4');
    expect(pickVoiceMimeType(supporting('audio/ogg'))).toBeUndefined();
    expect(pickVoiceMimeType(undefined)).toBeUndefined();
  });
});

describe('voice error messages', () => {
  it('explains microphone failures', () => {
    expect(microphoneErrorMessage(new DOMException('no', 'NotAllowedError'))).toBe(
      VOICE_DENIED_MESSAGE,
    );
    expect(microphoneErrorMessage(new DOMException('no', 'SecurityError'))).toBe(
      VOICE_DENIED_MESSAGE,
    );
    expect(microphoneErrorMessage(new DOMException('no', 'NotFoundError'))).toBe(
      VOICE_NO_MICROPHONE_MESSAGE,
    );
    expect(microphoneErrorMessage(new DOMException('no', 'NotReadableError'))).toBe(
      VOICE_MICROPHONE_BUSY_MESSAGE,
    );
    expect(microphoneErrorMessage(new Error('boom'))).toBe(VOICE_RECORDING_FAILED_MESSAGE);
    expect(microphoneErrorMessage(null)).toBe(VOICE_RECORDING_FAILED_MESSAGE);
  });

  it('explains transcription failures with the shared HTTP helpers', () => {
    expect(transcribeErrorMessage(httpError(0))).toBe(VOICE_OFFLINE_MESSAGE);
    expect(transcribeErrorMessage(httpError(413))).toBe(VOICE_TOO_LARGE_MESSAGE);
    expect(transcribeErrorMessage(httpError(429, 'Your monthly AI budget is used up'))).toBe(
      'Your monthly AI budget is used up.',
    );
    expect(transcribeErrorMessage(httpError(429, 'ThrottlerException: Too Many Requests'))).toBe(
      RATE_LIMIT_MESSAGE,
    );
    expect(
      transcribeErrorMessage(httpError(503, 'AI is not configured — set OPENAI_API_KEY')),
    ).toBe(VOICE_NOT_CONFIGURED_MESSAGE);
    expect(
      transcribeErrorMessage(httpError(502, 'Could not reach OpenAI — please try again')),
    ).toBe('Could not reach OpenAI — please try again.');
    expect(transcribeErrorMessage(httpError(500))).toBe(VOICE_TRANSCRIBE_FAILED_MESSAGE);
  });
});

describe('VoiceRecorderService', () => {
  const transcribe = vi.fn<(audio: Blob) => Promise<TranscribeResponse>>();
  const online = signal(true);
  let media: FakeMedia;

  function create(): VoiceRecorderService {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { transcribe } },
        { provide: NetworkService, useValue: { online } },
      ],
    });
    return TestBed.inject(VoiceRecorderService);
  }

  async function record(recorder: VoiceRecorderService, ms = 3000): Promise<void> {
    await recorder.start();
    await vi.advanceTimersByTimeAsync(ms);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    transcribe.mockReset();
    transcribe.mockResolvedValue({ text: '2 eggs and toast' });
    online.set(true);
    media = installFakeMedia(document.defaultView!);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    media.restore();
    vi.useRealTimers();
  });

  it('is unsupported without MediaRecorder or getUserMedia and then never starts', async () => {
    media.restore();
    media = installFakeMedia(document.defaultView!, { recorder: false });
    const withoutRecorder = create();
    expect(withoutRecorder.supported).toBe(false);
    await expect(withoutRecorder.start()).resolves.toBe(false);
    expect(media.constraints).toEqual([]);

    TestBed.resetTestingModule();
    media.restore();
    media = installFakeMedia(document.defaultView!, { devices: false });
    expect(create().supported).toBe(false);
  });

  it('asks for audio only and records with the preferred type', async () => {
    const recorder = create();
    expect(recorder.supported).toBe(true);
    expect(recorder.state()).toBe('idle');

    const started = recorder.start();
    expect(recorder.state()).toBe('starting');
    await expect(started).resolves.toBe(true);

    expect(media.constraints).toEqual([{ audio: true }]);
    expect(recorder.state()).toBe('recording');
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0]?.options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(FakeMediaRecorder.instances[0]?.state).toBe('recording');
  });

  it('falls back to MP4 and to the browser default type', async () => {
    FakeMediaRecorder.supportedTypes = ['audio/mp4'];
    const recorder = create();
    await recorder.start();
    expect(FakeMediaRecorder.instances[0]?.options).toEqual({ mimeType: 'audio/mp4' });
    recorder.cancel();

    FakeMediaRecorder.supportedTypes = [];
    await recorder.start();
    expect(FakeMediaRecorder.instances[1]?.options).toBeUndefined();
  });

  it('counts elapsed seconds while recording', async () => {
    const recorder = create();
    await recorder.start();
    expect(recorder.seconds()).toBe(0);

    await vi.advanceTimersByTimeAsync(7400);

    expect(recorder.seconds()).toBe(7);
  });

  it('uploads the recording on stop, returns the trimmed text and releases the microphone', async () => {
    transcribe.mockResolvedValue({ text: '  2 eggs and toast \n' });
    const recorder = create();
    await record(recorder);

    const stopping = recorder.stop();
    expect(recorder.state()).toBe('transcribing');
    await expect(stopping).resolves.toBe('2 eggs and toast');

    expect(transcribe).toHaveBeenCalledTimes(1);
    const audio = transcribe.mock.calls[0]?.[0] as Blob;
    expect(audio.type).toBe('audio/webm;codecs=opus');
    expect(audio.size).toBeGreaterThan(0);
    expect(media.streams[0]?.released).toBe(true);
    expect(recorder.state()).toBe('idle');
    expect(recorder.seconds()).toBe(0);
    expect(recorder.error()).toBeNull();
  });

  it('answers repeated stops with the same result and one upload', async () => {
    const recorder = create();
    await record(recorder);

    const [first, second] = await Promise.all([recorder.stop(), recorder.stop()]);

    expect(first).toBe('2 eggs and toast');
    expect(second).toBe('2 eggs and toast');
    expect(transcribe).toHaveBeenCalledTimes(1);
    await expect(recorder.stop()).resolves.toBeNull();
  });

  it('reports an empty transcript without returning text', async () => {
    transcribe.mockResolvedValue({ text: '   ' });
    const recorder = create();
    await record(recorder);

    await expect(recorder.stop()).resolves.toBeNull();

    expect(recorder.error()).toBe(VOICE_EMPTY_MESSAGE);
    expect(recorder.state()).toBe('idle');
  });

  it('does not upload a recording that is too short or empty', async () => {
    const recorder = create();
    await record(recorder, VOICE_MIN_RECORDING_MS - 100);
    await expect(recorder.stop()).resolves.toBeNull();
    expect(recorder.error()).toBe(VOICE_EMPTY_MESSAGE);

    FakeMediaRecorder.recording = new Blob([], { type: 'audio/webm' });
    await record(recorder);
    await expect(recorder.stop()).resolves.toBeNull();

    expect(transcribe).not.toHaveBeenCalled();
    expect(media.streams.every((stream) => stream.released)).toBe(true);
  });

  it('explains a blocked microphone and stays idle', async () => {
    media.rejectWith(new DOMException('denied', 'NotAllowedError'));
    const recorder = create();

    await expect(recorder.start()).resolves.toBe(false);

    expect(recorder.error()).toBe(VOICE_DENIED_MESSAGE);
    expect(recorder.state()).toBe('idle');
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('releases the microphone when the recorder cannot start', async () => {
    FakeMediaRecorder.failOnStart = true;
    const recorder = create();

    await expect(recorder.start()).resolves.toBe(false);

    expect(recorder.error()).toBe(VOICE_RECORDING_FAILED_MESSAGE);
    expect(media.streams[0]?.released).toBe(true);
    expect(recorder.state()).toBe('idle');
  });

  it('does not touch the microphone while offline', async () => {
    online.set(false);
    const recorder = create();

    await expect(recorder.start()).resolves.toBe(false);

    expect(recorder.error()).toBe(VOICE_OFFLINE_MESSAGE);
    expect(media.constraints).toEqual([]);
  });

  it('reports going offline before the upload', async () => {
    const recorder = create();
    await record(recorder);
    online.set(false);

    await expect(recorder.stop()).resolves.toBeNull();

    expect(recorder.error()).toBe(VOICE_OFFLINE_MESSAGE);
    expect(transcribe).not.toHaveBeenCalled();
    expect(media.streams[0]?.released).toBe(true);
  });

  it.each([
    [httpError(429, 'Your monthly AI budget is used up'), 'Your monthly AI budget is used up.'],
    [httpError(429, 'ThrottlerException: Too Many Requests'), RATE_LIMIT_MESSAGE],
    [httpError(503, 'AI is not configured — set OPENAI_API_KEY'), VOICE_NOT_CONFIGURED_MESSAGE],
    [httpError(0), VOICE_OFFLINE_MESSAGE],
  ])('shows a friendly message when transcription fails (%#)', async (failure, message) => {
    transcribe.mockRejectedValue(failure);
    const recorder = create();
    await record(recorder);

    await expect(recorder.stop()).resolves.toBeNull();

    expect(recorder.error()).toBe(message);
    expect(recorder.state()).toBe('idle');
    expect(media.streams[0]?.released).toBe(true);
  });

  it('keeps a recording that could not be sent and sends it again on request', async () => {
    transcribe.mockRejectedValueOnce(httpError(502, 'Could not reach OpenAI — please try again'));
    const recorder = create();
    await record(recorder);

    await expect(recorder.stop()).resolves.toBeNull();
    expect(recorder.canResend()).toBe(true);
    const [first] = transcribe.mock.calls[0]!;

    const again = recorder.resend();
    expect(recorder.state()).toBe('transcribing');
    expect(recorder.error()).toBeNull();
    await expect(again).resolves.toBe('2 eggs and toast');

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[1]![0]).toBe(first);
    expect(recorder.canResend()).toBe(false);
    expect(recorder.state()).toBe('idle');
    await expect(recorder.resend()).resolves.toBeNull();
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('keeps the recording when the connection drops before or during the upload', async () => {
    const recorder = create();
    await record(recorder);
    online.set(false);
    await recorder.stop();
    expect(recorder.canResend()).toBe(true);
    expect(transcribe).not.toHaveBeenCalled();

    await expect(recorder.resend()).resolves.toBeNull();
    expect(recorder.error()).toBe(VOICE_OFFLINE_MESSAGE);
    expect(recorder.canResend()).toBe(true);

    online.set(true);
    await expect(recorder.resend()).resolves.toBe('2 eggs and toast');
  });

  it('does not offer to resend what the server will never accept', async () => {
    transcribe.mockRejectedValueOnce(httpError(413));
    const recorder = create();
    await record(recorder);
    await recorder.stop();

    expect(recorder.error()).toBe(VOICE_TOO_LARGE_MESSAGE);
    expect(recorder.canResend()).toBe(false);
    expect(canResendRecording(httpError(400))).toBe(false);
    expect(canResendRecording(httpError(429))).toBe(true);
    expect(canResendRecording(httpError(0))).toBe(true);
    expect(canResendRecording(new Error('boom'))).toBe(true);
  });

  it('forgets a kept recording when a new one starts or it is cancelled', async () => {
    transcribe.mockRejectedValue(httpError(502));
    const recorder = create();
    await record(recorder);
    await recorder.stop();
    expect(recorder.canResend()).toBe(true);

    await recorder.start();
    expect(recorder.canResend()).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    await recorder.stop();
    expect(recorder.canResend()).toBe(true);

    recorder.cancel();
    expect(recorder.canResend()).toBe(false);
    await expect(recorder.resend()).resolves.toBeNull();
  });

  it('clears the previous error when recording starts again', async () => {
    transcribe.mockResolvedValueOnce({ text: '' });
    const recorder = create();
    await record(recorder);
    await recorder.stop();
    expect(recorder.error()).toBe(VOICE_EMPTY_MESSAGE);

    await recorder.start();

    expect(recorder.error()).toBeNull();
    expect(recorder.state()).toBe('recording');
  });

  it('cancels without uploading and releases the microphone', async () => {
    const recorder = create();
    await record(recorder);

    recorder.cancel();
    await vi.advanceTimersByTimeAsync(10);

    expect(recorder.state()).toBe('idle');
    expect(recorder.seconds()).toBe(0);
    expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
    expect(media.streams[0]?.released).toBe(true);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('releases a microphone that is granted after cancelling', async () => {
    const grant = media.holdPermission();
    const recorder = create();
    const started = recorder.start();

    recorder.cancel();
    grant();

    await expect(started).resolves.toBe(false);
    expect(recorder.state()).toBe('idle');
    expect(media.streams[0]?.released).toBe(true);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('drops the transcript of a recording cancelled during the upload', async () => {
    let finish: (value: TranscribeResponse) => void = () => undefined;
    transcribe.mockReturnValue(
      new Promise<TranscribeResponse>((resolve) => {
        finish = resolve;
      }),
    );
    const recorder = create();
    await record(recorder);
    const stopping = recorder.stop();
    await vi.advanceTimersByTimeAsync(10);

    recorder.cancel();
    finish({ text: 'late text' });

    await expect(stopping).resolves.toBeNull();
    expect(recorder.state()).toBe('idle');
    expect(recorder.error()).toBeNull();
  });

  it('stops by itself at the time limit and hands the text to the caller', async () => {
    const recorder = create();
    const autoStopped = vi.fn<(text: string | null) => void>();
    await recorder.start(autoStopped);

    await vi.advanceTimersByTimeAsync((API_LIMITS.voiceMaxSeconds - 1) * 1000);
    expect(recorder.state()).toBe('recording');
    expect(recorder.seconds()).toBe(API_LIMITS.voiceMaxSeconds - 1);

    await vi.advanceTimersByTimeAsync(1500);

    expect(autoStopped).toHaveBeenCalledExactlyOnceWith('2 eggs and toast');
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(recorder.state()).toBe('idle');
    expect(media.streams[0]?.released).toBe(true);
  });

  it('transcribes what it has when the microphone is taken away', async () => {
    const recorder = create();
    const autoStopped = vi.fn<(text: string | null) => void>();
    await recorder.start(autoStopped);
    await vi.advanceTimersByTimeAsync(2000);

    media.streams[0]?.tracks[0]?.end();
    await vi.advanceTimersByTimeAsync(10);

    expect(autoStopped).toHaveBeenCalledExactlyOnceWith('2 eggs and toast');
    expect(recorder.state()).toBe('idle');
  });

  it('reports a recorder error and releases the microphone', async () => {
    const recorder = create();
    await record(recorder);

    FakeMediaRecorder.instances[0]?.fail();

    expect(recorder.error()).toBe(VOICE_RECORDING_FAILED_MESSAGE);
    expect(recorder.state()).toBe('idle');
    expect(media.streams[0]?.released).toBe(true);
  });

  it('releases the microphone when it is destroyed mid-recording', async () => {
    const recorder = create();
    await record(recorder);

    TestBed.resetTestingModule();

    expect(media.streams[0]?.released).toBe(true);
    expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
    expect(transcribe).not.toHaveBeenCalled();
  });
});
