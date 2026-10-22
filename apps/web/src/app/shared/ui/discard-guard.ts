import { inject } from '@angular/core';
import type { SheetCloseGuard } from './bottom-sheet';
import { ConfirmService } from './confirm.service';

export const DISCARD_CHANGES_TITLE = 'Discard changes?';

export function injectDiscardGuard(isDirty: () => boolean, message: string): SheetCloseGuard {
  const confirm = inject(ConfirmService);
  return () =>
    !isDirty() ||
    confirm.confirm({
      title: DISCARD_CHANGES_TITLE,
      message,
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
}
