import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AnalysisPhotoRef, PhotoRef } from '@food/shared';
import { LabelPhotoCard } from './label-photo-card';

const photo = (id: string): PhotoRef => ({
  id,
  url: `/api/photos/${id}`,
  thumbUrl: `/api/photos/${id}/thumb`,
  width: 10,
  height: 10,
});

@Component({
  imports: [LabelPhotoCard],
  template: `
    <app-label-photo-card
      [photos]="photos()"
      [hint]="hint()"
      [disabled]="disabled()"
      (camera)="events.push('camera')"
      (library)="events.push('library')"
    />
  `,
})
class Host {
  readonly photos = signal<AnalysisPhotoRef[]>([]);
  readonly hint = signal<string | null>(null);
  readonly disabled = signal(false);
  readonly events: string[] = [];
}

describe('LabelPhotoCard', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
  }

  const button = (el: HTMLElement, label: string): HTMLButtonElement =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it('offers the camera and the library for a label photo', async () => {
    const { el, host } = await render();
    expect(el.querySelector('h2')?.textContent).toContain('Add a label photo');
    expect(el.textContent).toContain('exact values from the pack');
    button(el, 'Take a label photo').click();
    button(el, 'Choose a label photo from the library').click();
    expect(host.events).toEqual(['camera', 'library']);
    const detail = el.querySelector('p')!;
    expect(button(el, 'Take a label photo').getAttribute('aria-describedby')).toBe(detail.id);
  });

  it('shows the hint and disables the actions while busy', async () => {
    const { fixture, el, host } = await render();
    host.hint.set('Looks packaged. A photo of its label gives exact values.');
    host.disabled.set(true);
    await fixture.whenStable();
    expect(el.textContent).toContain('Looks packaged');
    expect(el.querySelector('section')?.className).toContain('border-carbs');
    expect(button(el, 'Take a label photo').disabled).toBe(true);
    expect(button(el, 'Choose a label photo from the library').disabled).toBe(true);
  });

  it('leaves listing the photos to the photo strip', async () => {
    const { fixture, el, host } = await render();
    host.photos.set([
      { photo: photo('p1'), role: 'food' },
      { photo: photo('p2'), role: 'label' },
    ]);
    await fixture.whenStable();
    expect(el.querySelector('ul')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('exact values from the pack');
  });

  it('says an older photo makes room once the analysis holds the maximum', async () => {
    const { fixture, el, host } = await render();
    host.photos.set([
      { photo: photo('p1'), role: 'food' },
      { photo: photo('p2'), role: 'food' },
      { photo: photo('p3'), role: 'food' },
    ]);
    await fixture.whenStable();
    expect(el.querySelector('h2')?.textContent).toContain('Add a label photo');
    expect(el.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Replaces the oldest extra photo and re-runs the estimate',
    );
  });
});
