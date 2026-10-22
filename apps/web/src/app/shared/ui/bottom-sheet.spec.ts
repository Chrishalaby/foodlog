import { Component, signal, viewChild } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastService } from '../../core/toast.service';
import { ToastOutlet } from '../../layout/toast-outlet';
import { BottomSheet, type SheetCloseGuard, type SheetCloseReason } from './bottom-sheet';
import { ConfirmHost } from './confirm-host';
import { ConfirmService } from './confirm.service';
import { SCROLL_LOCK_ATTRIBUTE } from './scroll-lock';
import { SheetStack } from './sheet-stack';

const previousFocus = new WeakMap<HTMLDialogElement, Element | null>();

function installDialogShim(): () => void {
  const proto = HTMLDialogElement.prototype;
  const keys = ['open', 'showModal', 'close'] as const;
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'open', {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute('open');
    },
  });
  Object.defineProperty(proto, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      previousFocus.set(this, document.activeElement);
      this.setAttribute('open', '');
      this.querySelector<HTMLElement>('[autofocus], button, input')?.focus();
    },
  });
  Object.defineProperty(proto, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) {
        return;
      }
      this.removeAttribute('open');
      const previous = previousFocus.get(this);
      if (previous instanceof HTMLElement && this.contains(document.activeElement)) {
        previous.focus();
      }
      setTimeout(() => this.dispatchEvent(new Event('close')));
    },
  });
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(proto, key, descriptor);
      } else {
        Reflect.deleteProperty(proto, key);
      }
    }
  };
}

function pointer(type: string, clientY: number, pointerId = 1): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

@Component({
  imports: [BottomSheet, ToastOutlet, ConfirmHost],
  template: `
    <button id="trigger" type="button">Open</button>
    <app-bottom-sheet
      #sheetA
      id="a"
      title="Sheet A"
      [(open)]="aOpen"
      [canClose]="guard()"
      (closed)="closedCount.set(closedCount() + 1)"
    >
      <button id="inside-a" type="button">Inside A</button>
    </app-bottom-sheet>
    <app-bottom-sheet id="b" ariaLabel="Sheet B" [(open)]="bOpen">
      <button id="inside-b" type="button">Inside B</button>
    </app-bottom-sheet>
    @if (cMounted()) {
      <app-bottom-sheet id="c" title="Sheet C" [(open)]="cOpen">
        <button id="inside-c" type="button">Inside C</button>
      </app-bottom-sheet>
    }
    <app-toast-outlet />
    <app-confirm-host />
  `,
})
class SheetHost {
  readonly sheetA = viewChild.required<BottomSheet>('sheetA');
  readonly aOpen = signal(false);
  readonly bOpen = signal(false);
  readonly cOpen = signal(false);
  readonly cMounted = signal(false);
  readonly guard = signal<SheetCloseGuard | null>(null);
  readonly closedCount = signal(0);
}

