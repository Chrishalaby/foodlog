import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TranscribeResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { NetworkService } from '../../core/network.service';
import { FakeMediaRecorder, installFakeMedia, type FakeMedia } from '../../core/testing/fake-media';
import { VOICE_DENIED_MESSAGE, VOICE_EMPTY_MESSAGE } from '../../core/voice-recorder.service';
import { VoiceButton } from './voice-button';

@Component({
  imports: [VoiceButton],
  template: `
    @if (shown()) {
      <app-voice-button [disabled]="disabled()" (transcribed)="texts.push($event)" />
    }
  `,
})
class Host {
  readonly shown = signal(true);
  readonly disabled = signal(false);
  readonly texts: string[] = [];
}

describe('VoiceButton', () => {
  const transcribe = vi.fn<(audio: Blob) => Promise<TranscribeResponse>>();
  const online = signal(true);
  let media: FakeMedia;
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  const button = (label: string): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const mic = (): HTMLButtonElement | null => button('Describe by voice');
  const stopButton = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-voice-stop]');
  const text = (): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  function render(): void {
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { transcribe } },
        { provide: NetworkService, useValue: { online } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    fixture.detectChanges();
  }

  async function startRecording(): Promise<void> {
    mic()!.click();
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    transcribe.mockReset();
    transcribe.mockResolvedValue({ text: '2 eggs and toast' });
    online.set(true);
    media = installFakeMedia(document.defaultView!);
  });

  afterEach(() => {
    el?.remove();
    TestBed.resetTestingModule();
    media.restore();
    vi.useRealTimers();
  });

  it('renders nothing when recording is not supported', () => {
    media.restore();
    media = installFakeMedia(document.defaultView!, { recorder: false });
    render();

    expect(el.querySelector('button')).toBeNull();
    expect(el.querySelector('app-voice-button')?.classList.contains('hidden')).toBe(true);
  });

  it('shows a 44 px microphone button while idle', () => {
    render();

    expect(mic()).not.toBeNull();
    expect(mic()!.classList.contains('btn-icon')).toBe(true);
    expect(mic()!.type).toBe('button');
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the timer with stop and cancel while recording', async () => {
    render();
    await startRecording();

    expect(mic()).toBeNull();
    expect(stopButton()?.textContent).toContain('Stop');
    expect(button('Cancel recording')).not.toBeNull();
    expect(el.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Voice recording');
    expect(text()).toContain('0:00');

    await settle(65_000);

    expect(text()).toContain('1:05');
    expect(text()).not.toContain('Stops at');
  });

  it('warns shortly before the time limit', async () => {
    render();
    await startRecording();

    await settle(166_000);

    expect(text()).toContain('Stops at 3:00.');
  });

  it('transcribes on stop and emits the text', async () => {
    let finish: (value: TranscribeResponse) => void = () => undefined;
    transcribe.mockReturnValue(
      new Promise<TranscribeResponse>((resolve) => {
        finish = resolve;
      }),
    );
    render();
    await startRecording();
    await settle(3000);

    stopButton()!.click();
    await settle(10);

    expect(text()).toContain('Transcribing…');
    expect(el.querySelector('app-spinner')?.getAttribute('aria-label')).toBe('Transcribing');
    expect(stopButton()).toBeNull();

    finish({ text: ' For lunch 2 manakish ' });
    await settle(10);

    expect(fixture.componentInstance.texts).toEqual(['For lunch 2 manakish']);
    expect(mic()).not.toBeNull();
    expect(media.streams[0]?.released).toBe(true);
  });

  it('emits the text when the recording stops by itself at the limit', async () => {
    render();
    await startRecording();

    await settle(181_000);

    expect(fixture.componentInstance.texts).toEqual(['2 eggs and toast']);
    expect(mic()).not.toBeNull();
  });

  it('cancels without transcribing', async () => {
    render();
    await startRecording();
    await settle(2000);

    button('Cancel recording')!.click();
    await settle(10);

    expect(mic()).not.toBeNull();
    expect(transcribe).not.toHaveBeenCalled();
    expect(fixture.componentInstance.texts).toEqual([]);
    expect(media.streams[0]?.released).toBe(true);
  });

  it('shows errors inline as an alert and clears them on the next try', async () => {
    media.rejectWith(new DOMException('denied', 'NotAllowedError'));
    render();
    await startRecording();

    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(VOICE_DENIED_MESSAGE);
    expect(mic()).not.toBeNull();

    media.rejectWith(null);
    await startRecording();

    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(stopButton()).not.toBeNull();
  });

  it('offers to send the recording again when transcription fails', async () => {
    transcribe.mockRejectedValueOnce(new HttpErrorResponse({ status: 502 }));
    render();
    await startRecording();
    await settle(2000);
    stopButton()!.click();
    await settle(10);

    const resend = el.querySelector<HTMLButtonElement>('[data-voice-resend]');
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(resend?.textContent).toContain('Send recording again');

    resend!.click();
    await settle(10);

    expect(fixture.componentInstance.texts).toEqual(['2 eggs and toast']);
    expect(el.querySelector('[data-voice-resend]')).toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('says so when nothing was heard', async () => {
    transcribe.mockResolvedValue({ text: '' });
    render();
    await startRecording();
    await settle(2000);

    stopButton()!.click();
    await settle(10);

    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(VOICE_EMPTY_MESSAGE);
    expect(fixture.componentInstance.texts).toEqual([]);
  });

  it('does not start while disabled', async () => {
    render();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(mic()!.disabled).toBe(true);
    mic()!.click();
    await settle();

    expect(media.constraints).toEqual([]);
  });

  it('keeps keyboard focus on the main control as the state changes', async () => {
    render();
    mic()!.focus();
    await startRecording();

    expect(document.activeElement).toBe(stopButton());

    stopButton()!.click();
    await settle(10);

    expect(document.activeElement).toBe(mic());
  });

  it('releases the microphone when it is removed mid-recording', async () => {
    render();
    await startRecording();
    await settle(1000);

    fixture.componentInstance.shown.set(false);
    await settle();

    expect(media.streams[0]?.released).toBe(true);
    expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive');
    expect(transcribe).not.toHaveBeenCalled();
  });
});
