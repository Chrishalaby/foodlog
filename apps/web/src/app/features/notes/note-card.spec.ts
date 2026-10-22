import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { LONG_PRESS_MS } from '../log/long-press';
import { NoteCard } from './note-card';
import type { FeedNote } from './notes-model';

function feedNote(overrides: Partial<FeedNote> = {}): FeedNote {
  return {
    key: 'note-1',
    id: 'note-1',
    text: 'Buy mirror https://shop.test/m',
    photos: [],
    done: false,
    createdAt: new Date(2026, 9, 7, 14, 5).toISOString(),
    state: 'sent',
    error: null,
    ...overrides,
  };
}

@Component({
  imports: [NoteCard],
  template: `
    <app-note-card
      [note]="note()"
      (toggled)="events.push('toggled')"
      (menu)="events.push('menu')"
      (photoOpened)="events.push('photo ' + $event)"
      (retried)="events.push('retried')"
      (discarded)="events.push('discarded')"
    />
  `,
})
class Host {
  readonly note = signal(feedNote());
  readonly events: string[] = [];
}

function pointer(type: string): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 20,
    clientY: 20,
  });
}

describe('NoteCard', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  const bubble = (): HTMLElement => el.querySelector<HTMLElement>('article > div')!;
  const toggle = (): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
  const more = (): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('button[aria-label="More actions"]');

  function render(note: FeedNote = feedNote()): void {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    host.note.set(note);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers a round done toggle with a full-size touch target', () => {
    render();
    expect(toggle().classList.contains('size-11')).toBe(true);
    expect(toggle().getAttribute('aria-label')).toBe('Mark as done');
    toggle().click();
    expect(host.events).toEqual(['toggled']);

    host.note.set(feedNote({ done: true }));
    fixture.detectChanges();
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('Done. Mark as to do');
    expect(bubble().classList.contains('opacity-60')).toBe(true);
    expect(el.querySelector('article')?.getAttribute('aria-label')).toMatch(/^Note from .+, done$/);
  });

  it('opens the actions from the more button and from a long press', async () => {
    render();
    more()!.click();
    expect(host.events).toEqual(['menu']);

    bubble().dispatchEvent(pointer('pointerdown'));
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
    expect(host.events).toEqual(['menu', 'menu']);
  });

  it('does not follow a link or open a photo when the press was a long press', async () => {
    render(
      feedNote({
        photos: [{ id: 'p1', url: '/api/photos/p1', thumbUrl: '/t', width: 4, height: 3 }],
      }),
    );
    const link = el.querySelector('a')!;
    link.dispatchEvent(pointer('pointerdown'));
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
    const held = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    expect(host.events).toEqual(['menu']);

    const photo = el.querySelector<HTMLButtonElement>('button[aria-label="Open photo"]')!;
    photo.dispatchEvent(pointer('pointerdown'));
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
    photo.click();
    expect(host.events).toEqual(['menu', 'menu']);
    photo.click();
    expect(host.events).toEqual(['menu', 'menu', 'photo 0']);
  });

  it('shows a sending note without actions', async () => {
    render(feedNote({ key: 'local-1', id: null, state: 'sending' }));
    expect(el.textContent).toContain('Sending…');
    expect(toggle().disabled).toBe(true);
    expect(more()).toBeNull();
    bubble().dispatchEvent(pointer('pointerdown'));
    await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
    expect(host.events).toEqual([]);
  });

  it('offers retry and discard on a note that was not sent', () => {
    render(
      feedNote({ key: 'local-1', id: null, state: 'failed', error: 'You appear to be offline.' }),
    );
    expect(el.textContent).toContain('Not sent');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('You appear to be offline.');
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('button.btn'));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Retry', 'Discard']);
    buttons[0].click();
    buttons[1].click();
    expect(host.events).toEqual(['retried', 'discarded']);
    expect(buttons.every((button) => button.classList.contains('btn'))).toBe(true);
  });

  it('lays out two to four photos as a grid with a wide first tile for three', () => {
    const photos = ['a', 'b', 'c'].map((id) => ({
      id,
      url: `/api/photos/${id}`,
      thumbUrl: `/api/photos/${id}/thumb`,
      width: 4,
      height: 3,
    }));
    render(feedNote({ text: '', photos }));
    const tiles = Array.from(el.querySelectorAll<HTMLButtonElement>('.grid > button'));
    expect(tiles).toHaveLength(3);
    expect(tiles[0].classList.contains('col-span-2')).toBe(true);
    expect(tiles[1].classList.contains('aspect-square')).toBe(true);
    expect(tiles[2].getAttribute('aria-label')).toBe('Open photo 3 of 3');
    tiles[2].click();
    expect(host.events).toEqual(['photo 2']);
  });
});
