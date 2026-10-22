import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { ConfirmService } from '../shared/ui/confirm.service';
import {
  RELOAD_CONFIRM_TITLE,
  SwUpdateService,
  UNRECOVERABLE_MESSAGE,
  UPDATE_READY_MESSAGE,
} from './sw-update.service';
import { ToastService } from './toast.service';
import { registerUnsavedWork } from './unsaved-work.service';

function createUpdates() {
  return {
    isEnabled: true,
    versionUpdates: new Subject<VersionEvent>(),
    unrecoverable: new Subject<{ type: 'UNRECOVERABLE_STATE'; reason: string }>(),
    checkForUpdate: vi.fn(async () => false),
    activateUpdate: vi.fn(async () => true),
  };
}

function createDocument() {
  return {
    location: { reload: vi.fn() },
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe('SwUpdateService', () => {
  let updates: ReturnType<typeof createUpdates>;
  let doc: ReturnType<typeof createDocument>;
  let toast: ToastService;
  let confirm: ConfirmService;
  let unsaved: boolean;

  beforeEach(() => {
    updates = createUpdates();
    doc = createDocument();
    unsaved = false;
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: updates },
        { provide: DOCUMENT, useValue: doc },
      ],
    });
    TestBed.runInInjectionContext(() => registerUnsavedWork(() => unsaved));
    toast = TestBed.inject(ToastService);
    confirm = TestBed.inject(ConfirmService);
    TestBed.inject(SwUpdateService).init();
  });

  function toastWith(message: string) {
    return toast.toasts().find((t) => t.message === message);
  }

  function versionReady(): void {
    updates.versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'a' },
      latestVersion: { hash: 'b' },
    });
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }
  }

  it('reloads straight away when nothing is unsaved', async () => {
    versionReady();
    toast.runAction(toastWith(UPDATE_READY_MESSAGE)!.id);
    await flush();
    expect(confirm.current()).toBeNull();
    expect(updates.activateUpdate).toHaveBeenCalledTimes(1);
    expect(doc.location.reload).toHaveBeenCalledTimes(1);
  });

  it('asks first and keeps the update prompt when unsaved work would be lost', async () => {
    unsaved = true;
    versionReady();
    toast.runAction(toastWith(UPDATE_READY_MESSAGE)!.id);
    await flush();
    const request = confirm.current();
    expect(request?.title).toBe(RELOAD_CONFIRM_TITLE);
    expect(request?.cancelLabel).toBe('Not now');
    confirm.settle(request!.id, false);
    await flush();
    expect(updates.activateUpdate).not.toHaveBeenCalled();
    expect(doc.location.reload).not.toHaveBeenCalled();
    expect(toastWith(UPDATE_READY_MESSAGE)?.action?.label).toBe('Reload');
  });

  it('reloads after the user confirms losing unsaved work', async () => {
    unsaved = true;
    versionReady();
    toast.runAction(toastWith(UPDATE_READY_MESSAGE)!.id);
    await flush();
    confirm.settle(confirm.current()!.id, true);
    await flush();
    expect(updates.activateUpdate).toHaveBeenCalledTimes(1);
    expect(doc.location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once from a broken state when nothing is unsaved', () => {
    updates.unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'hash mismatch' });
    expect(doc.location.reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the user before reloading a broken state with unsaved work', async () => {
    unsaved = true;
    updates.unrecoverable.next({ type: 'UNRECOVERABLE_STATE', reason: 'hash mismatch' });
    expect(doc.location.reload).not.toHaveBeenCalled();
    const prompt = toastWith(UNRECOVERABLE_MESSAGE);
    expect(prompt?.durationMs).toBe(0);
    expect(prompt?.action?.label).toBe('Reload');

    toast.runAction(prompt!.id);
    await flush();
    confirm.settle(confirm.current()!.id, true);
    await flush();
    expect(doc.location.reload).toHaveBeenCalledTimes(1);
  });
});
