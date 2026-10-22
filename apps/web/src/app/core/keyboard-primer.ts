import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';

export const KEYBOARD_PRIME_MS = 1500;
export const KEYBOARD_PRIMER_ATTRIBUTE = 'data-keyboard-primer';

const PRIMER_STYLE =
  'position:fixed;top:0;left:0;width:1px;height:1px;margin:0;padding:0;border:0;opacity:0;pointer-events:none;font-size:16px';

@Injectable({ providedIn: 'root' })
export class KeyboardPrimer {
  private readonly document = inject(DOCUMENT);
  private primer: HTMLInputElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.release());
  }

  prime(durationMs: number = KEYBOARD_PRIME_MS): void {
    const primer = this.primer ?? this.create();
    this.clearTimer();
    this.timer = setTimeout(() => this.release(), durationMs);
    primer.focus({ preventScroll: true });
  }

  private create(): HTMLInputElement {
    const input = this.document.createElement('input');
    input.type = 'text';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute(KEYBOARD_PRIMER_ATTRIBUTE, '');
    input.style.cssText = PRIMER_STYLE;
    input.addEventListener('blur', () => this.release(), { once: true });
    this.document.body.appendChild(input);
    this.primer = input;
    return input;
  }

  private release(): void {
    this.clearTimer();
    const primer = this.primer;
    this.primer = null;
    primer?.remove();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
