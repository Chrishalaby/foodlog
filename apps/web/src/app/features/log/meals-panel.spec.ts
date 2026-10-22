import { mealsDayText, mealsTitle, saveMealsLabel } from './meals-panel';

describe('meals panel copy', () => {
  it('counts the meals in the title and on the save button', () => {
    expect(mealsTitle(3)).toBe('3 meals found');
    expect(mealsTitle(1)).toBe('1 meal left');
    expect(saveMealsLabel(3)).toBe('Save 3 meals');
    expect(saveMealsLabel(1)).toBe('Save meal');
  });

  it('names the eating day the meals share', () => {
    expect(mealsDayText('2026-10-04', '2026-10-04')).toBe('Eaten today');
    expect(mealsDayText('2026-10-03', '2026-10-04')).toBe('Eaten yesterday');
    expect(mealsDayText('2026-09-30', '2026-10-04')).toBe('Eaten on Wed 30 Sep');
    expect(mealsDayText(null, '2026-10-04')).toBe('Eaten on different days');
  });
});
