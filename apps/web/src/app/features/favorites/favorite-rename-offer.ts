import { Injectable, inject } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage } from '../../core/errors';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { entriesNoun, renamedMessage } from '../../shared/utils/food-library';
import { formatNumber } from '../../shared/utils/format';
import { sameFoodName } from '../log/food-search';

export const RENAME_LOGS_FAILED = 'Couldn’t rename your past entries. Please try again.';

export function renameLogsMessage(count: number, from: string, to: string): string {
  return `${formatNumber(count)} ${entriesNoun(count)} named “${from}” will become “${to}”, so they show up as one food in search and quick add.`;
}

@Injectable({ providedIn: 'root' })
export class FavoriteRenameOffer {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly events = inject(DataEventsService);

  async offer(from: string, to: string): Promise<void> {
    const source = from.trim();
    const target = to.trim();
    if (!source || !target || sameFoodName(source, target)) {
      return;
    }
    const matched = await this.api.renameFood({ from: source, to: target, dryRun: true }).then(
      (response) => response.matchedEntries,
      () => 0,
    );
    if (matched <= 0) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: 'Also rename past entries?',
      message: renameLogsMessage(matched, source, target),
      confirmLabel: 'Rename all',
      cancelLabel: 'Keep names',
    });
    if (!confirmed) {
      return;
    }
    try {
      const response = await this.api.renameFood({ from: source, to: target });
      this.events.notify('entries', 'favorites');
      if (response.renamedEntries > 0) {
        this.toast.success(renamedMessage(response.renamedEntries, target));
      } else {
        this.toast.info(`Nothing named “${source}” was left to rename.`);
      }
    } catch (err) {
      this.toast.error(errorMessage(err, RENAME_LOGS_FAILED));
    }
  }
}
