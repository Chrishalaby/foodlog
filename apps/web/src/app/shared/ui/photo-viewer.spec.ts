import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { installDialogShim } from '../testing/dialog-shim';
import type { ViewerPhoto } from '../utils/entry-photos';
import { PhotoViewer, SWIPE_MIN_PX } from './photo-viewer';

const PHOTOS: ViewerPhoto[] = [
  { id: 'p1', url: '/api/photos/p1', alt: 'Food photo of Labneh', caption: 'Food' },
  { id: 'p2', url: '/api/photos/p2', alt: 'Label photo of Labneh', caption: 'Label' },
  { id: 'p3', url: '/api/photos/p3', alt: 'Food photo of Labneh', caption: 'Food' },
];

@Component({
  imports: [PhotoViewer],
  template: `
    <app-photo-viewer
      [photos]="photos()"
      [(index)]="index"
      [(open)]="open"
      [coverId]="coverId()"
      [coverBusy]="busy()"
      [coverError]="error()"
      (coverPicked)="picked.push($event)"
    />
  `,
})
class Host {
  readonly photos = signal<ViewerPhoto[]>(PHOTOS);
  readonly index = signal(0);
  readonly open = signal(true);
  readonly coverId = signal<string | null>('p1');
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly picked: string[] = [];
}

interface Point {
  x: number;
  y: number;
}

function touch(target: Element, type: string, touches: Point[], changed: Point[] = []): void {
  const toTouch = ({ x, y }: Point) => ({ clientX: x, clientY: y });
  target.dispatchEvent(
    Object.assign(new Event(type, { bubbles: true }), {
      touches: touches.map(toTouch),
      changedTouches: changed.map(toTouch),
    }),
  );
}

function swipe(target: Element, from: Point, to: Point): void {
  touch(target, 'touchstart', [from], [from]);
  touch(target, 'touchend', [], [to]);
}

