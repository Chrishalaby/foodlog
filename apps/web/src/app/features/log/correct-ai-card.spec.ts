import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { API_LIMITS } from '@food/shared';
import { CorrectAiCard } from './correct-ai-card';

@Component({
  imports: [CorrectAiCard],
  template: `
    <app-correct-ai-card
      [(open)]="open"
      [(text)]="text"
      [disabled]="disabled()"
      (submitted)="sent.set($event)"
    />
  `,
})
class Host {
  readonly open = signal(false);
  readonly text = signal('');
  readonly disabled = signal(false);
  readonly sent = signal<string | null>(null);
}

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes(text),
  )!;

describe('CorrectAiCard', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('opens a focused correction box with helper chips', async () => {
    const { fixture, host, el } = await setup();
    buttonWith(el, 'Correct the AI').click();
    await fixture.whenStable();
    const field = el.querySelector('textarea')!;
    expect(host.open()).toBe(true);
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('maxlength')).toBe(String(API_LIMITS.followUpAnswerMax));
    expect(buttonWith(el, 'Re-estimate').disabled).toBe(true);

    buttonWith(el, 'No oil used').click();
    buttonWith(el, 'Restaurant portion').click();
    await fixture.whenStable();
    expect(host.text()).toBe('No oil used, Restaurant portion');
    expect(buttonWith(el, 'No oil used').getAttribute('aria-pressed')).toBe('true');
    buttonWith(el, 'No oil used').click();
    await fixture.whenStable();
    expect(host.text()).toBe('Restaurant portion');
  });

  it('submits the trimmed text and caps what can be typed', async () => {
    const { fixture, host, el } = await setup();
    host.open.set(true);
    await fixture.whenStable();
    const field = el.querySelector('textarea')!;
    field.value = 'x'.repeat(API_LIMITS.followUpAnswerMax + 40);
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(host.text()).toHaveLength(API_LIMITS.followUpAnswerMax);

    field.value = '  It was 2 eggs, not 3  ';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    buttonWith(el, 'Re-estimate').click();
    expect(host.sent()).toBe('It was 2 eggs, not 3');
  });

  it('submits with the keyboard send key and keeps Shift+Enter for new lines', async () => {
    const { fixture, host, el } = await setup();
    host.open.set(true);
    host.text.set('No butter');
    await fixture.whenStable();
    const field = el.querySelector('textarea')!;
    const shifted = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      cancelable: true,
    });
    field.dispatchEvent(shifted);
    expect(shifted.defaultPrevented).toBe(false);
    expect(host.sent()).toBeNull();

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    field.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(host.sent()).toBe('No butter');
  });

  it('closes on cancel and stays inert while disabled', async () => {
    const { fixture, host, el } = await setup();
    host.open.set(true);
    host.text.set('No butter');
    host.disabled.set(true);
    await fixture.whenStable();
    expect(buttonWith(el, 'Re-estimate').disabled).toBe(true);
    buttonWith(el, 'Cancel').click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
    expect(host.text()).toBe('No butter');
    expect(buttonWith(el, 'Correct the AI').disabled).toBe(true);
  });
});
