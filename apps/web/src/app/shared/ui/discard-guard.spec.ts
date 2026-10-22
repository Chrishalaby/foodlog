import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmService } from './confirm.service';
import { DISCARD_CHANGES_TITLE, injectDiscardGuard } from './discard-guard';

describe('injectDiscardGuard', () => {
  function setup() {
    const dirty = signal(false);
    const guard = runInInjectionContext(TestBed.inject(Injector), () =>
      injectDiscardGuard(() => dirty(), 'Your edits will be lost.'),
    );
    const confirm = TestBed.inject(ConfirmService);
    return { dirty, guard, confirm };
  }

  it('lets a clean sheet close without asking', () => {
    const { guard, confirm } = setup();
    const spy = vi.spyOn(confirm, 'confirm');
    expect(guard('swipe')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('asks before discarding unsaved edits and follows the answer', async () => {
    const { dirty, guard, confirm } = setup();
    dirty.set(true);
    const pending = guard('backdrop');
    expect(confirm.current()).toEqual(
      expect.objectContaining({
        title: DISCARD_CHANGES_TITLE,
        message: 'Your edits will be lost.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      }),
    );
    confirm.settle(confirm.current()!.id, false);
    await expect(pending).resolves.toBe(false);

    const again = guard('escape');
    confirm.settle(confirm.current()!.id, true);
    await expect(again).resolves.toBe(true);
  });

  it('reads the dirty state at the moment the sheet tries to close', () => {
    const { dirty, guard, confirm } = setup();
    dirty.set(true);
    dirty.set(false);
    const spy = vi.spyOn(confirm, 'confirm');
    expect(guard('button')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