describe('PhotoViewer', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
  });

  afterEach(() => {
    restoreDialog();
    vi.unstubAllGlobals();
  });

  async function render(
    setup: (host: Host) => void = () => undefined,
  ): Promise<{ fixture: ComponentFixture<Host>; host: Host; el: HTMLElement }> {
    const fixture = TestBed.createComponent(Host);
    setup(fixture.componentInstance);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const dialog = (el: HTMLElement): HTMLDialogElement => el.querySelector('dialog')!;
  const image = (el: HTMLElement): HTMLImageElement => el.querySelector('dialog img')!;
  const button = (el: HTMLElement, label: string): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const textButton = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
    Array.from(el.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.includes(text),
    );

  it('opens on the requested photo with its alt text, position and role', async () => {
    const { el } = await render((host) => host.index.set(1));
    expect(dialog(el).hasAttribute('open')).toBe(true);
    expect(image(el).getAttribute('src')).toBe('/api/photos/p2');
    expect(image(el).getAttribute('alt')).toBe('Label photo of Labneh');
    expect(dialog(el).getAttribute('aria-label')).toBe('Label photo of Labneh, 2 of 3');
    expect(el.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe('2 / 3 · Label');
  });

  it('steps between photos with the arrows without closing', async () => {
    const { fixture, host, el } = await render();
    expect(button(el, 'Previous photo').disabled).toBe(true);

    button(el, 'Next photo').click();
    await fixture.whenStable();
    expect(host.index()).toBe(1);
    expect(host.open()).toBe(true);
    expect(image(el).getAttribute('src')).toBe('/api/photos/p2');

    button(el, 'Next photo').click();
    await fixture.whenStable();
    expect(button(el, 'Next photo').disabled).toBe(true);
    button(el, 'Previous photo').click();
    await fixture.whenStable();
    expect(host.index()).toBe(1);
  });

  it('follows the arrow keys and stops at the ends', async () => {
    const { fixture, host, el } = await render();
    const press = async (key: string) => {
      dialog(el).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await fixture.whenStable();
    };
    await press('ArrowLeft');
    expect(host.index()).toBe(0);
    await press('ArrowRight');
    await press('ArrowRight');
    await press('ArrowRight');
    expect(host.index()).toBe(2);
    await press('ArrowLeft');
    expect(host.index()).toBe(1);
  });

  it('swipes to the next and previous photo', async () => {
    const { fixture, host, el } = await render();
    swipe(dialog(el), { x: 300, y: 400 }, { x: 300 - SWIPE_MIN_PX - 10, y: 410 });
    await fixture.whenStable();
    expect(host.index()).toBe(1);
    expect(host.open()).toBe(true);

    swipe(dialog(el), { x: 100, y: 400 }, { x: 100 + SWIPE_MIN_PX + 10, y: 395 });
    await fixture.whenStable();
    expect(host.index()).toBe(0);
  });

  it('ignores short or vertical drags', async () => {
    const { fixture, host, el } = await render();
    swipe(dialog(el), { x: 300, y: 400 }, { x: 300 - SWIPE_MIN_PX + 8, y: 400 });
    swipe(dialog(el), { x: 300, y: 200 }, { x: 240, y: 420 });
    await fixture.whenStable();
    expect(host.index()).toBe(0);
  });

  it('leaves pinch-zoom gestures and zoomed-in pans alone', async () => {
    const { fixture, host, el } = await render();
    const target = dialog(el);
    touch(target, 'touchstart', [{ x: 300, y: 400 }]);
    touch(target, 'touchstart', [
      { x: 300, y: 400 },
      { x: 200, y: 400 },
    ]);
    touch(target, 'touchend', [{ x: 100, y: 400 }], [{ x: 380, y: 400 }]);
    touch(target, 'touchend', [], [{ x: 100, y: 400 }]);
    await fixture.whenStable();
    expect(host.index()).toBe(0);

    vi.stubGlobal('visualViewport', { scale: 2.5 });
    swipe(target, { x: 300, y: 400 }, { x: 100, y: 400 });
    await fixture.whenStable();
    expect(host.index()).toBe(0);

    vi.stubGlobal('visualViewport', { scale: 1 });
    touch(target, 'touchstart', [{ x: 300, y: 400 }]);
    touch(target, 'touchcancel', []);
    touch(target, 'touchend', [], [{ x: 100, y: 400 }]);
    await fixture.whenStable();
    expect(host.index()).toBe(0);
  });

  it('offers to make another photo the cover and marks the current cover', async () => {
    const { fixture, host, el } = await render();
    const cover = textButton(el, 'Cover photo')!;
    expect(cover.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe(
      '1 / 3 · Food · Cover',
    );
    cover.click();
    expect(host.picked).toEqual([]);
    expect(host.open()).toBe(true);

    host.index.set(1);
    await fixture.whenStable();
    const pick = textButton(el, 'Set as cover')!;
    expect(pick.hasAttribute('aria-disabled')).toBe(false);
    pick.click();
    expect(host.picked).toEqual(['p2']);
    expect(host.open()).toBe(true);
  });

  it('shows progress and errors from changing the cover', async () => {
    const { fixture, host, el } = await render((current) => {
      current.index.set(2);
      current.busy.set(true);
    });
    const pick = textButton(el, 'Set as cover')!;
    expect(pick.getAttribute('aria-busy')).toBe('true');
    expect(pick.getAttribute('aria-disabled')).toBe('true');
    pick.click();
    expect(host.picked).toEqual([]);

    host.busy.set(false);
    host.error.set("Couldn't change the cover photo.");
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      "Couldn't change the cover photo.",
    );
  });

  it('keeps a single photo simple', async () => {
    const { el } = await render((host) => host.photos.set([PHOTOS[1]!]));
    expect(image(el).getAttribute('alt')).toBe('Label photo of Labneh');
    expect(dialog(el).getAttribute('aria-label')).toBe('Label photo of Labneh');
    expect(el.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe('Label');
    expect(button(el, 'Next photo')).toBeNull();
    expect(textButton(el, 'Set as cover')).toBeUndefined();
    expect(textButton(el, 'Cover photo')).toBeUndefined();
  });

  it('hides the cover action when the caller cannot change it', async () => {
    const { el } = await render((host) => host.coverId.set(null));
    expect(textButton(el, 'Set as cover')).toBeUndefined();
    expect(el.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe('1 / 3 · Food');
  });

  it('closes from the close button, a tap on the backdrop or the dialog closing', async () => {
    const { fixture, host, el } = await render();
    button(el, 'Close photo').click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
    expect(dialog(el).hasAttribute('open')).toBe(false);

    host.open.set(true);
    await fixture.whenStable();
    dialog(el).click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);

    host.open.set(true);
    await fixture.whenStable();
    dialog(el).close();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
  });

  it('stays closed without photos and clamps an index past the end', async () => {
    const { fixture, host, el } = await render((current) => current.photos.set([]));
    expect(dialog(el).hasAttribute('open')).toBe(false);

    host.photos.set(PHOTOS.slice(0, 2));
    host.index.set(5);
    await fixture.whenStable();
    expect(dialog(el).hasAttribute('open')).toBe(true);
    expect(image(el).getAttribute('src')).toBe('/api/photos/p2');
  });
});
