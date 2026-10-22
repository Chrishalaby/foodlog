import { Pipe, type PipeTransform } from '@angular/core';
import type { NutrientKey } from '@food/shared';
import { formatNutrient, formatNutrientValue } from '../utils/format';

@Pipe({ name: 'nutrient' })
export class NutrientPipe implements PipeTransform {
  transform(value: number | null | undefined, key: NutrientKey, withUnit = true): string {
    const safe = value ?? 0;
    return withUnit ? formatNutrient(key, safe) : formatNutrientValue(key, safe);
  }
}
