export const VISION_PATCH_PX = 32;
export const VISION_MAX_PATCHES = 2400;
export const VISION_MAX_SIDE_PX = 2048;

export interface ImageSize {
  width: number;
  height: number;
}

export interface PatchBudget {
  patchPx: number;
  maxPatches: number;
  maxSidePx: number;
}

export const VISION_PATCH_BUDGET: PatchBudget = {
  patchPx: VISION_PATCH_PX,
  maxPatches: VISION_MAX_PATCHES,
  maxSidePx: VISION_MAX_SIDE_PX,
};

export function patchCount(size: ImageSize, patchPx: number = VISION_PATCH_PX): number {
  return Math.ceil(size.width / patchPx) * Math.ceil(size.height / patchPx);
}

function scaled(size: ImageSize, factor: number): ImageSize {
  return {
    width: Math.max(1, Math.round(size.width * factor)),
    height: Math.max(1, Math.round(size.height * factor)),
  };
}

export function fitToPatchBudget(size: ImageSize, budget: PatchBudget = VISION_PATCH_BUDGET): ImageSize {
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const original = { width, height };
  const bySide = budget.maxSidePx / Math.max(width, height);
  const byArea = Math.sqrt((budget.maxPatches * budget.patchPx * budget.patchPx) / (width * height));
  let factor = Math.min(1, bySide, byArea);
  let result = factor >= 1 ? original : scaled(original, factor);
  while (patchCount(result, budget.patchPx) > budget.maxPatches && factor > 0.01) {
    factor *= 0.99;
    result = scaled(original, factor);
  }
  return result;
}
