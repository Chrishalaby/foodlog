import type { FoodSearchResult } from '@food/shared';
import type { DataTopic } from '../../core/data-events.service';

export function quickLogTopics(result: Pick<FoodSearchResult, 'kind'>): DataTopic[] {
  return result.kind === 'product'
    ? ['entries', 'favorites', 'products']
    : ['entries', 'favorites'];
}
