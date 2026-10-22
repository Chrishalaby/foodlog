import { zeroNutrients, type AnalysisPhotoRef, type EntryDto, type PhotoRef } from '@food/shared';
import {
  coverIndex,
  coverUpdateRequest,
  entryPhotoRefs,
  findPhoto,
  photoAlt,
  photoCountLabel,
  viewerPhotos,
} from './entry-photos';

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
];

function entry(overrides: Partial<EntryDto> = {}): EntryDto {
  return {
    portion: null,
    id: 'entry-1',
    name: 'Labneh plate',
    description: null,
    mealType: 'breakfast',
    source: 'food_photo',
    timestamp: '2026-09-30T06:15:00.000Z',
    localDate: '2026-09-30',
    items: [
      {
        count: null,
        unit: null,
        unitPlural: null,
        id: 'item-1',
        position: 0,
        name: 'Labneh',
        grams: 60,
        nutrients: { ...zeroNutrients(), calories: 96, protein: 4.8 },
        confidence: 'high',
        productId: null,
        micros: null,
        fluidMl: null,
      },
    ],
    totals: { ...zeroNutrients(), calories: 96, protein: 4.8 },
    photo: PHOTOS[0]!.photo,
    photos: PHOTOS,
    analysisId: 'analysis-1',
    favoriteId: null,
    productId: null,
    createdAt: '2026-09-30T06:15:00.000Z',
    updatedAt: '2026-09-30T06:15:00.000Z',
    ...overrides,
  };
}

describe('entry photos', () => {
  it('counts photos in words', () => {
    expect(photoCountLabel(1)).toBe('1 photo');
    expect(photoCountLabel(3)).toBe('3 photos');
  });

  it('lists every entry photo in order', () => {
    expect(entryPhotoRefs(entry())).toBe(PHOTOS);
    expect(entryPhotoRefs(entry({ photo: null, photos: [] }))).toEqual([]);
  });

  it('adds a cover that is missing from the photo list after the other photos', () => {
    const cover = photo('older-cover');
    expect(entryPhotoRefs(entry({ photo: cover }))).toEqual([
      ...PHOTOS,
      { photo: cover, role: 'food' },
    ]);
  });

  it('falls back to the cover alone when an entry has no photo list', () => {
    const cover = photo('legacy');
    expect(entryPhotoRefs(entry({ photo: cover, photos: [] }))).toEqual([
      { photo: cover, role: 'food' },
    ]);
    expect(entryPhotoRefs(entry({ photo: cover, photos: [], source: 'nutrition_label' }))).toEqual([
      { photo: cover, role: 'label' },
    ]);
  });

  it('describes each photo by its role and meal for the viewer', () => {
    expect(photoAlt('label', ' Labneh plate ')).toBe('Label photo of Labneh plate');
    expect(photoAlt('food', '')).toBe('Food photo');
    expect(viewerPhotos(PHOTOS, 'Labneh plate')).toEqual([
      {
        id: 'food-1',
        url: '/api/photos/food-1',
        alt: 'Food photo of Labneh plate',
        caption: 'Food',
      },
      {
        id: 'label-1',
        url: '/api/photos/label-1',
        alt: 'Label photo of Labneh plate',
        caption: 'Label',
      },
    ]);
  });

  it('finds the cover and its position, starting at the first photo when it is missing', () => {
    expect(coverIndex(PHOTOS, 'label-1')).toBe(1);
    expect(coverIndex(PHOTOS, 'gone')).toBe(0);
    expect(coverIndex([], null)).toBe(0);
    expect(findPhoto(PHOTOS, 'label-1')).toBe(PHOTOS[1]!.photo);
    expect(findPhoto(PHOTOS, null)).toBeNull();
  });

  it('copies the saved items exactly so a cover change never re-rounds them', () => {
    const exact = entry({
      items: [
        {
          count: null,
          unit: null,
          unitPlural: null,
          id: 'item-1',
          position: 0,
          name: 'Oats',
          grams: 43.333,
          nutrients: { ...zeroNutrients(), calories: 164.66666, protein: 5.7199 },
          confidence: null,
          productId: null,
          micros: null,
          fluidMl: null,
        },
      ],
    });
    expect(coverUpdateRequest(exact, 'label-1').items).toEqual([
      {
        name: 'Oats',
        grams: 43.333,
        nutrients: { ...zeroNutrients(), calories: 164.66666, protein: 5.7199 },
        confidence: null,
        count: null,
        unit: null,
        unitPlural: null,
      },
    ]);
  });

  it('keeps counts and the portion when only the cover changes', () => {
    const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };
    const counted = entry({
      portion: burgers,
      items: [
        {
          id: 'item-1',
          position: 0,
          name: 'Beef patty',
          grams: 300,
          nutrients: { ...zeroNutrients(), calories: 750 },
          confidence: 'high',
          count: 2,
          unit: 'patty',
          unitPlural: 'patties',
          productId: null,
          micros: null,
          fluidMl: null,
        },
      ],
    });
    const body = coverUpdateRequest(counted, 'label-1');
    expect(body.portion).toEqual(burgers);
    expect(body.items[0]).toMatchObject({ count: 2, unit: 'patty', unitPlural: 'patties' });
  });

  it('keeps saved-food links when only the cover changes', () => {
    const linked = entry();
    const [labneh] = linked.items;
    const body = coverUpdateRequest(
      { ...linked, items: [{ ...labneh!, productId: 'food-labneh' }] },
      'label-1',
    );
    expect(body.items[0]).toMatchObject({ name: 'Labneh', productId: 'food-labneh' });
  });

  it('keeps vitamins and drink ml when only the cover changes', () => {
    const base = entry();
    const [labneh] = base.items;
    const body = coverUpdateRequest(
      {
        ...base,
        items: [
          { ...labneh!, micros: { calcium: 66, vitaminA: 0 } },
          { ...labneh!, id: 'item-2', name: 'Soy milk', micros: null, fluidMl: 250 },
        ],
      },
      'label-1',
    );
    expect(body.items[0]).toMatchObject({ micros: { calcium: 66, vitaminA: 0 } });
    expect(body.items[0]).not.toHaveProperty('fluidMl');
    expect(body.items[1]).toMatchObject({ fluidMl: 250 });
    expect(body.items[1]).not.toHaveProperty('micros');
  });

  it('builds an update that only changes the cover of the saved entry', () => {
    expect(coverUpdateRequest(entry(), 'label-1')).toEqual({
      name: 'Labneh plate',
      description: null,
      mealType: 'breakfast',
      timestamp: '2026-09-30T06:15:00.000Z',
      localDate: '2026-09-30',
      items: [
        {
          name: 'Labneh',
          grams: 60,
          nutrients: { ...zeroNutrients(), calories: 96, protein: 4.8 },
          confidence: 'high',
          count: null,
          unit: null,
          unitPlural: null,
        },
      ],
      portion: null,
      coverPhotoId: 'label-1',
    });
  });
});
