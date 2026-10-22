import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { KEYBOARD_PRIMER_ATTRIBUTE } from '../../core/keyboard-primer';
import { installFakeMedia, type FakeMedia } from '../../core/testing/fake-media';
import { VoiceIntentService } from '../../core/voice-intent.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { CaptureHome } from './capture-home';
import { FoodSearchStore } from './food-search.store';
import { LibraryActions } from './library-actions';
import { installDialogShim } from './testing/dialog-shim';

describe('CaptureHome Speak tile', () => {
  let media: FakeMedia | null = null;
  let restoreDialog: () => void;

  const tiles = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('button.capture-tile')).map(
      (button) => button.textContent?.trim() ?? '',
    );

  async function render(): Promise<{ fixture: ComponentFixture<CaptureHome>; el: HTMLElement }> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        FoodSearchStore,
        LibraryActions,
        {
          provide: ApiService,
          useValue: {
            searchFoods: vi.fn(async () => ({ query: '', results: [] })),
            listDrafts: vi.fn(async () => []),
            listProducts: vi.fn(async () => []),
          },
        },
        { provide: ConfirmService, useValue: { confirm: vi.fn() } },
      ],
    });
    const fixture = TestBed.createComponent(CaptureHome);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    restoreDialog = installDialogShim();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    media?.restore();
    media = null;
    restoreDialog();
  });

  it('adds Speak next to Describe when the device can record', async () => {
    media = installFakeMedia(document.defaultView!);
    const { el } = await render();

    expect(tiles(el)).toEqual(['Scan label', 'Describe', 'Speak', 'Manual']);
  });

  it('keeps the three tiles where recording is unsupported', async () => {
    const { el } = await render();

    expect(tiles(el)).toEqual(['Scan label', 'Describe', 'Manual']);
  });

  it('opens the describe screen with a voice request and no keyboard', async () => {
    media = installFakeMedia(document.defaultView!);
    const { fixture, el } = await render();
    const describe = vi.fn();
    fixture.componentInstance.describe.subscribe(describe);
    const speak = Array.from(el.querySelectorAll<HTMLButtonElement>('button.capture-tile')).find(
      (button) => button.textContent?.includes('Speak'),
    )!;

    speak.click();

    expect(describe).toHaveBeenCalledExactlyOnceWith('');
    expect(document.activeElement?.hasAttribute(KEYBOARD_PRIMER_ATTRIBUTE) ?? false).toBe(false);
    expect(media.constraints).toEqual([]);
    expect(TestBed.inject(VoiceIntentService).take()).toBe(true);
  });

  it('leaves no voice request behind when Describe is tapped', async () => {
    media = installFakeMedia(document.defaultView!);
    const { el } = await render();
    const describe = Array.from(el.querySelectorAll<HTMLButtonElement>('button.capture-tile')).find(
      (button) => button.textContent?.includes('Describe'),
    )!;

    describe.click();

    expect(TestBed.inject(VoiceIntentService).take()).toBe(false);
  });
});
