import type { ImportBatchRequest, ImportBatchResponse } from '@food/shared';
import { weightsInKg, type ImportPlan, type WeightUnit } from './import-formats';

export const IMPORT_ENTRY_CHUNK = 100;
export const IMPORT_WEIGHT_CHUNK = 500;
export const IMPORT_FLUID_CHUNK = 1000;
export const IMPORT_DAY_CHUNK = 500;

export type ImportSender = (body: ImportBatchRequest) => Promise<ImportBatchResponse>;

export function emptyImportResult(): ImportBatchResponse {
  return {
    entriesCreated: 0,
    entriesSkipped: 0,
    weightsCreated: 0,
    weightsSkipped: 0,
    fluidsCreated: 0,
    fluidsSkipped: 0,
    trainingDaysSet: 0,
  };
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < list.length; start += size) {
    out.push(list.slice(start, start + size));
  }
  return out;
}

export function importBatches(plan: ImportPlan, unit: WeightUnit): ImportBatchRequest[] {
  const source = plan.source;
  return [
    ...chunks(plan.entries, IMPORT_ENTRY_CHUNK).map((entries) => ({ source, entries })),
    ...chunks(weightsInKg(plan, unit), IMPORT_WEIGHT_CHUNK).map((weights) => ({ source, weights })),
    ...chunks(plan.fluids, IMPORT_FLUID_CHUNK).map((fluids) => ({ source, fluids })),
    ...chunks(plan.trainingDays, IMPORT_DAY_CHUNK).map((trainingDays) => ({
      source,
      trainingDays,
    })),
  ];
}

export async function runImport(
  plan: ImportPlan,
  unit: WeightUnit,
  send: ImportSender,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<ImportBatchResponse> {
  const batches = importBatches(plan, unit);
  const total = emptyImportResult();
  onProgress(0, batches.length);
  for (const [index, batch] of batches.entries()) {
    const result = await send(batch);
    for (const key of Object.keys(total) as (keyof ImportBatchResponse)[]) {
      total[key] += result[key];
    }
    onProgress(index + 1, batches.length);
  }
  return total;
}

export function importSummary(result: ImportBatchResponse): string {
  const parts = [
    result.entriesCreated > 0
      ? `${result.entriesCreated} ${result.entriesCreated === 1 ? 'meal' : 'meals'}`
      : null,
    result.weightsCreated > 0
      ? `${result.weightsCreated} ${result.weightsCreated === 1 ? 'weigh-in' : 'weigh-ins'}`
      : null,
    result.fluidsCreated > 0
      ? `${result.fluidsCreated} ${result.fluidsCreated === 1 ? 'drink' : 'drinks'}`
      : null,
    result.trainingDaysSet > 0
      ? `${result.trainingDaysSet} training ${result.trainingDaysSet === 1 ? 'day' : 'days'}`
      : null,
  ].filter((part): part is string => part !== null);
  const skipped = result.entriesSkipped + result.weightsSkipped + result.fluidsSkipped;
  const imported = parts.length > 0 ? `Imported ${parts.join(', ')}.` : 'Nothing new to import.';
  return skipped > 0 ? `${imported} Skipped ${skipped} already in your log.` : imported;
}
