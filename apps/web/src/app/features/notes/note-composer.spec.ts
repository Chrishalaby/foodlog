import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TranscribeResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { IMAGE_UNSUPPORTED_MESSAGE } from '../../core/errors';
import { NetworkService } from '../../core/network.service';
import { installFakeMedia, type FakeMedia } from '../../core/testing/fake-media';
import { ToastService } from '../../core/toast.service';
import { ImageDecodeError } from '../../shared/utils/image-compress';
import {
  NOTE_COUNTER_FROM,
  NOTE_PHOTO_COMPRESSOR,
  NoteComposer,
  type NotePhotoCompressor,
  type NoteSubmission,
} from './note-composer';
import { NOTE_TEXT_MAX } from './notes-model';

@Component({
  imports: [NoteComposer],
  template: `<app-note-composer [(text)]="text" (submitted)="sent.push($event)" />`,
})
class Host {
  readonly text = signal('');
  readonly sent: NoteSubmission[] = [];
}

describe('NoteComposer', () => {
  const transcribe = vi.fn<(audio: Blob) => Promise<TranscribeResponse>>();
  const compress = vi.fn<NotePhotoCompressor>();
  const online = signal(true);
  let media: FakeMedia;
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  const field = (): HTMLTextAreaElement => el.querySelector<HTMLTextAreaElement>('textarea')!;
  const sendButton = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('[data-send]')!;
  const mic = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('button[aria-label="Describe by voice"]');
  const stopButton = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-voice-stop]');
  const toasts = (): string[] =>
    TestBed.inject(ToastService)
      .toasts()
      .map((toast) => toast.message);

  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  function type(value: string): void {
    field().value = value;
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function render(): void {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    transcribe.mockReset();
    compress.mockReset();
    online.set(true);
    media = installFakeMedia(document.defaultView!);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { transcribe } },
        { provide: NetworkService, useValue: { online } },
        { provide: NOTE_PHOTO_COMPRESSOR, useValue: compress },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    TestBed.resetTestingModule();
    media.restore();
    vi.useRealTimers();
  });

  it('is a labelled, auto-growing text box limited to the note length', () => {
    render();
    expect(field().getAttribute('maxlength')).toBe(String(NOTE_TEXT_MAX));
    expect(field().rows).toBe(1);
    expect(el.querySelector(`label[for="${field().id}"]`)?.textContent).toContain('New note');
    expect(el.querySelector('[data-toast-clearance]')).not.toBeNull();
    expect(sendButton().disabled).toBe(true);
  });

  it('sends trimmed text, clears itself and ignores blank text', () => {
    render();
    type('   ');
    expect(sendButton().disabled).toBe(true);
    type('  Buy mirror\n');
    expect(host.text()).toBe('  Buy mirror\n');
    sendButton().click();
    fixture.detectChanges();
    expect(host.sent).toEqual([{ text: 'Buy mirror', attachments: [] }]);
    expect(host.text()).toBe('');
    expect(field().value).toBe('');
  });

  it('keeps the keyboard up by not letting Send take the focus', () => {
    render();
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    sendButton().dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it('sends with Ctrl or Cmd + Enter and leaves a plain Enter for new lines', () => {
    render();
    type('Dehumidifier');
    const plain = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    field().dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(host.sent).toHaveLength(0);
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
    expect(host.sent).toHaveLength(1);
  });

  it('shows what is left only near the limit', () => {
    render();
    type('a'.repeat(NOTE_TEXT_MAX - NOTE_COUNTER_FROM - 1));
    expect(el.textContent).not.toContain('left');
    type('a'.repeat(NOTE_TEXT_MAX - 5));
    expect(el.textContent).toContain('5 left');
  });

  it('shows text set from outside, such as a restored draft or a share', () => {
    render();
    host.text.set('Shared link\nhttps://maps.test/p');
    fixture.detectChanges();
    expect(field().value).toBe('Shared link\nhttps://maps.test/p');
    expect(sendButton().disabled).toBe(false);
  });

  it('appends dictated text and holds Send while the voice note is running', async () => {
    render();
    type('Buy mirror.');
    expect(sendButton().disabled).toBe(false);
    transcribe.mockResolvedValueOnce({ text: 'Round, 60 cm' });

    mic()!.click();
    await settle(2000);
    expect(sendButton().disabled).toBe(true);
    expect(el.querySelector('button[aria-label="Take a photo"]')).toBeNull();

    stopButton()!.click();
    await settle(10);
    expect(host.text()).toBe('Buy mirror.\nRound, 60 cm');
    expect(field().value).toBe('Buy mirror.\nRound, 60 cm');
    expect(sendButton().disabled).toBe(false);
    expect(el.querySelector('button[aria-label="Take a photo"]')).not.toBeNull();
  });

  it('holds Send while a photo is being prepared and reports one that cannot be read', async () => {
    let finish!: (image: { blob: Blob; width: number; height: number }) => void;
    compress.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const broken = new File(['x'], 'broken.heic', { type: 'image/heic' });
    compress.mockRejectedValueOnce(new ImageDecodeError(broken, new Error('decode')));
    render();
    type('Caption');
    const input = el.querySelector<HTMLInputElement>('[data-gallery-input]')!;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), broken],
    });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(el.querySelectorAll('[role="status"]')).toHaveLength(2);
    expect(sendButton().disabled).toBe(true);

    finish({ blob: new Blob(['small']), width: 400, height: 300 });
    await settle();
    await settle();
    expect(el.querySelectorAll('li')).toHaveLength(1);
    expect(sendButton().disabled).toBe(false);
    expect(toasts()).toContain(IMAGE_UNSUPPORTED_MESSAGE);

    sendButton().click();
    fixture.detectChanges();
    expect(host.sent[0].text).toBe('Caption');
    expect(host.sent[0].attachments).toHaveLength(1);
    expect(host.sent[0].attachments[0]).toMatchObject({ width: 400, height: 300 });
    expect(el.querySelectorAll('li')).toHaveLength(0);
  });
});
