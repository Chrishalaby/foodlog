import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AdminPendingService } from '../core/admin-pending.service';
import { CaptureService } from '../core/capture.service';
import { KeyboardService } from '../core/keyboard.service';
import { NetworkService } from '../core/network.service';
import { aiOff } from '../core/testing/ai-off';
import { installDialogShim } from '../shared/testing/dialog-shim';
import { FOOD_DATABASE_PATH, Shell } from './shell';

describe('Shell without AI', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        aiOff(),
        { provide: KeyboardService, useValue: { open: signal(false) } },
        { provide: NetworkService, useValue: { online: signal(true) } },
        { provide: AdminPendingService, useValue: { count: signal(0) } },
      ],
    });
  });

  afterEach(() => restoreDialog());

  async function render() {
    const fixture = TestBed.createComponent(Shell);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('turns the camera button into food search', async () => {
    const { el } = await render();
    const capture = TestBed.inject(CaptureService);
    const camera = vi.spyOn(capture, 'requestCamera').mockImplementation(() => undefined);
    const search = vi.spyOn(capture, 'openSearch').mockImplementation(() => undefined);
    expect(el.querySelector('button[aria-label="Take a food photo"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('button[aria-label="Search foods to log"]')!.click();
    expect(search).toHaveBeenCalledTimes(1);
    expect(camera).not.toHaveBeenCalled();
  });

  it('leaves AI actions out of the log sheet and offers the food database', async () => {
    const { fixture, el } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('button[aria-label="More ways to log food"]')!.click();
    await fixture.whenStable();
    const rows = Array.from(el.querySelectorAll('button.action-row')).map((row) =>
      row.querySelector('.font-semibold')?.textContent?.trim(),
    );
    expect(rows).toEqual([
      'Search my foods',
      'Scan barcode',
      'Compare options',
      'Food database',
      'Log weight',
      'Favorites',
    ]);
    (el.querySelectorAll<HTMLButtonElement>('button.action-row')[3] as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(FOOD_DATABASE_PATH);
  });
});