describe('BottomSheet', () => {
  let restoreDialog: () => void;
  let fixture: ComponentFixture<SheetHost>;
  let host: SheetHost;
  let el: HTMLElement;

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };
  const dialog = (id: string): HTMLDialogElement =>
    el.querySelector<HTMLDialogElement>(`#${id} dialog`)!;
  const byId = (id: string): HTMLElement => el.querySelector<HTMLElement>(`#${id}`)!;
  const locked = (): boolean => document.documentElement.hasAttribute(SCROLL_LOCK_ATTRIBUTE);
  const confirmDialog = (): HTMLDialogElement =>
    el.querySelector<HTMLDialogElement>('app-confirm-host dialog')!;
  const buttonIn = (root: ParentNode, text: string): HTMLButtonElement =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === text,
    )!;
  const outletRegion = (role: 'status' | 'alert'): Element =>
    el.querySelector(`app-toast-outlet > app-toast-announcer [role="${role}"]`)!;
  const discardGuard = (): SheetCloseGuard => () =>
    TestBed.inject(ConfirmService).confirm({
      title: 'Discard changes?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });

  beforeEach(async () => {
    restoreDialog = installDialogShim();
    fixture = TestBed.createComponent(SheetHost);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    el.remove();
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  it('opens modally, locks page scroll and releases it when closed', async () => {
    byId('trigger').focus();
    host.aOpen.set(true);
    await settle();
    expect(dialog('a').open).toBe(true);
    expect(dialog('a').getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog('b').getAttribute('aria-label')).toBe('Sheet B');
    expect(locked()).toBe(true);

    host.aOpen.set(false);
    await settle();
    expect(dialog('a').open).toBe(false);
    expect(locked()).toBe(false);
    expect(host.closedCount()).toBe(1);
    expect(document.activeElement).toBe(byId('trigger'));
  });

  it('finishes closing without waiting for the deferred native close event', async () => {
    byId('trigger').focus();
    host.aOpen.set(true);
    await settle();
    host.aOpen.set(false);
    await fixture.whenStable();
    expect(locked()).toBe(false);
    expect(host.closedCount()).toBe(1);
    expect(document.activeElement).toBe(byId('trigger'));
    await settle();
    expect(host.closedCount()).toBe(1);
  });

  it('ignores a stale close event that arrives after the sheet reopened', async () => {
    host.aOpen.set(true);
    await settle();
    host.aOpen.set(false);
    await fixture.whenStable();
    host.aOpen.set(true);
    await fixture.whenStable();
    await settle();
    expect(dialog('a').open).toBe(true);
    expect(host.aOpen()).toBe(true);
    expect(locked()).toBe(true);
  });

  it('keeps the scroll lock until the last sheet closes and on destroy', async () => {
    host.aOpen.set(true);
    await settle();
    host.bOpen.set(true);
    await settle();
    host.aOpen.set(false);
    await settle();
    expect(locked()).toBe(true);
    fixture.destroy();
    expect(locked()).toBe(false);
    expect(TestBed.inject(SheetStack).hasOpen()).toBe(false);
  });

  it('asks canClose before closing on backdrop tap, Escape, swipe and the close button', async () => {
    const reasons: SheetCloseReason[] = [];
    host.guard.set((reason) => {
      reasons.push(reason);
      return false;
    });
    host.aOpen.set(true);
    await settle();
    const sheet = dialog('a');

    sheet.dispatchEvent(pointer('pointerdown', 10));
    sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const cancel = new Event('cancel', { cancelable: true });
    sheet.dispatchEvent(cancel);
    const zone = sheet.querySelector<HTMLElement>('.drag-zone')!;
    zone.querySelector('div')!.dispatchEvent(pointer('pointerdown', 100));
    zone.dispatchEvent(pointer('pointermove', 260));
    expect(sheet.style.transform).toBe('');
    await fixture.whenStable();
    expect(sheet.style.transform).toBe('translateY(160px)');
    zone.dispatchEvent(pointer('pointerup', 260));
    sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await settle();

    expect(reasons).toEqual(['backdrop', 'escape', 'swipe', 'button']);
    expect(cancel.defaultPrevented).toBe(true);
    expect(sheet.open).toBe(true);
    expect(sheet.style.transform).toBe('');
    expect(host.aOpen()).toBe(true);

    host.guard.set((reason) => reason === 'escape');
    await fixture.whenStable();
    sheet.dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle();
    expect(sheet.open).toBe(false);
    expect(host.aOpen()).toBe(false);
  });

  it('lets Escape close natively when no guard is set', async () => {
    host.aOpen.set(true);
    await settle();
    const cancel = new Event('cancel', { cancelable: true });
    dialog('a').dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(false);
  });

  it('waits for async guards and ignores repeated requests meanwhile', async () => {
    let answer: (value: boolean) => void = () => undefined;
    const guard = vi.fn<SheetCloseGuard>(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    host.guard.set(guard);
    host.aOpen.set(true);
    await settle();
    const sheet = host.sheetA();

    const first = sheet.requestClose('button');
    await expect(sheet.requestClose('backdrop')).resolves.toBe(false);
    expect(guard).toHaveBeenCalledOnce();
    expect(dialog('a').open).toBe(true);

    answer(true);
    await expect(first).resolves.toBe(true);
    await settle();
    expect(dialog('a').open).toBe(false);
    expect(host.aOpen()).toBe(false);
  });

  it('stays open when the guard throws or rejects', async () => {
    host.guard.set(() => {
      throw new Error('boom');
    });
    host.aOpen.set(true);
    await settle();
    await expect(host.sheetA().requestClose()).resolves.toBe(false);
    host.guard.set(() => Promise.reject(new Error('nope')));
    await fixture.whenStable();
    await expect(host.sheetA().requestClose()).resolves.toBe(false);
    expect(dialog('a').open).toBe(true);
  });

  it('closes unconditionally when close() is called programmatically', async () => {
    host.guard.set(() => false);
    host.aOpen.set(true);
    await settle();
    host.sheetA().close();
    await settle();
    expect(dialog('a').open).toBe(false);
    expect(host.closedCount()).toBe(1);
  });

  it('never returns focus into a sheet that has already closed', async () => {
    byId('trigger').focus();
    host.aOpen.set(true);
    await settle();
    byId('inside-a').focus();

    host.bOpen.set(true);
    await settle();
    expect(dialog('b').contains(document.activeElement)).toBe(true);

    host.aOpen.set(false);
    await settle();
    expect(dialog('b').contains(document.activeElement)).toBe(true);

    host.bOpen.set(false);
    await settle();
    expect(document.activeElement).toBe(byId('trigger'));
  });

  it('returns focus into a sheet that is still open underneath', async () => {
    host.aOpen.set(true);
    await settle();
    byId('inside-a').focus();
    host.bOpen.set(true);
    await settle();
    host.bOpen.set(false);
    await settle();
    expect(document.activeElement).toBe(byId('inside-a'));
  });

  it('does not steal focus the app moved elsewhere after closing', async () => {
    byId('trigger').focus();
    host.aOpen.set(true);
    await settle();
    host.aOpen.set(false);
    await fixture.whenStable();
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('hosts interactive toasts inside the topmost open sheet', async () => {
    const toasts = TestBed.inject(ToastService);
    const view = vi.fn();
    toasts.success('Logged yogurt', {
      actions: [
        { label: 'Undo', run: vi.fn() },
        { label: 'View', run: view },
      ],
    });
    await settle();
    const outlet = el.querySelector('app-toast-outlet')!;
    expect(outlet.textContent).toContain('Logged yogurt');

    host.aOpen.set(true);
    await settle();
    expect(outlet.textContent).not.toContain('Logged yogurt');
    expect(dialog('a').querySelector('[popover]')?.textContent).toContain('Logged yogurt');

    host.bOpen.set(true);
    await settle();
    expect(dialog('a').querySelector('[popover]')).toBeNull();
    const layer = dialog('b').querySelector('[popover]')!;
    expect(layer.getAttribute('aria-label')).toBe('Notifications');
    const viewButton = Array.from(layer.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'View',
    )!;
    viewButton.click();
    expect(view).toHaveBeenCalledOnce();

    host.aOpen.set(false);
    host.bOpen.set(false);
    toasts.info('Back on the page');
    await settle();
    expect(outlet.textContent).toContain('Back on the page');
  });

  it('returns focus to the page trigger after a Discard confirmation closes the sheet', async () => {
    host.guard.set(discardGuard());
    byId('trigger').focus();
    host.aOpen.set(true);
    await settle();
    const closeButton = dialog('a').querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    closeButton.focus();
    closeButton.click();
    await settle();
    expect(confirmDialog().open).toBe(true);

    const discard = buttonIn(confirmDialog(), 'Discard');
    discard.focus();
    discard.click();
    await settle();

    expect(dialog('a').open).toBe(false);
    expect(confirmDialog().open).toBe(false);
    expect(host.aOpen()).toBe(false);
    expect(locked()).toBe(false);
    expect(document.activeElement).toBe(byId('trigger'));
  });

  it('returns focus into the still-open sheet when the user keeps editing', async () => {
    host.guard.set(discardGuard());
    byId('trigger').focus();
    host.aOpen.set(true);
    await settle();
    const closeButton = dialog('a').querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    closeButton.focus();
    closeButton.click();
    await settle();

    buttonIn(confirmDialog(), 'Keep editing').click();
    await settle();

    expect(dialog('a').open).toBe(true);
    expect(locked()).toBe(true);
    expect(document.activeElement).toBe(closeButton);
  });

  it('does not consult the guard when the sheet is already closed', async () => {
    const guard = vi.fn<SheetCloseGuard>(() => false);
    host.guard.set(guard);
    await fixture.whenStable();
    await expect(host.sheetA().requestClose('button')).resolves.toBe(true);
    expect(guard).not.toHaveBeenCalled();
  });

  it('lets a non-cancelable Escape close natively without prompting afterwards', async () => {
    const guard = vi.fn<SheetCloseGuard>(() => false);
    host.guard.set(guard);
    host.aOpen.set(true);
    await settle();
    const cancel = new Event('cancel', { cancelable: false });
    dialog('a').dispatchEvent(cancel);
    expect(guard).not.toHaveBeenCalled();
  });

  it('ignores a pending guard from before the sheet was closed and reopened', async () => {
    const answers: ((value: boolean) => void)[] = [];
    const guard = vi.fn<SheetCloseGuard>(
      () =>
        new Promise<boolean>((resolve) => {
          answers.push(resolve);
        }),
    );
    host.guard.set(guard);
    host.aOpen.set(true);
    await settle();
    const stale = host.sheetA().requestClose('backdrop');

    host.sheetA().close();
    await fixture.whenStable();
    host.aOpen.set(true);
    await settle();
    expect(dialog('a').open).toBe(true);
    const fresh = host.sheetA().requestClose('button');
    expect(guard).toHaveBeenCalledTimes(2);

    answers[0]!(true);
    await expect(stale).resolves.toBe(false);
    expect(dialog('a').open).toBe(true);
    answers[1]!(true);
    await expect(fresh).resolves.toBe(true);
    await settle();
    expect(dialog('a').open).toBe(false);
  });

  it('announces a toast shown while a sheet closes from the page live region', async () => {
    const toasts = TestBed.inject(ToastService);
    host.aOpen.set(true);
    await settle();
    host.aOpen.set(false);
    toasts.success('Favorite saved');
    await settle();
    expect(outletRegion('status').textContent?.trim()).toBe('Favorite saved');

    host.aOpen.set(true);
    await settle();
    toasts.info('Weigh-in added');
    host.sheetA().close();
    await settle();
    expect(outletRegion('status').textContent?.trim()).toBe('Weigh-in added');
  });

  it('announces toasts inside the open sheet once and not again after it closes', async () => {
    const toasts = TestBed.inject(ToastService);
    host.aOpen.set(true);
    await settle();
    toasts.error('Could not save');
    await settle();
    const layer = dialog('a').querySelector('[popover]')!;
    expect(layer.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Could not save');
    expect(outletRegion('alert').textContent?.trim()).toBe('');

    host.aOpen.set(false);
    await settle();
    expect(el.querySelector('app-toast-outlet')!.textContent).toContain('Could not save');
    expect(outletRegion('alert').textContent?.trim()).toBe('');
  });

  it('releases the lock and returns focus when an open sheet is removed from the page', async () => {
    byId('trigger').focus();
    host.cMounted.set(true);
    host.cOpen.set(true);
    await settle();
    expect(dialog('c').open).toBe(true);
    byId('inside-c').focus();
    expect(locked()).toBe(true);

    host.cMounted.set(false);
    await settle();
    expect(el.querySelector('#c')).toBeNull();
    expect(locked()).toBe(false);
    expect(TestBed.inject(SheetStack).hasOpen()).toBe(false);
    expect(document.activeElement).toBe(byId('trigger'));
  });
});
