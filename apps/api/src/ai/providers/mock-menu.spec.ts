import { API_LIMITS } from '@food/shared';
import { normalizeMenuScan } from '../../compare/menu-normalize.js';
import { MenuScanSchema } from '../../compare/menu-scan.schema.js';
import type { AiMenuRequest } from './ai-provider.js';
import { MOCK_NOTICE } from './mock-analysis.js';
import {
  MOCK_MENU_DISHES,
  MOCK_RESTAURANT,
  mockMenuScan,
} from './mock-menu.js';
import { MOCK_MODEL, MockProvider } from './mock.provider.js';

const REQUEST: AiMenuRequest = {
  model: 'gpt-5.6-sol',
  images: [
    { dataUrl: 'data:image/jpeg;base64,a', detail: 'high' },
    { dataUrl: 'data:image/jpeg;base64,b', detail: 'high' },
  ],
  prompt: { description: 'high protein', imageCount: 2, location: null },
};

describe('mock menu scan', () => {
  it('returns schema-valid, deterministic dishes', () => {
    const first = mockMenuScan();

    expect(MenuScanSchema.parse(first)).toEqual(first);
    expect(mockMenuScan()).toEqual(first);
    expect(first.restaurant).toBe(MOCK_RESTAURANT);
    expect(first.dishes.map((dish) => dish.name)).toEqual([
      'Grilled chicken plate',
      'Falafel wrap',
      'Chicken caesar salad',
      'Beef burger',
    ]);
    expect(first.dishes.length).toBeLessThanOrEqual(API_LIMITS.menuDishesMax);
  });

  it('never shares the dish constants with callers', () => {
    const scan = mockMenuScan();
    scan.dishes[0]!.per_serving.calories = 1;

    expect(MOCK_MENU_DISHES[0]!.per_serving.calories).toBe(570);
  });

  it('normalizes without consistency warnings beyond the mock notice', () => {
    const normalized = normalizeMenuScan(mockMenuScan());

    expect(normalized.warnings).toEqual([MOCK_NOTICE]);
    expect(normalized.dishes.map((dish) => dish.nutrients.calories)).toEqual([
      570, 638, 538, 750,
    ]);
  });

  it('serves every dish as one countable unit', () => {
    const normalized = normalizeMenuScan(mockMenuScan());

    expect(normalized.dishes.map((dish) => dish.portion)).toEqual([
      { count: 1, unit: 'plate', unitPlural: 'plates' },
      { count: 1, unit: 'wrap', unitPlural: 'wraps' },
      { count: 1, unit: 'bowl', unitPlural: 'bowls' },
      { count: 1, unit: 'burger', unitPlural: 'burgers' },
    ]);
  });
});

describe('MockProvider.extractMenu', () => {
  it('returns the mock menu with zero-cost mock usage', async () => {
    const provider = new MockProvider({ latencyMs: 0 });

    const result = await provider.extractMenu(REQUEST);

    expect(result.raw).toEqual(mockMenuScan());
    expect(result.model).toBe(MOCK_MODEL);
    expect(result.requestId).toBeNull();
    expect(result.usage.inputTokens).toBeGreaterThan(2 * 922);
    expect(result.usage.outputTokens).toBeGreaterThan(
      result.usage.reasoningTokens,
    );
    expect(result.usage.cachedInputTokens).toBe(0);
  });
});
