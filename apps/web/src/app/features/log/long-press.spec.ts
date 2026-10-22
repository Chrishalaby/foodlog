import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LONG_PRESS_MOVE_TOLERANCE_PX, LongPress } from './long-press';

const HOLD_MS = 40;

@Component({
  imports: [LongPress],
  template: `
    <button
      #press="longPress"
      type="button"
      appLongPress
      [longPressMs]="holdMs"
      [longPressDisabled]="disabled()"
      [class.pressing]="press.pressing()"
      (longPress)="longPresses.update((count) => count + 1)"
      (click)="onClick(press)"
    >
      Row
    </button>
  `,
})
class Host {
  readonly press = viewChild.required(LongPress);
  readonly holdMs = HOLD_MS;
  readonly disabled = signal(false);
  readonly longPresses = signal(0);
  readonly clicks = signal(0);

  onClick(press: LongPress): void {
    if (!press.consumeLongPress()) {
      this.clicks.update((count) => count + 1);
    }
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    ...init,
  });
}

describe('LongPress', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
    return { fixture, host: fixture.componentInstance, button };
  }

  it('fires after holding, shows that it is pressing and swallows the click that follows', async () => {
    const { fixture, host, button } = await setup();
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });

    button.dispatchEvent(pointer('pointerdown'));
    await fixture.whenStable();
    expect(button.classList.contains('pressing')).toBe(true);
    await wait(HOLD_MS + 20);
    await fixture.whenStable();
    expect(host.longPresses()).toBe(1);
    expect(button.classList.contains('pressing')).toBe(false);
    expect(vibrate).toHaveBeenCalledWith(12);

    button.dispatchEvent(pointer('pointerup'));
    button.click();
    expect(host.clicks()).toBe(0);
    button.click();
    expect(host.clicks()).toBe(1);
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('treats a quick tap as a normal click', async () => {
    const { host, button } = await setup();
    button.dispatchEvent(pointer('pointerdown'));
    button.dispatchEvent(pointer('pointerup'));
    button.click();
    await wait(HOLD_MS + 20);
    expect(host.longPresses()).toBe(0);
    expect(host.clicks()).toBe(1);
  });

  it('cancels when the finger moves or the browser takes over the gesture', async () => {
    const { host, button } = await setup();
    button.dispatchEvent(pointer('pointerdown'));
    button.dispatchEvent(
      pointer('pointermove', { clientX: 10 + LONG_PRESS_MOVE_TOLERANCE_PX / 2 }),
    );
    button.dispatchEvent(
      pointer('pointermove', { clientY: 10 + LONG_PRESS_MOVE_TOLERANCE_PX + 1 }),
    );
    await wait(HOLD_MS + 20);
    expect(host.longPresses()).toBe(0);

    button.dispatchEvent(pointer('pointerdown'));
    button.dispatchEvent(pointer('pointercancel'));
    await wait(HOLD_MS + 20);
    expect(host.longPresses()).toBe(0);
    expect(host.press().pressing()).toBe(false);
  });

  it('ignores other mouse buttons and secondary pointers', async () => {
    const { host, button } = await setup();
    button.dispatchEvent(pointer('pointerdown', { button: 1 }));
    button.dispatchEvent(pointer('pointerdown', { isPrimary: false, pointerId: 2 }));
    await wait(HOLD_MS + 20);
    expect(host.longPresses()).toBe(0);
  });

  it('opens right away from the context menu and suppresses the native menu', async () => {
    const { host, button } = await setup();
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(host.longPresses()).toBe(1);

    button.dispatchEvent(pointer('pointerdown'));
    await wait(HOLD_MS + 20);
    const afterHold = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(afterHold);
    expect(afterHold.defaultPrevented).toBe(true);
    expect(host.longPresses()).toBe(2);
  });

  it('lets the keyboard click again after a long press that produced no click', async () => {
    const { host, button } = await setup();
    button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    button.click();
    expect(host.clicks()).toBe(1);
  });

  it('does nothing while disabled', async () => {
    const { fixture, host, button } = await setup();
    host.disabled.set(true);
    await fixture.whenStable();
    button.dispatchEvent(pointer('pointerdown'));
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(menu);
    await wait(HOLD_MS + 20);
    expect(menu.defaultPrevented).toBe(false);
    expect(host.longPresses()).toBe(0);
    button.click();
    expect(host.clicks()).toBe(1);
  });
});
