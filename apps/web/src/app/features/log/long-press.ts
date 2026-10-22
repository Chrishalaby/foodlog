import { DestroyRef, Directive, inject, input, output, signal } from '@angular/core';

export const LONG_PRESS_MS = 450;
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

interface PressOrigin {
  pointerId: number;
  x: number;
  y: number;
}

@Directive({
  selector: '[appLongPress]',
  exportAs: 'longPress',
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(pointermove)': 'onPointerMove($event)',
    '(pointerup)': 'cancel()',
    '(pointerleave)': 'cancel()',
    '(pointercancel)': 'cancel()',
    '(contextmenu)': 'onContextMenu($event)',
    '(keydown)': 'onKeydown()',
  },
})
export class LongPress {
  readonly longPressDisabled = input(false);
  readonly longPressMs = input(LONG_PRESS_MS);
  readonly longPress = output<void>();

  private readonly pressingState = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private origin: PressOrigin | null = null;
  private fired = false;

  readonly pressing = this.pressingState.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  consumeLongPress(): boolean {
    const fired = this.fired;
    this.fired = false;
    return fired;
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.origin = null;
    this.pressingState.set(false);
  }

  protected onPointerDown(event: PointerEvent): void {
    this.fired = false;
    this.cancel();
    if (this.longPressDisabled() || event.button !== 0 || event.isPrimary === false) {
      return;
    }
    this.origin = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    this.pressingState.set(true);
    this.timer = setTimeout(() => this.trigger(), this.longPressMs());
  }

  protected onPointerMove(event: PointerEvent): void {
    const origin = this.origin;
    if (!origin || origin.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (distance > LONG_PRESS_MOVE_TOLERANCE_PX) {
      this.cancel();
    }
  }

  protected onContextMenu(event: Event): void {
    if (this.longPressDisabled()) {
      return;
    }
    event.preventDefault();
    if (!this.fired) {
      this.trigger();
    }
  }

  protected onKeydown(): void {
    this.fired = false;
  }

  private trigger(): void {
    this.cancel();
    this.fired = true;
    navigator.vibrate?.(12);
    this.longPress.emit();
  }
}
