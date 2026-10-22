import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';

export const KEYBOARD_MIN_SHRINK_PX = 150;
export const KEYBOARD_MIN_SHRINK_RATIO = 0.25;

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url']);

export function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type) && !target.readOnly && !target.disabled;
  }
  return target instanceof HTMLElement && target.isContentEditable === true;
}

export function keyboardShrinkThreshold(fullHeight: number): number {
  return Math.min(KEYBOARD_MIN_SHRINK_PX, fullHeight * KEYBOARD_MIN_SHRINK_RATIO);
}

@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private readonly document = inject(DOCUMENT);
  private readonly openState = signal(false);
  private fullHeight = 0;
  private fullWidth = 0;
  private editing = false;

  readonly open = this.openState.asReadonly();

  constructor() {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const viewport = view.visualViewport;
    const measure = (): void => this.measure();
    const onFocusIn = (event: FocusEvent): void => this.setEditing(isTextEntry(event.target));
    const onFocusOut = (event: FocusEvent): void =>
      this.setEditing(isTextEntry(event.relatedTarget));
    this.fullWidth = view.innerWidth;
    this.fullHeight = this.viewportHeight();
    this.editing = isTextEntry(this.document.activeElement);
    view.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    this.document.addEventListener('focusin', onFocusIn);
    this.document.addEventListener('focusout', onFocusOut);
    inject(DestroyRef).onDestroy(() => {
      view.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
      this.document.removeEventListener('focusin', onFocusIn);
      this.document.removeEventListener('focusout', onFocusOut);
    });
  }

  private setEditing(editing: boolean): void {
    this.editing = editing;
    this.measure();
  }

  private measure(): void {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const width = view.innerWidth;
    const height = this.viewportHeight();
    if (width !== this.fullWidth || !this.editing) {
      this.fullWidth = width;
      this.fullHeight = height;
    } else {
      this.fullHeight = Math.max(this.fullHeight, height);
    }
    const open =
      this.editing && this.fullHeight - height >= keyboardShrinkThreshold(this.fullHeight);
    const opened = open && !this.openState();
    this.openState.set(open);
    if (opened) {
      this.revealActiveElement(view);
    }
  }

  private revealActiveElement(view: Window): void {
    view.requestAnimationFrame(() => {
      const active = this.document.activeElement;
      if (active instanceof HTMLElement && isTextEntry(active)) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }

  private viewportHeight(): number {
    const view = this.document.defaultView;
    const viewport = view?.visualViewport;
    if (viewport) {
      return viewport.height * viewport.scale;
    }
    return view?.innerHeight ?? 0;
  }
}
