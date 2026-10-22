import { myFood, per100 } from '../../../shared/testing/my-foods-fixtures';
import {
  addAlias,
  draftFromMyFood,
  emptyMyFoodDraft,
  microsChanged,
  microsTextFrom,
  myFoodDraftError,
  parseMicrosText,
  removeAlias,
  sameDraft,
  saveRequestFromDraft,
  updateRequestFromDraft,
  updatedMessage,
  valuesChanged,
} from './my-food-form';

describe('my food form', () => {
  const KETCHUP = myFood();

  it('starts from a saved food or an empty manual food', () => {
    expect(draftFromMyFood(KETCHUP)).toMatchObject({
      name: 'Heinz tomato ketchup',
      brand: '',
      aliases: ['Tomato ketchup'],
      unitName: 'tbsp',
      unitGrams: 15,
    });
    expect(emptyMyFoodDraft()).toMatchObject({ name: '', basisUnit: 'g', unitGrams: 0 });
  });

  it('adds aliases once and never the name itself', () => {
    let draft = draftFromMyFood(KETCHUP);
    draft = addAlias(draft, '  Ketchup ');
    expect(draft.aliases).toEqual(['Tomato ketchup', 'Ketchup']);
    expect(addAlias(draft, 'tomato  KETCHUP').aliases).toHaveLength(2);
    expect(addAlias(draft, 'Heinz tomato ketchup!').aliases).toHaveLength(2);
    expect(addAlias(draft, '   ').aliases).toHaveLength(2);
    expect(removeAlias(draft, 0).aliases).toEqual(['Ketchup']);
  });

  it('validates the name, values and unit', () => {
    const draft = draftFromMyFood(KETCHUP);
    expect(myFoodDraftError(draft)).toBeNull();
    expect(myFoodDraftError({ ...draft, name: ' ' })).toBe('Give this food a name.');
    expect(myFoodDraftError({ ...draft, per100: per100({ calories: 1200 }) })).toBe(
      'Calories per 100 g must be between 0 and 950.',
    );
    expect(myFoodDraftError({ ...draft, per100: per100({ carbs: 5, sugar: 9 }) })).toBe(
      "Sugar can't be more than carbs.",
    );
    expect(myFoodDraftError({ ...draft, unitGrams: 0 })).toContain('Give the unit a name');
    expect(myFoodDraftError({ ...draft, unitName: '', unitGrams: 0 })).toBeNull();
  });

  it('sends applyToPast only when the values change', () => {
    const draft = draftFromMyFood(KETCHUP);
    expect(valuesChanged(KETCHUP, draft)).toBe(false);
    expect(updateRequestFromDraft(KETCHUP, { ...draft, name: 'Ketchup' }, true)).not.toHaveProperty(
      'applyToPast',
    );
    const lighter = { ...draft, per100: { ...draft.per100, calories: 100 } };
    expect(valuesChanged(KETCHUP, lighter)).toBe(true);
    expect(valuesChanged(null, lighter)).toBe(false);
    expect(updateRequestFromDraft(KETCHUP, lighter, false)).toMatchObject({
      name: 'Heinz tomato ketchup',
      brand: null,
      aliases: ['Tomato ketchup'],
      unitName: 'tbsp',
      unitGrams: 15,
      applyToPast: false,
    });
  });

  it('creates manual foods and drops a half-filled unit', () => {
    const draft = { ...emptyMyFoodDraft(), name: ' Labneh ', brand: 'Taanayel ', unitName: 'x' };
    expect(saveRequestFromDraft(draft)).toEqual({
      name: 'Labneh',
      brand: 'Taanayel',
      aliases: [],
      basisUnit: 'g',
      per100: per100({}),
      unitName: null,
      unitGrams: null,
      source: 'manual',
    });
  });

  it('fills the vitamin fields from a saved food and leaves unknown ones blank', () => {
    const softgel = myFood({ microsPer100: { vitaminD: 25000, vitaminB12: 0.1235, zinc: 0 } });
    expect(draftFromMyFood(softgel).microsText).toEqual({
      vitaminD: '25000',
      vitaminB12: '0.1235',
      zinc: '0',
    });
    expect(draftFromMyFood(KETCHUP).microsText).toEqual({});
    expect(microsTextFrom(null)).toEqual({});
  });

  it('reads blank vitamin fields as unknown, a typed 0 as known and commas as decimals', () => {
    expect(parseMicrosText({ vitaminC: ' ', iron: '0', vitaminD: '12,5' })).toEqual({
      micros: { vitaminD: 12.5, iron: 0 },
      invalid: null,
    });
    expect(parseMicrosText({})).toEqual({ micros: null, invalid: null });
    expect(parseMicrosText({ iron: 'lots' })).toEqual({ micros: null, invalid: 'iron' });
    expect(parseMicrosText({ iron: '-1' })).toEqual({ micros: null, invalid: 'iron' });
    expect(parseMicrosText({ vitaminD: '100000001' }).invalid).toBe('vitaminD');
    expect(parseMicrosText({ vitaminD: '100000000' }).invalid).toBeNull();
  });

  it('names the vitamin field that is not a number', () => {
    const draft = { ...draftFromMyFood(KETCHUP), microsText: { iron: 'abc' } };
    expect(myFoodDraftError(draft)).toBe(
      'Iron per 100 g must be a number from 0 to 100,000 mg, or blank.',
    );
    expect(myFoodDraftError({ ...draft, microsText: { iron: '' } })).toBeNull();
  });

  it('saves vitamins per 100 g only when some are filled in', () => {
    const draft = { ...emptyMyFoodDraft(), name: 'Soy milk', basisUnit: 'ml' as const };
    expect(saveRequestFromDraft(draft)).not.toHaveProperty('microsPer100');
    expect(
      saveRequestFromDraft({ ...draft, microsText: { calcium: '120', vitaminD: '1.5' } }),
    ).toMatchObject({ basisUnit: 'ml', microsPer100: { calcium: 120, vitaminD: 1.5 } });
  });

  it('sends changed vitamins, clears removed ones and offers to update past logs', () => {
    const softgel = myFood({ microsPer100: { vitaminD: 25000 } });
    const draft = draftFromMyFood(softgel);
    expect(microsChanged(softgel, draft)).toBe(false);
    expect(updateRequestFromDraft(softgel, draft, true)).not.toHaveProperty('microsPer100');
    expect(sameDraft(draft, { ...draft, microsText: { vitaminD: '25000.00' } })).toBe(true);

    const stronger = { ...draft, microsText: { vitaminD: '50000' } };
    expect(valuesChanged(softgel, stronger)).toBe(true);
    expect(sameDraft(draft, stronger)).toBe(false);
    expect(updateRequestFromDraft(softgel, stronger, true)).toMatchObject({
      microsPer100: { vitaminD: 50000 },
      applyToPast: true,
    });

    const cleared = { ...draft, microsText: { vitaminD: '' } };
    expect(updateRequestFromDraft(softgel, cleared, false)).toMatchObject({
      microsPer100: null,
      applyToPast: false,
    });
  });

  it('spots real edits and reports past items updated', () => {
    const draft = draftFromMyFood(KETCHUP);
    expect(sameDraft(draft, { ...draft, name: 'Heinz tomato ketchup ' })).toBe(true);
    expect(sameDraft(draft, { ...draft, brand: 'Heinz' })).toBe(false);
    const response = { food: KETCHUP, updatedItems: 4, updatedEntries: 3, updatedFavorites: 1 };
    expect(updatedMessage(response)).toBe('Updated Heinz tomato ketchup · 4 past items updated');
    expect(updatedMessage({ ...response, updatedItems: 0 })).toBe('Updated Heinz tomato ketchup');
  });
});
