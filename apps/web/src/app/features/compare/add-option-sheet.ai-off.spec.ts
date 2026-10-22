import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiService } from '../../core/api.service';
import { aiOff } from '../../core/testing/ai-off';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { AddOptionSheet } from './add-option-sheet';
import { CompareStore } from './compare.store';

describe('AddOptionSheet without AI', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    TestBed.configureTestingModule({
      providers: [
        aiOff(),
        { provide: ApiService, useValue: { searchFoods: vi.fn() } },
        {
          provide: CompareStore,
          useValue: {
            freeSlots: signal(3),
            menu: signal({ status: 'idle' }),
            lastMenu: signal(null),
            options: signal([]),
            budget: signal(null),
          },
        },
      ],
    });
  });

  afterEach(() => restoreDialog());

  it('keeps your foods and barcodes, without the AI estimates', async () => {
    const fixture = TestBed.createComponent(AddOptionSheet);
    fixture.detectChanges();
    fixture.componentInstance.show();
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Scan barcode');
    for (const label of ['Describe it', 'Food photo', 'Nutrition label', 'Scan a menu']) {
      expect(text).not.toContain(label);
    }
  });
});
