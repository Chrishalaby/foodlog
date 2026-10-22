import { TestBed } from '@angular/core/testing';
import { SessionScope } from '../../core/session-scope';
import { ConfirmHost } from './confirm-host';
import { ConfirmService } from './confirm.service';
import { SCROLL_LOCK_ATTRIBUTE, isScrollLocked, lockScroll } from './scroll-lock';

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
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(proto, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (this.hasAttribute('open')) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      }
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

describe('scroll lock', () => {
  it('counts nested locks and releases each handle only once', () => {
    const root = document.documentElement;
    const first = lockScroll(document);
    const second = lockScroll(document);
    expect(root.hasAttribute(SCROLL_LOCK_ATTRIBUTE)).toBe(true);
    first();
    first();
    expect(isScrollLocked(document)).toBe(true);
    second();
    expect(isScrollLocked(document)).toBe(false);
    expect(root.hasAttribute(SCROLL_LOCK_ATTRIBUTE)).toBe(false);
  });
});

describe('ConfirmHost', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
  });

  afterEach(() => restoreDialog());

  it('locks scrolling while asking and resolves false when dismissed natively', async () => {
    const fixture = TestBed.createComponent(ConfirmHost);
    await fixture.whenStable();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
    expect(dialog.className).toContain('backdrop:bg-(--app-backdrop)');
    expect(dialog.className).toContain('overflow-y-auto');

    const answer = TestBed.inject(ConfirmService).confirm({
      title: 'Discard changes?',
      message: 'Your edits will be lost.',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
    await fixture.whenStable();
    expect(dialog.open).toBe(true);
    expect(isScrollLocked(document)).toBe(true);
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.textContent).toContain('Your edits will be lost.');

    dialog.close();
    await expect(answer).resolves.toBe(false);
    expect(isScrollLocked(document)).toBe(false);
  });

  it('cancels a question from the previous session when the session resets', async () => {
    const fixture = TestBed.createComponent(ConfirmHost);
    await fixture.whenStable();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
    const answer = TestBed.inject(ConfirmService).confirm({ title: 'Delete this entry?' });
    await fixture.whenStable();
    expect(dialog.open).toBe(true);

    TestBed.inject(SessionScope).reset();
    await fixture.whenStable();

    await expect(answer).resolves.toBe(false);
    expect(TestBed.inject(ConfirmService).current()).toBeNull();
    expect(dialog.open).toBe(false);
    expect(isScrollLocked(document)).toBe(false);
  });

  it('releases the scroll lock when destroyed while open', async () => {
    const fixture = TestBed.createComponent(ConfirmHost);
    await fixture.whenStable();
    void TestBed.inject(ConfirmService).confirm({ title: 'Delete?' });
    await fixture.whenStable();
    expect(isScrollLocked(document)).toBe(true);
    fixture.destroy();
    expect(isScrollLocked(document)).toBe(false);
  });

  it('returns focus to the element that asked once the answer removes the dialog content', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const fixture = TestBed.createComponent(ConfirmHost);
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    await fixture.whenStable();

    const answer = TestBed.inject(ConfirmService).confirm({
      title: 'Delete?',
      confirmLabel: 'Delete',
    });
    await fixture.whenStable();
    const confirmButton = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete',
    )!;
    confirmButton.focus();
    confirmButton.click();
    await expect(answer).resolves.toBe(true);
    await fixture.whenStable();

    expect(host.querySelector('dialog')!.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    fixture.destroy();
    host.remove();
    trigger.remove();
  });

  it('ignores a stale close event that arrives while a newer request is showing', async () => {
    const fixture = TestBed.createComponent(ConfirmHost);
    await fixture.whenStable();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog')!;
    const service = TestBed.inject(ConfirmService);
    const answer = service.confirm({ title: 'Delete?' });
    await fixture.whenStable();

    dialog.dispatchEvent(new Event('close'));
    expect(service.current()).not.toBeNull();
    expect(isScrollLocked(document)).toBe(true);

    service.settle(service.current()!.id, true);
    await expect(answer).resolves.toBe(true);
    await fixture.whenStable();
    expect(isScrollLocked(document)).toBe(false);
  });
});
