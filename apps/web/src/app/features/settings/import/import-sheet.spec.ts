import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ImportBatchRequest, ImportBatchResponse } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { installDialogShim } from '../../../shared/testing/dialog-shim';
import { emptyImportResult } from './import-runner';
import { UNKNOWN_FILE_MESSAGE } from './import-formats';
import { ImportSheet } from './import-sheet';

@Component({
  imports: [ImportSheet],
  template: `<app-import-sheet [(open)]="open" />`,
})
class Host {
  readonly open = signal(true);
}

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.replace(/\s+/g, ' ').trim() === text,
  );

const settle = async (fixture: { whenStable(): Promise<unknown> }): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
};

function choose(el: HTMLElement, name: string, content: string): void {
  const input = el.querySelector<HTMLInputElement>('[data-testid="import-file"]')!;
  const file = new File([content], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change'));
}

describe('ImportSheet', () => {
  const importBatch = vi.fn<(body: ImportBatchRequest) => Promise<ImportBatchResponse>>();
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    importBatch.mockReset();
    importBatch.mockImplementation(async (body) => ({
      ...emptyImportResult(),
      weightsCreated: body.weights?.length ?? 0,
    }));
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { importBatch } }],
    });
  });

  afterEach(() => restoreDialog());

  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows what a file holds, asks for the unit, imports and reports back', async () => {
    const events = TestBed.inject(DataEventsService);
    const weightsBefore = events.weights();
    const { fixture, el } = await render();
    choose(el, 'scale.csv', 'date,weight\n2025-03-01,181\n2025-03-02,180.4');
    await settle(fixture);

    const summary = el.querySelector('[data-testid="import-summary"]')!;
    expect(summary.textContent).toContain('Weight log');
    expect(summary.textContent).toContain('2 weigh-ins');
    expect(summary.textContent).toContain('From 2025-03-01 to 2025-03-02');
    buttonWith(el, 'lb')!.click();
    await fixture.whenStable();
    buttonWith(el, 'Import')!.click();
    await settle(fixture);

    expect(importBatch).toHaveBeenCalledWith({
      source: 'csv',
      weights: [
        { date: '2025-03-01', weightKg: 82.1, bodyFatPct: null },
        { date: '2025-03-02', weightKg: 81.83, bodyFatPct: null },
      ],
    });
    expect(el.textContent).toContain('Imported 2 weigh-ins.');
    expect(events.weights()).toBeGreaterThan(weightsBefore);
  });

  it('explains files it cannot read', async () => {
    const { fixture, el } = await render();
    choose(el, 'random.csv', 'a,b\n1,2');
    await settle(fixture);
    expect(el.textContent).toContain(UNKNOWN_FILE_MESSAGE);
    expect(el.querySelector('[data-testid="import-summary"]')).toBeNull();
  });

  it('says how far it got when the server fails', async () => {
    importBatch.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const { fixture, el } = await render();
    choose(el, 'scale.csv', 'date,weight (kg)\n2025-03-01,82');
    await settle(fixture);
    buttonWith(el, 'Import')!.click();
    await settle(fixture);
    expect(el.textContent).toContain('Nothing was imported.');
    expect(el.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});
