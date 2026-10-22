import { DOCUMENT, DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, type VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { ConfirmService } from '../shared/ui/confirm.service';
import { ToastService } from './toast.service';
import { UnsavedWorkService } from './unsaved-work.service';

export const UPDATE_READY_MESSAGE = 'A new version is ready.';
export const UNRECOVERABLE_MESSAGE = 'The app needs to reload to keep working.';
export const RELOAD_CONFIRM_TITLE = 'Reload now?';
export const RELOAD_CONFIRM_MESSAGE = 'The app will restart and your unsaved changes will be lost.';

@Injectable({ providedIn: 'root' })
export class SwUpdateService {
  private readonly updates = inject(SwUpdate);
  private readonly document = inject(DOCUMENT);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly unsavedWork = inject(UnsavedWorkService);
  private readonly destroyRef = inject(DestroyRef);
  private started = false;

  init(): void {
    if (this.started || !this.updates.isEnabled) {
      return;
    }
    this.started = true;

    this.updates.versionUpdates
      .pipe(
        filter((event): event is VersionReadyEvent => event.type === 'VERSION_READY'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.promptReload());

    this.updates.unrecoverable
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onUnrecoverable());

    const onVisibilityChange = (): void => {
      if (this.document.visibilityState === 'visible') {
        void this.checkForUpdate();
      }
    };
    this.document.addEventListener('visibilitychange', onVisibilityChange);
    this.destroyRef.onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisibilityChange),
    );
  }

  async checkForUpdate(): Promise<boolean> {
    if (!this.updates.isEnabled) {
      return false;
    }
    try {
      return await this.updates.checkForUpdate();
    } catch {
      return false;
    }
  }

  async activateAndReload(message: string = UPDATE_READY_MESSAGE): Promise<void> {
    if (!(await this.readyToReload())) {
      this.promptReload(message);
      return;
    }
    try {
      await this.updates.activateUpdate();
    } finally {
      this.document.location.reload();
    }
  }

  private async readyToReload(): Promise<boolean> {
    if (!this.unsavedWork.hasUnsavedWork()) {
      return true;
    }
    return this.confirm.confirm({
      title: RELOAD_CONFIRM_TITLE,
      message: RELOAD_CONFIRM_MESSAGE,
      confirmLabel: 'Reload',
      cancelLabel: 'Not now',
      tone: 'danger',
    });
  }

  private onUnrecoverable(): void {
    if (this.unsavedWork.hasUnsavedWork()) {
      this.promptReload(UNRECOVERABLE_MESSAGE);
      return;
    }
    this.document.location.reload();
  }

  private promptReload(message: string = UPDATE_READY_MESSAGE): void {
    this.toast.info(message, {
      durationMs: 0,
      action: { label: 'Reload', run: () => void this.activateAndReload(message) },
    });
  }
}
