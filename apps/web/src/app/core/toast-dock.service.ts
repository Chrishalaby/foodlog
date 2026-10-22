import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';

export const TOAST_CLEARANCE_ATTRIBUTE = 'data-toast-clearance';
export const TOAST_CLEARANCE_SELECTOR = `[${TOAST_CLEARANCE_ATTRIBUTE}]`;
export const TOAST_DOCK_GAP_PX = 12;

@Injectable({ providedIn: 'root' })
export class ToastDock {
  private readonly document = inject(DOCUMENT);
  private readonly clearanceState = signal(0);

  readonly clearance = this.clearanceState.asReadonly();

  constructor() {
    const view = this.document.defaultView;
    if (!view) {
      return;
    }
    const viewport = view.visualViewport;
    const measure = (): void => this.measure();
    view.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    inject(DestroyRef).onDestroy(() => {
      view.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
    });
  }

  measure(): void {
    const height = this.document.defaultView?.innerHeight ?? 0;
    let clearance = 0;
    for (const element of Array.from(
      this.document.querySelectorAll<HTMLElement>(TOAST_CLEARANCE_SELECTOR),
    )) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.top >= height) {
        continue;
      }
      clearance = Math.max(clearance, Math.ceil(height - rect.top));
    }
    this.clearanceState.set(clearance);
  }
}
