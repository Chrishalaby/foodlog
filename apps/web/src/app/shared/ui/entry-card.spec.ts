import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type AnalysisPhotoRef, type EntryDto, type PhotoRef } from '@food/shared';
import { EntryCard } from './entry-card';

const photo = (id: string): PhotoRef => ({
  id,
  url: `/api/photos/${id}`,
  thumbUrl: `/api/photos/${id}/thumb`,
  width: 1344,
  height: 1792,
});

const PHOTOS: AnalysisPhotoRef[] = [
  { photo: photo('food-1'), role: 'food' },
  { photo: photo('label-1'), role: 'label' },
  { photo: photo('food-2'), role: 'food' },
];

const ENTRY: EntryDto = {
  portion: null,
  id: 'entry-1',
  name: 'Labneh plate',
  description: null,
  mealType: 'breakfast',
  source: 'food_photo',
  timestamp: '2026-09-30T06:15:00.000Z',
  localDate: '2026-09-30',
  items: [],
  totals: { ...zeroNutrients(), calories: 320, protein: 14, carbs: 22, fat: 19 },
  photo: PHOTOS[1]!.photo,
  photos: PHOTOS,
  analysisId: 'analysis-1',
  favoriteId: null,
  productId: null,
  createdAt: '2026-09-30T06:15:00.000Z',
  updatedAt: '2026-09-30T06:15:00.000Z',
};

@Component({
  imports: [EntryCard],
  template: `<app-entry-card [entry]="entry()" [showActions]="false" />`,
})
class Host {
  readonly entry = signal<EntryDto>(ENTRY);
}

describe('EntryCard photos', () => {
  async function render(entry: EntryDto) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.entry.set(entry);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      thumb: el.querySelector('img'),
      badge: el.querySelector('[role="img"]'),
      summary: el.querySelector('button')?.getAttribute('aria-label') ?? '',
    };
  }

  it('shows the cover with a badge counting the other photos', async () => {
    const { thumb, badge, summary } = await render(ENTRY);
    expect(thumb?.getAttribute('src')).toBe('/api/photos/label-1/thumb');
    expect(badge?.textContent?.trim()).toBe('+2');
    expect(badge?.getAttribute('aria-label')).toBe('3 photos');
    expect(summary).toMatch(/^Labneh plate, Breakfast, .+, 320 kcal, .+, 3 photos$/);
  });

  it('shows no badge for a single photo', async () => {
    const { thumb, badge, summary } = await render({
      ...ENTRY,
      photo: PHOTOS[0]!.photo,
      photos: PHOTOS.slice(0, 1),
    });
    expect(thumb?.getAttribute('src')).toBe('/api/photos/food-1/thumb');
    expect(badge).toBeNull();
    expect(summary).not.toContain('photo');
  });

  it('falls back to the first photo when the cover is missing', async () => {
    const { thumb, badge } = await render({ ...ENTRY, photo: null, photos: PHOTOS.slice(0, 2) });
    expect(thumb?.getAttribute('src')).toBe('/api/photos/food-1/thumb');
    expect(badge?.getAttribute('aria-label')).toBe('2 photos');
  });

  it('counts a cover that is missing from the photo list', async () => {
    const { thumb, badge } = await render({
      ...ENTRY,
      photo: photo('older-cover'),
      photos: PHOTOS.slice(0, 1),
    });
    expect(thumb?.getAttribute('src')).toBe('/api/photos/older-cover/thumb');
    expect(badge?.textContent?.trim()).toBe('+1');
    expect(badge?.getAttribute('aria-label')).toBe('2 photos');
  });

  it('shows the source icon for an entry without photos', async () => {
    const { thumb, badge } = await render({ ...ENTRY, photo: null, photos: [] });
    expect(thumb).toBeNull();
    expect(badge).toBeNull();
  });
});

describe('EntryCard amounts', () => {
  const item = (name: string, grams: number) => ({
    id: `item-${name}`,
    position: 0,
    name,
    grams,
    nutrients: zeroNutrients(),
    confidence: null,
    count: null,
    unit: null,
    unitPlural: null,
    productId: null,
    micros: null,
    fluidMl: null,
  });

  async function render(entry: EntryDto) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.entry.set(entry);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return {
      amount: el.querySelector('[data-entry-amount]')?.textContent?.trim() ?? null,
      summary: el.querySelector('button')?.getAttribute('aria-label') ?? '',
    };
  }

  it('shows how many were eaten before the grams', async () => {
    const { amount, summary } = await render({
      ...ENTRY,
      name: 'Black Angus burgers',
      items: [item('Patty', 400), item('Bun', 380)],
      totals: { ...zeroNutrients(), calories: 1450 },
      portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
    });
    expect(amount).toBe('2 burgers · 780 g');
    expect(summary).toContain('2 burgers · 780 g, 1,450 kcal');
  });

  it('shows only the grams without a portion and nothing without a weight', async () => {
    expect((await render({ ...ENTRY, items: [item('Labneh', 180)] })).amount).toBe('180 g');
    expect((await render(ENTRY)).amount).toBeNull();
  });
});
