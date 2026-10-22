import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { FoodRenameRequest, FoodRenameResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import {
  FavoriteRenameOffer,
  RENAME_LOGS_FAILED,
  renameLogsMessage,
} from './favorite-rename-offer';

function response(matched: number, renamed = matched): FoodRenameResponse {
  return { matchedEntries: matched, renamedEntries: renamed, renamedItems: renamed };
}

describe('FavoriteRenameOffer', () => {
  let renameFood: ReturnType<
    typeof vi.fn<(body: FoodRenameRequest) => Promise<FoodRenameResponse>>
  >;
  let confirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    renameFood = vi.fn(async (_body: FoodRenameRequest) => response(3));
    confirm = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { renameFood } },
        { provide: ConfirmService, useValue: { confirm } },
      ],
    });
  });

  afterEach(() => TestBed.inject(ToastService).clear());

  const offer = (from: string, to: string) => TestBed.inject(FavoriteRenameOffer).offer(from, to);
  const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);

  it('asks before renaming the past entries under the old name and then renames them', async () => {
    const events = TestBed.inject(DataEventsService);
    await offer(' Strawberry yogurt ', 'Khoury strawberry yogurt');

    expect(renameFood).toHaveBeenNthCalledWith(1, {
      from: 'Strawberry yogurt',
      to: 'Khoury strawberry yogurt',
      dryRun: true,
    });
    expect(confirm).toHaveBeenCalledWith({
      title: 'Also rename past entries?',
      message: renameLogsMessage(3, 'Strawberry yogurt', 'Khoury strawberry yogurt'),
      confirmLabel: 'Rename all',
      cancelLabel: 'Keep names',
    });
    expect(renameFood).toHaveBeenNthCalledWith(2, {
      from: 'Strawberry yogurt',
      to: 'Khoury strawberry yogurt',
    });
    expect(events.entries()).toBe(1);
    expect(lastToast()?.message).toBe('Renamed 3 entries to “Khoury strawberry yogurt”');
  });

  it('says how many entries it would rename', () => {
    expect(renameLogsMessage(1, 'A', 'B')).toBe(
      '1 entry named “A” will become “B”, so they show up as one food in search and quick add.',
    );
  });

  it('skips names that only differ in case, spacing or accents', async () => {
    await offer('Crème brûlée', '  creme   BRULEE ');
    await offer('', 'Oats');
    await offer('Oats', ' ');
    expect(renameFood).not.toHaveBeenCalled();
  });

  it('stays quiet when no past entry uses the old name', async () => {
    renameFood.mockResolvedValueOnce(response(0));
    await offer('Yogurt', 'Greek yogurt');
    expect(confirm).not.toHaveBeenCalled();
    expect(renameFood).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the count cannot be checked', async () => {
    renameFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    await offer('Yogurt', 'Greek yogurt');
    expect(confirm).not.toHaveBeenCalled();
    expect(TestBed.inject(ToastService).toasts()).toEqual([]);
  });

  it('keeps the old names when declined', async () => {
    confirm.mockResolvedValueOnce(false);
    await offer('Yogurt', 'Greek yogurt');
    expect(renameFood).toHaveBeenCalledTimes(1);
    expect(TestBed.inject(DataEventsService).entries()).toBe(0);
  });

  it('reports when nothing was left to rename', async () => {
    renameFood.mockResolvedValueOnce(response(2)).mockResolvedValueOnce(response(0));
    await offer('Yogurt', 'Greek yogurt');
    expect(lastToast()?.kind).toBe('info');
    expect(lastToast()?.message).toBe('Nothing named “Yogurt” was left to rename.');
  });

  it('reports a failed rename', async () => {
    renameFood
      .mockResolvedValueOnce(response(2))
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    await offer('Yogurt', 'Greek yogurt');
    expect(lastToast()?.kind).toBe('error');
    expect(lastToast()?.message).toBe(RENAME_LOGS_FAILED);
  });
});
