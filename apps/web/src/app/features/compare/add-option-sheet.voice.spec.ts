import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TranscribeResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { NetworkService } from '../../core/network.service';
import { installFakeMedia, type FakeMedia } from '../../core/testing/fake-media';
import { installDialogShim } from '../log/testing/dialog-shim';
import { AddOptionSheet } from './add-option-sheet';
import { CompareStore } from './compare.store';

describe('AddOptionSheet voice dictation', () => {
  const transcribe = vi.fn<(audio: Blob) => Promise<TranscribeResponse>>();
  const describeOption = vi.fn<(text: string) => boolean>();
  const online = signal(true);
  let media: FakeMedia;
  let restoreDialog: () => void;
  let fixture: ComponentFixture<AddOptionSheet>;
  let el: HTMLElement;

  const mic = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('button[aria-label="Describe by voice"]');
  const stopButton = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-voice-stop]');
  const textarea = (): HTMLTextAreaElement =>
    el.querySelector<HTMLTextAreaElement>('#compare-describe')!;
  const submit = (): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  }

  async function openDescribe(): Promise<void> {
    fixture = TestBed.createComponent(AddOptionSheet);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    fixture.componentInstance.show('describe');
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    restoreDialog = installDialogShim();
    transcribe.mockReset();
    transcribe.mockResolvedValue({ text: 'a large chicken shawarma wrap' });
    describeOption.mockReset();
    describeOption.mockReturnValue(true);
    online.set(true);
    media = installFakeMedia(document.defaultView!);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { transcribe, searchFoods: vi.fn() } },
        { provide: NetworkService, useValue: { online } },
        {
          provide: CompareStore,
          useValue: {
            freeSlots: signal(3),
            menu: signal({ status: 'idle' }),
            lastMenu: signal(null),
            options: signal([]),
            budget: signal(null),
            describe: describeOption,
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    media.restore();
    restoreDialog();
    vi.useRealTimers();
  });

  it('appends the transcript to the description and estimates it', async () => {
    await openDescribe();
    expect(textarea().nextElementSibling).toBe(el.querySelector('app-voice-button'));
    textarea().value = 'For dinner:';
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    mic()!.click();
    await settle(2000);
    expect(submit().disabled).toBe(true);
    stopButton()!.click();
    await settle(10);

    expect(textarea().value).toBe('For dinner:\na large chicken shawarma wrap');
    expect(submit().disabled).toBe(false);

    submit().click();
    await settle();

    expect(describeOption).toHaveBeenCalledWith('For dinner:\na large chicken shawarma wrap');
  });

  it('stops listening when the sheet is closed', async () => {
    await openDescribe();
    mic()!.click();
    await settle(1500);
    expect(stopButton()).not.toBeNull();

    fixture.componentInstance.close();
    await settle(10);

    expect(media.streams[0]?.released).toBe(true);
    expect(transcribe).not.toHaveBeenCalled();
    expect(stopButton()).toBeNull();
  });
});
