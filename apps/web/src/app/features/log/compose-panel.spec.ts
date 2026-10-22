import { computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_LIMITS, type TranscribeResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { NetworkService } from '../../core/network.service';
import { FakeMediaRecorder, installFakeMedia, type FakeMedia } from '../../core/testing/fake-media';
import { VoiceIntentService } from '../../core/voice-intent.service';
import { ComposePanel } from './compose-panel';
import { LogStore } from './log.store';

function fakeStore() {
  const description = signal('');
  return {
    description,
    precise: signal(false),
    mode: signal<'text' | 'food_photo' | 'nutrition_label'>('text'),
    attachedDraft: signal(null),
    barcode: signal(null),
    dateTime: signal('2026-10-04T12:30'),
    photos: signal([]),
    remotePhotos: signal([]),
    failedPhotos: signal(new Set<number>()),
    aiConfig: signal(null),
    previewUrl: signal(null),
    photoTime: signal(null),
    error: signal(null),
    draftError: signal(null),
    draftSaving: signal(false),
    canAddPhoto: signal(false),
    canSaveDraft: signal(false),
    canAnalyze: computed(() => description().trim().length > 0),
    analyze: vi.fn(),
  };
}

describe('ComposePanel voice dictation', () => {
  const transcribe = vi.fn<(audio: Blob) => Promise<TranscribeResponse>>();
  const online = signal(true);
  let media: FakeMedia;
  let store: ReturnType<typeof fakeStore>;
  let fixture: ComponentFixture<ComposePanel>;
  let el: HTMLElement;

  const mic = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('button[aria-label="Describe by voice"]');
  const stopButton = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-voice-stop]');
  const textarea = (): HTMLTextAreaElement =>
    el.querySelector<HTMLTextAreaElement>('#compose-description')!;
  const analyzeButton = (): HTMLButtonElement =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Analyze'),
    )!;

  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  function render(): void {
    fixture = TestBed.createComponent(ComposePanel);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  async function dictate(transcript: string): Promise<void> {
    transcribe.mockResolvedValueOnce({ text: transcript });
    mic()!.click();
    await settle(2000);
    stopButton()!.click();
    await settle(10);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    transcribe.mockReset();
    online.set(true);
    media = installFakeMedia(document.defaultView!);
    store = fakeStore();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { transcribe } },
        { provide: NetworkService, useValue: { online } },
        { provide: LogStore, useValue: store },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    media.restore();
    vi.useRealTimers();
  });

  it('offers the microphone right under the description', () => {
    render();

    const voice = el.querySelector('app-voice-button')!;
    expect(mic()).not.toBeNull();
    expect(textarea().nextElementSibling).toBe(voice);
    expect(textarea().hasAttribute('data-autofocus')).toBe(true);
  });

  it('hides the microphone where recording is unsupported', () => {
    media.restore();
    media = installFakeMedia(document.defaultView!, { recorder: false });
    render();

    expect(mic()).toBeNull();
    expect(el.textContent).toContain(`0/${API_LIMITS.descriptionMax}`);
  });

  it('puts the transcript into an empty description', async () => {
    render();

    await dictate('For breakfast 2 eggs');

    expect(store.description()).toBe('For breakfast 2 eggs');
    expect(textarea().value).toBe('For breakfast 2 eggs');
    expect(el.textContent).toContain(`20/${API_LIMITS.descriptionMax}`);
  });

  it('appends after a space, or on a new line after a finished sentence', async () => {
    store.description.set('grilled chicken');
    render();

    await dictate('with 150 g rice.');
    expect(store.description()).toBe('grilled chicken with 150 g rice.');

    await dictate('For lunch a shawarma wrap');
    expect(store.description()).toBe('grilled chicken with 150 g rice.\nFor lunch a shawarma wrap');
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('caps the description at the limit', async () => {
    store.description.set('x'.repeat(API_LIMITS.descriptionMax - 4));
    render();

    await dictate('and a very long story');

    expect(store.description()).toHaveLength(API_LIMITS.descriptionMax);
    expect(store.description().endsWith(' and')).toBe(true);
  });

  it('keeps the quick detail chips working with dictated text', async () => {
    render();
    await dictate('chicken shawarma');

    const chip = Array.from(el.querySelectorAll<HTMLButtonElement>('button.chip')).find((button) =>
      button.textContent?.includes('homemade'),
    )!;
    chip.click();
    fixture.detectChanges();

    expect(store.description()).toContain('chicken shawarma');
    expect(store.description()).toContain('homemade');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
  });

  it('holds Analyze until the voice note is finished', async () => {
    store.description.set('2 eggs');
    render();
    expect(analyzeButton().disabled).toBe(false);

    mic()!.click();
    await settle(1000);

    expect(analyzeButton().disabled).toBe(true);
    expect(el.textContent).toContain('Finish the voice note to continue.');

    el.querySelector<HTMLButtonElement>('button[aria-label="Cancel recording"]')!.click();
    await settle(10);

    expect(analyzeButton().disabled).toBe(false);
    expect(store.description()).toBe('2 eggs');
  });

  it('starts recording straight away when opened from the Speak tile', async () => {
    TestBed.inject(VoiceIntentService).request();
    render();
    await settle();

    expect(media.constraints).toEqual([{ audio: true }]);
    expect(stopButton()).not.toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(textarea().hasAttribute('data-autofocus')).toBe(false);
    expect(el.querySelector('h1')?.hasAttribute('data-autofocus')).toBe(true);
    expect(TestBed.inject(VoiceIntentService).take()).toBe(false);
  });

  it('does not record by itself when opened from Describe', async () => {
    render();
    await settle();

    expect(media.constraints).toEqual([]);
    expect(mic()).not.toBeNull();
  });
});
