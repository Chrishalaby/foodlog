import { describe, expect, it } from 'vitest';
import { fitToPatchBudget, patchCount, VISION_MAX_PATCHES, VISION_MAX_SIDE_PX } from './images.js';

describe('fitToPatchBudget', () => {
  it('shrinks a 12 MP 3:4 phone photo to just under the patch budget', () => {
    const size = fitToPatchBudget({ width: 3024, height: 4032 });
    expect(patchCount(size)).toBeLessThanOrEqual(VISION_MAX_PATCHES);
    expect(patchCount(size)).toBeGreaterThan(VISION_MAX_PATCHES * 0.95);
    expect(size.width / size.height).toBeCloseTo(3024 / 4032, 2);
  });

  it('caps tall photos by the longest side', () => {
    const size = fitToPatchBudget({ width: 1440, height: 2560 });
    expect(size).toEqual({ width: 1152, height: 2048 });
    expect(patchCount(size)).toBeLessThanOrEqual(VISION_MAX_PATCHES);
  });

  it('keeps photos that already fit untouched', () => {
    expect(fitToPatchBudget({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
    expect(fitToPatchBudget({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('never exceeds the longest-side limit for wide panoramas', () => {
    const size = fitToPatchBudget({ width: 8000, height: 1000 });
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(VISION_MAX_SIDE_PX);
    expect(patchCount(size)).toBeLessThanOrEqual(VISION_MAX_PATCHES);
  });
});
