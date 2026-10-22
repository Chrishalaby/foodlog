import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LOG_PATH } from '../../../core/capture.service';
import { DraftSyncService } from '../../../core/draft-sync.service';
import { errorMessage } from '../../../core/errors';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import type { DraftRow } from './draft-rows';
import { DraftResumeHandoff } from './draft-resume';
import { DraftsStore } from './drafts.store';

export const DRAFTS_PATH = '/log?drafts=1';
export const DRAFT_UPLOADING_MESSAGE = 'This draft is uploading. Try again in a moment.';
export const DRAFT_DELETED_MESSAGE = 'Draft deleted';
export const DRAFT_DELETE_FAILED = 'Could not delete this draft.';

@Injectable({ providedIn: 'root' })
export class DraftActions {
  private readonly router = inject(Router);
  private readonly handoff = inject(DraftResumeHandoff);
  private readonly store = inject(DraftsStore);
  private readonly sync = inject(DraftSyncService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly busyState = signal<string | null>(null);

  readonly busyKey = this.busyState.asReadonly();

  open(row: DraftRow, analyze = false): void {
    const { source } = row;
    if (this.uploading(row)) {
      this.toast.info(DRAFT_UPLOADING_MESSAGE);
      return;
    }
    const request = this.handoff.offer(source, analyze);
    if (this.onLogPage()) {
      return;
    }
    void this.router
      .navigateByUrl(LOG_PATH)
      .catch(() => false)
      .then((landed) => {
        if (!landed && !this.onLogPage()) {
          this.handoff.withdraw(request);
        }
      });
  }

  async remove(row: DraftRow): Promise<boolean> {
    if (this.busyState() !== null) {
      return false;
    }
    if (this.uploading(row)) {
      this.toast.info(DRAFT_UPLOADING_MESSAGE);
      return false;
    }
    const confirmed = await this.confirm.confirm({
      title: 'Delete this draft?',
      message: `“${row.title}” and its photos will be removed. This can't be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!confirmed) {
      return false;
    }
    if (this.uploading(row)) {
      this.toast.info(DRAFT_UPLOADING_MESSAGE);
      return false;
    }
    this.busyState.set(row.key);
    try {
      await this.store.remove(row);
      this.toast.success(DRAFT_DELETED_MESSAGE);
      return true;
    } catch (err) {
      this.toast.error(errorMessage(err, DRAFT_DELETE_FAILED));
      return false;
    } finally {
      this.busyState.set(null);
    }
  }

  async retry(row: DraftRow): Promise<void> {
    await this.store.retryUpload(row);
  }

  private uploading(row: DraftRow): boolean {
    return row.source.kind === 'local' && this.sync.isUploading(row.source.draft.localId);
  }

  private onLogPage(): boolean {
    return this.router.url.split(/[?#]/)[0] === LOG_PATH;
  }
}
