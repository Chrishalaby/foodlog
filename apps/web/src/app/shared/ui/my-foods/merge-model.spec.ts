import {
  bunSuggestion,
  ketchupSuggestion,
  mayoSuggestion,
  mergeVariant,
  myFood,
  per100,
} from '../../testing/my-foods-fixtures';
import {
  includedVariants,
  initialMergeDraft,
  keptApartNames,
  mergeCardText,
  mergePastItems,
  mergeRequest,
  mergeWays,
  mergedMessage,
  nameIsKeptApart,
  recommendedVariant,
  valuesVariant,
  withVariantIncluded,
} from './merge-model';

describe('merge model', () => {
  it('starts with every name, the recommended values and its name', () => {
    const suggestion = ketchupSuggestion();
    const draft = initialMergeDraft(suggestion);
    expect([...draft.included]).toEqual([0, 1]);
    expect(draft).toMatchObject({
      valuesFrom: 0,
      name: 'Heinz tomato ketchup',
      applyToPast: true,
    });
    expect(recommendedVariant(suggestion)?.name).toBe('Heinz tomato ketchup');
    expect(mergePastItems(suggestion, draft)).toBe(3);
  });

  it('counts the ways a food was logged from names and differing values', () => {
    expect(mergeWays(ketchupSuggestion())).toBe(3);
    expect(mergeCardText(ketchupSuggestion())).toBe(
      'Tomato ketchup was logged 3 ways (103–118 kcal/100 g). Make it one food?',
    );
    const single = ketchupSuggestion({
      variants: [mergeVariant({ timesLogged: 1, kcalPer100Min: 110, kcalPer100Max: 110 })],
    });
    expect(mergeWays(single)).toBe(1);
    expect(mergeWays(mayoSuggestion())).toBe(3);
  });

  it('does not count a saved food that was never logged as a way', () => {
    const unused = mergeVariant({
      name: 'Ketchup',
      productId: 'ketchup-id',
      timesLogged: 0,
      per100: per100({ calories: 100, carbs: 24 }),
      kcalPer100Min: 100,
      kcalPer100Max: 100,
      valueSource: 'saved',
    });
    const withSaved = ketchupSuggestion({
      variants: [unused, ...ketchupSuggestion().variants],
      kcalPer100Min: 100,
    });
    expect(mergeWays(withSaved)).toBe(3);
    expect(mergeCardText(withSaved)).toBe(
      'Tomato ketchup was logged 3 ways (100–118 kcal/100 g). Make it one food?',
    );
    expect(mergePastItems(withSaved, initialMergeDraft(withSaved))).toBe(3);
  });

  it('describes one logged way that disagrees with a saved food without a count', () => {
    const suggestion = ketchupSuggestion({
      label: 'Ketchup',
      variants: [
        mergeVariant({
          name: 'Ketchup',
          productId: 'ketchup-id',
          timesLogged: 0,
          kcalPer100Min: 100,
          kcalPer100Max: 100,
          valueSource: 'saved',
        }),
        mergeVariant({ timesLogged: 3, kcalPer100Min: 118, kcalPer100Max: 118 }),
      ],
      kcalPer100Min: 100,
      kcalPer100Max: 118,
    });
    expect(mergeWays(suggestion)).toBe(1);
    expect(mergeCardText(suggestion)).toBe(
      'Ketchup was logged with different values (100–118 kcal/100 g). Make it one food?',
    );
  });

  it('builds the request from the ticked names and the chosen values', () => {
    const suggestion = ketchupSuggestion();
    const draft = {
      ...initialMergeDraft(suggestion),
      included: new Set([1, 0]),
      valuesFrom: 1,
      name: '  Heinz   ketchup ',
      applyToPast: false,
    };
    expect(mergeRequest(suggestion, draft)).toEqual({
      key: 'tomato ketchup',
      names: ['Heinz tomato ketchup', 'Tomato ketchup'],
      name: 'Heinz ketchup',
      basisUnit: 'g',
      per100: per100({ calories: 110, carbs: 25 }),
      productId: null,
      applyToPast: false,
    });
  });

  it('leaves unticked names out and falls back to values that are still included', () => {
    const suggestion = ketchupSuggestion();
    const draft = withVariantIncluded(suggestion, initialMergeDraft(suggestion), 0, false);
    expect(includedVariants(suggestion, draft).map((variant) => variant.name)).toEqual([
      'Tomato ketchup',
    ]);
    expect(valuesVariant(suggestion, draft)?.name).toBe('Tomato ketchup');
    expect(mergePastItems(suggestion, draft)).toBe(1);
    expect(mergeRequest(suggestion, draft)).toMatchObject({
      names: ['Tomato ketchup'],
      per100: { calories: 110 },
    });
  });

  it('moves the name off a variant the user unticks to the values still kept', () => {
    const suggestion = ketchupSuggestion();
    const draft = withVariantIncluded(suggestion, initialMergeDraft(suggestion), 0, false);
    expect([...draft.included]).toEqual([1]);
    expect(draft.name).toBe('Tomato ketchup');
    expect(nameIsKeptApart(suggestion, draft)).toBe(false);
    expect(mergeRequest(suggestion, draft)).toMatchObject({
      names: ['Tomato ketchup'],
      name: 'Tomato ketchup',
      keptApart: ['Heinz tomato ketchup'],
    });
    const back = withVariantIncluded(suggestion, draft, 0, true);
    expect(back.name).toBe('Tomato ketchup');
  });

  it('keeps a name the user typed when a variant is unticked', () => {
    const suggestion = ketchupSuggestion();
    const typed = { ...initialMergeDraft(suggestion), name: 'Ketchup' };
    expect(withVariantIncluded(suggestion, typed, 0, false).name).toBe('Ketchup');
    const none = withVariantIncluded(
      suggestion,
      withVariantIncluded(suggestion, typed, 0, false),
      1,
      false,
    );
    expect(none.included.size).toBe(0);
    expect(none.name).toBe('Ketchup');
  });

  it('refuses a food name that matches a variant the user kept apart', () => {
    const suggestion = ketchupSuggestion();
    const draft = {
      ...initialMergeDraft(suggestion),
      included: new Set([0]),
      name: '  tomato   KETCHUP ',
    };
    expect(nameIsKeptApart(suggestion, draft)).toBe(true);
    expect(mergeRequest(suggestion, draft)).toBeNull();
    expect(nameIsKeptApart(suggestion, { ...draft, name: 'Heinz ketchup' })).toBe(false);
    expect(mergeRequest(suggestion, { ...draft, name: 'Heinz ketchup' })?.keptApart).toEqual([
      'Tomato ketchup',
    ]);
  });

  it('updates the saved food a group already links to', () => {
    const suggestion = ketchupSuggestion({
      variants: [
        mergeVariant({ recommended: false }),
        mergeVariant({
          name: 'Heinz ketchup',
          productId: 'food-ketchup',
          valueSource: 'saved',
          recommended: true,
        }),
      ],
    });
    const draft = { ...initialMergeDraft(suggestion), valuesFrom: 0 };
    expect(mergeRequest(suggestion, draft)?.productId).toBe('food-ketchup');
  });

  it('remembers every unticked variant by its display name so it is not suggested again', () => {
    const suggestion = ketchupSuggestion({
      key: 'mayo',
      label: 'Mayo',
      variants: [
        mergeVariant({ name: 'Heinz mayonnaise, regular', recommended: true }),
        mergeVariant({ name: 'Mayonnaise, regular', recommended: false }),
        mergeVariant({ name: 'Mayo light', recommended: false }),
      ],
    });
    const draft = {
      ...initialMergeDraft(suggestion),
      included: new Set([0]),
    };
    expect(keptApartNames(suggestion, draft)).toEqual(['Mayonnaise, regular', 'Mayo light']);
    expect(mergeRequest(suggestion, draft)?.keptApart).toEqual([
      'Mayonnaise, regular',
      'Mayo light',
    ]);
    const all = mergeRequest(suggestion, initialMergeDraft(suggestion));
    expect(all).not.toHaveProperty('keptApart');
  });

  it('sends the vitamins of the variant whose values were chosen', () => {
    const suggestion = ketchupSuggestion({
      variants: [
        mergeVariant({ microsPer100: { potassium: 281.123456, vitaminC: 7 } }),
        mergeVariant({
          name: 'Tomato ketchup',
          recommended: false,
          microsPer100: { potassium: 100 },
        }),
        mergeVariant({ name: 'Ketchup', recommended: false, microsPer100: null }),
      ],
    });
    const draft = initialMergeDraft(suggestion);
    expect(mergeRequest(suggestion, draft)?.microsPer100).toEqual({
      vitaminC: 7,
      potassium: 281.12,
    });
    expect(mergeRequest(suggestion, { ...draft, valuesFrom: 1 })?.microsPer100).toEqual({
      potassium: 100,
    });
    expect(mergeRequest(suggestion, { ...draft, valuesFrom: 2 })).not.toHaveProperty(
      'microsPer100',
    );
  });

  it('takes the values of a new duplicate that shares the saved food name', () => {
    const suggestion = bunSuggestion();
    const draft = initialMergeDraft(suggestion);
    expect(valuesVariant(suggestion, draft)).toBe(suggestion.variants[0]);
    const fresh = { ...draft, valuesFrom: 1 };
    expect(valuesVariant(suggestion, fresh)).toBe(suggestion.variants[1]);
    expect(mergeRequest(suggestion, fresh)).toEqual({
      key: 'sofisoft potato bun',
      names: ['Sofisoft potato bun'],
      name: 'Sofisoft potato bun',
      basisUnit: 'g',
      per100: per100({ calories: 320, carbs: 56 }),
      productId: 'food-bun',
      applyToPast: true,
    });
  });

  it('unticks one copy of a shared name without the other', () => {
    const suggestion = bunSuggestion();
    const draft = withVariantIncluded(suggestion, initialMergeDraft(suggestion), 1, false);
    expect([...draft.included]).toEqual([0]);
    expect(includedVariants(suggestion, draft)).toEqual([suggestion.variants[0]]);
    expect(valuesVariant(suggestion, draft)).toBe(suggestion.variants[0]);
    expect(keptApartNames(suggestion, draft)).toEqual([]);
    expect(nameIsKeptApart(suggestion, draft)).toBe(false);
    expect(draft.name).toBe('Sofisoft potato bun');
    expect(mergePastItems(suggestion, draft)).toBe(2);
    expect(mergeRequest(suggestion, draft)).toEqual({
      key: 'sofisoft potato bun',
      names: ['Sofisoft potato bun'],
      name: 'Sofisoft potato bun',
      basisUnit: 'g',
      per100: per100({ calories: 290, carbs: 50 }),
      productId: 'food-bun',
      applyToPast: true,
    });
  });

  it('keeps updating the saved food when only its new same-named copy stays ticked', () => {
    const suggestion = bunSuggestion();
    const draft = withVariantIncluded(suggestion, initialMergeDraft(suggestion), 0, false);
    expect([...draft.included]).toEqual([1]);
    expect(valuesVariant(suggestion, draft)).toBe(suggestion.variants[1]);
    expect(mergeRequest(suggestion, draft)).toMatchObject({
      names: ['Sofisoft potato bun'],
      per100: { calories: 320 },
      productId: 'food-bun',
    });
    expect(mergeRequest(suggestion, draft)).not.toHaveProperty('keptApart');
  });

  it('ignores a chosen variant that is no longer ticked', () => {
    const suggestion = bunSuggestion();
    const draft = { ...initialMergeDraft(suggestion), included: new Set([0]), valuesFrom: 1 };
    expect(valuesVariant(suggestion, draft)).toBe(suggestion.variants[0]);
    expect(valuesVariant(suggestion, { ...draft, valuesFrom: -1 })).toBe(suggestion.variants[0]);
  });

  it('refuses to merge nothing or without a name', () => {
    const suggestion = ketchupSuggestion();
    const draft = initialMergeDraft(suggestion);
    expect(mergeRequest(suggestion, { ...draft, included: new Set() })).toBeNull();
    expect(mergeRequest(suggestion, { ...draft, name: '   ' })).toBeNull();
  });

  it('tells how many past items were fixed', () => {
    const food = myFood();
    const response = { food, updatedItems: 3, updatedEntries: 2, updatedFavorites: 0 };
    expect(mergedMessage(response, true)).toBe(
      'Heinz tomato ketchup is now one food · 3 past items updated',
    );
    expect(mergedMessage({ ...response, updatedItems: 1 }, true)).toBe(
      'Heinz tomato ketchup is now one food · 1 past item updated',
    );
    expect(mergedMessage(response, false)).toBe('Heinz tomato ketchup is now one food');
  });
});
