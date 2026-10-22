import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AnalysisPhotoRef, PhotoRef } from '@food/shared';
import { PhotoStrip } from './photo-strip';

const photo = (id: string): PhotoRef => ({
  id,
  url: `/api/photos/${id}`,
  thumbUrl: `/api/photos/${id}/thumb`,
  width: 10,
  height: 10,
});

@Component({
  imports: [PhotoStrip],
  template: `
    <app-photo-strip
      [photos]="photos()"
      [coverId]="coverId()"
      [hint]="hint()"
      (viewed)="viewed.push($event)"
    />
  `,
})
class Host {
  readonly photos = signal<AnalysisPhotoRef[]>([
    { photo: photo('p1'), role: 'food' },
    { photo: photo('p2'), role: 'label' },
    { photo: photo('p3'), role: 'food' },
  ]);
  readonly coverId = signal<string | null>('p1');
  readonly hint = signal<string | null>('Tap to view or change the cover');
  readonly viewed: number[] = [];
}

describe('PhotoStrip', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const buttons = (el: HTMLElement): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('li button'));

  it('shows every photo with its role and marks the cover', async () => {
    const { el } = await render();
    expect(el.querySelector('h2')?.textContent).toBe('Photos');
    expect(buttons(el).map((button) => button.getAttribute('aria-label'))).toEqual([
      'View photo 1 of 3, food, cover',
      'View photo 2 of 3, label',
      'View photo 3 of 3, food',
    ]);
    expect(buttons(el).map((button) => button.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Cover Food',
      'Label',
      'Food',
    ]);
    const images = Array.from(el.querySelectorAll('img'));
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      '/api/photos/p1/thumb',
      '/api/photos/p2/thumb',
      '/api/photos/p3/thumb',
    ]);
    expect(images[0]?.className).toContain('ring-brand');
    expect(images[1]?.className).not.toContain('ring-brand');
  });

  it('tells which photo was tapped', async () => {
    const { host, el } = await render();
    buttons(el)[1]!.click();
    buttons(el)[2]!.click();
    expect(host.viewed).toEqual([1, 2]);
  });

  it('follows a new cover and describes the photos with the hint', async () => {
    const { fixture, host, el } = await render();
    const hint = el.querySelector('p')!;
    expect(hint.textContent).toBe('Tap to view or change the cover');
    expect(buttons(el)[0]!.getAttribute('aria-describedby')).toBe(hint.id);

    host.coverId.set('p2');
    host.hint.set(null);
    await fixture.whenStable();
    expect(buttons(el)[1]!.getAttribute('aria-label')).toBe('View photo 2 of 3, label, cover');
    expect(buttons(el)[0]!.getAttribute('aria-label')).toBe('View photo 1 of 3, food');
    expect(el.querySelector('p')).toBeNull();
    expect(buttons(el)[0]!.hasAttribute('aria-describedby')).toBe(false);
  });
});
