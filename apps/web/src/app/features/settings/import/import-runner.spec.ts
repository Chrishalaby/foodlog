import { type ImportBatchRequest, type ImportBatchResponse, zeroNutrients } from '@food/shared';
import type { ImportPlan } from './import-formats';
import {
  IMPORT_ENTRY_CHUNK,
  emptyImportResult,
  importBatches,
  importSummary,
  runImport,
} from './import-runner';

function planWith(entries: number, weights: number): ImportPlan {
  return {
    source: 'cronometer',
    label: 'Cronometer food log',
    entries: Array.from({ length: entries }, (_, index) => ({
      name: `Meal ${index}`,
      mealType: 'lunch',
      timestamp: '2025-03-01T12:00:00.000Z',
      localDate: '2025-03-01',
      items: [{ name: 'Food', grams: 100, nutrients: zeroNutrients() }],
    })),
    weights: Array.from({ length: weights }, (_, index) => ({
      date: `2025-03-${String(index + 1).padStart(2, '0')}`,
      value: 180,
      bodyFatPct: null,
    })),
    weightUnit: null,
    fluids: [],
    trainingDays: ['2025-03-01'],
    firstDate: '2025-03-01',
    lastDate: '2025-03-01',
    skippedRows: 0,
  };
}

describe('import runner', () => {
  it('splits a plan into batches the API accepts', () => {
    const batches = importBatches(planWith(IMPORT_ENTRY_CHUNK * 2 + 5, 3), 'lb');
    expect(
      batches.map((batch) => [
        batch.entries?.length ?? 0,
        batch.weights?.length ?? 0,
        batch.trainingDays?.length ?? 0,
      ]),
    ).toEqual([
      [100, 0, 0],
      [100, 0, 0],
      [5, 0, 0],
      [0, 3, 0],
      [0, 0, 1],
    ]);
    expect(batches[3]?.weights?.[0]?.weightKg).toBe(81.65);
    expect(batches.every((batch) => batch.source === 'cronometer')).toBe(true);
  });

  it('sends batches in order, adds up the results and reports progress', async () => {
    const sent: ImportBatchRequest[] = [];
    const progress: string[] = [];
    const result = await runImport(
      planWith(3, 2),
      'kg',
      async (body): Promise<ImportBatchResponse> => {
        sent.push(body);
        return {
          ...emptyImportResult(),
          entriesCreated: body.entries?.length ?? 0,
          weightsCreated: body.weights ? body.weights.length - 1 : 0,
          weightsSkipped: body.weights ? 1 : 0,
          trainingDaysSet: body.trainingDays?.length ?? 0,
        };
      },
      (done, total) => progress.push(`${done}/${total}`),
    );
    expect(sent).toHaveLength(3);
    expect(progress).toEqual(['0/3', '1/3', '2/3', '3/3']);
    expect(result).toMatchObject({
      entriesCreated: 3,
      weightsCreated: 1,
      weightsSkipped: 1,
      trainingDaysSet: 1,
    });
    expect(importSummary(result)).toBe(
      'Imported 3 meals, 1 weigh-in, 1 training day. Skipped 1 already in your log.',
    );
  });

  it('says when there was nothing new', () => {
    expect(importSummary({ ...emptyImportResult(), entriesSkipped: 4 })).toBe(
      'Nothing new to import. Skipped 4 already in your log.',
    );
    expect(importSummary(emptyImportResult())).toBe('Nothing new to import.');
  });
});
