import { API_LIMITS } from '@food/shared';
import { YOGURT, myFood } from '../testing/my-foods-fixtures';
import { savedFoodItemName, savedFoodRef } from './saved-foods';

describe('savedFoodItemName', () => {
  it('uses the plain name when the food has no brand', () => {
    expect(savedFoodItemName(myFood())).toBe('Heinz tomato ketchup');
    expect(savedFoodItemName({ name: '  Tomato   ketchup ', brand: '  ' })).toBe('Tomato ketchup');
  });

  it('puts the brand in front like the API does for linked items', () => {
    expect(savedFoodItemName({ name: 'Strawberry Greek yogurt, low fat', brand: 'Khoury' })).toBe(
      'Khoury Strawberry Greek yogurt, low fat',
    );
    expect(savedFoodItemName(savedFoodRef({ ...YOGURT, name: 'Labneh' }))).toBe('Khoury Labneh');
  });

  it('does not repeat a brand the name already starts with', () => {
    expect(savedFoodItemName(YOGURT)).toBe('Khoury strawberry Greek yogurt, low fat');
    expect(savedFoodItemName({ name: 'KHOURY labneh', brand: 'Khoury' })).toBe('KHOURY labneh');
    expect(savedFoodItemName({ name: 'Crème fraîche', brand: 'creme' })).toBe('Crème fraîche');
  });

  it('only treats a whole leading word as the brand', () => {
    expect(savedFoodItemName({ name: 'Khourys yogurt', brand: 'Khoury' })).toBe(
      'Khoury Khourys yogurt',
    );
  });

  it('keeps the composed name within the name limit', () => {
    const name = savedFoodItemName({ name: 'y'.repeat(API_LIMITS.nameMax), brand: 'Khoury' });
    expect(Array.from(name)).toHaveLength(API_LIMITS.nameMax);
    expect(name.startsWith('Khoury ')).toBe(true);
  });
});
