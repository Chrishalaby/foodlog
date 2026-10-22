import { MAYO, YOGURT, myFood } from '../testing/my-foods-fixtures';
import {
  compatibleNames,
  exactSavedFood,
  findSavedFood,
  foodTokens,
  normalizeFoodName,
  sameNormalizedName,
  searchSavedFoods,
  singularize,
} from './food-match';

const KETCHUP = myFood({ aliases: [] });
const BUN = myFood({ id: 'food-bun', name: 'Sofisoft potato bun', aliases: [] });
const CABBAGE = myFood({ id: 'food-cabbage', name: 'Cabbage, raw shredded', aliases: [] });
const CHICKEN = myFood({
  id: 'food-chicken',
  name: 'Chicken breast, cooked, skinless',
  aliases: [],
});
const SALT = myFood({ id: 'food-salt', name: 'Table salt', aliases: [] });
const CUCUMBER = myFood({ id: 'food-cucumber', name: 'Cucumber, raw, with peel', aliases: [] });
const FOODS = [KETCHUP, MAYO, BUN, CABBAGE, CHICKEN, SALT, CUCUMBER, YOGURT];

describe('food name normalization', () => {
  it('lowercases, strips accents and punctuation and drops filler words', () => {
    expect(normalizeFoodName('  Crème  fraîche, the ORIGINAL ')).toBe('creme fraiche');
    expect(normalizeFoodName('Mayonnaise, regular')).toBe('mayo');
    expect(normalizeFoodName('Heinz Catsup')).toBe('heinz ketchup');
    expect(normalizeFoodName('Greek yoghurt, plain')).toBe('greek yogurt');
    expect(normalizeFoodName('Some fresh homemade tomatoes')).toBe('tomato');
  });

  it('singularizes simple plurals without touching short or odd words', () => {
    expect(singularize('pickles')).toBe('pickle');
    expect(singularize('berries')).toBe('berry');
    expect(singularize('potatoes')).toBe('potato');
    expect(singularize('sandwiches')).toBe('sandwich');
    expect(singularize('hummus')).toBe('hummus');
    expect(singularize('glass')).toBe('glass');
    expect(singularize('peas')).toBe('pea');
    expect(singularize('gas')).toBe('gas');
    expect(foodTokens('Cucumber pickles')).toEqual(['cucumber', 'pickle']);
  });

  it('treats different punctuation of the same name as one name', () => {
    expect(sameNormalizedName('Cabbage, raw shredded', 'Cabbage, raw, shredded')).toBe(true);
    expect(sameNormalizedName('Heinz mayonnaise, regular', 'Heinz mayo')).toBe(true);
    expect(sameNormalizedName('', '')).toBe(false);
  });

  it('keeps non-Latin names, drops apostrophes, repeats and servings suffixes like the server', () => {
    expect(normalizeFoodName('لبنة طازجة')).toBe('لبنة طازجة');
    expect(sameNormalizedName('لبنة', ' لبنة ')).toBe(true);
    expect(normalizeFoodName("McDonald's fries")).toBe('mcdonald fry');
    expect(normalizeFoodName('Ketchup, ketchup')).toBe('ketchup');
    expect(normalizeFoodName('Tomato ketchup ×2')).toBe('tomato ketchup');
    expect(normalizeFoodName('Smørrebrød')).toBe('smorrebrod');
  });
});

describe('compatibleNames', () => {
  it('joins the owner’s variants of the same bottle or bun', () => {
    expect(compatibleNames('Heinz tomato ketchup', 'Tomato ketchup')).toBe(true);
    expect(compatibleNames('Heinz mayonnaise, regular', 'Mayonnaise, regular')).toBe(true);
    expect(compatibleNames('Sofisoft potato bun', 'Sofisoft potato bun, top hollowed')).toBe(true);
    expect(compatibleNames('Added table salt', 'Table salt')).toBe(true);
  });

  it('keeps different foods apart', () => {
    expect(compatibleNames('Garlic mayonnaise sauce', 'Mayonnaise, regular')).toBe(false);
    expect(compatibleNames('Garlic mayonnaise sauce', 'Heinz mayonnaise, regular')).toBe(false);
    expect(compatibleNames('Chicken breast, grilled', 'Chicken breast, cooked, skinless')).toBe(
      false,
    );
    expect(compatibleNames('Cucumber pickles', 'Cucumber')).toBe(false);
    expect(compatibleNames('Cucumber pickles', 'Cucumber, raw, with peel')).toBe(false);
    expect(compatibleNames('Light mayonnaise', 'Mayonnaise')).toBe(false);
    expect(compatibleNames('Beef burger', 'Chicken beef burger')).toBe(false);
    expect(compatibleNames('Black Angus beef burger with ketchup', 'Ketchup')).toBe(false);
  });

  it('never offers a flavour, a different base food or another strength as the same food', () => {
    expect(compatibleNames('Strawberry yogurt', 'Yogurt')).toBe(false);
    expect(compatibleNames('Chocolate milk', 'Milk')).toBe(false);
    expect(compatibleNames('Tomato', 'Heinz tomato ketchup')).toBe(false);
    expect(compatibleNames('Burger', 'Beef burger')).toBe(false);
    expect(compatibleNames('Milk 3%', 'Milk')).toBe(false);
    expect(compatibleNames('Smoked salmon', 'Salmon')).toBe(false);
    expect(compatibleNames('Ketchup', 'Heinz tomato ketchup')).toBe(true);
    expect(compatibleNames('Tomato ketchup, Heinz', 'Heinz tomato ketchup')).toBe(true);
  });

  it('groups the owner’s logged names only where they are the same food', () => {
    const names = [
      'Heinz tomato ketchup',
      'Tomato ketchup',
      'Heinz mayonnaise, regular',
      'Mayonnaise, regular',
      'Garlic mayonnaise sauce',
      'Sofisoft potato bun',
      'Sofisoft potato bun, top hollowed',
      'Cabbage, raw shredded',
      'Cabbage, raw, shredded',
      'Chicken breast, cooked, skinless',
      'Chicken breast, grilled',
      'Cucumber pickles',
      'Cucumber, raw, with peel',
      'Khoury strawberry Greek yogurt, low fat',
    ];
    const pairs = names.flatMap((a, index) =>
      names
        .slice(index + 1)
        .filter((b) => compatibleNames(a, b))
        .map((b) => `${a} + ${b}`),
    );
    expect(pairs).toEqual([
      'Heinz tomato ketchup + Tomato ketchup',
      'Heinz mayonnaise, regular + Mayonnaise, regular',
      'Sofisoft potato bun + Sofisoft potato bun, top hollowed',
      'Cabbage, raw shredded + Cabbage, raw, shredded',
    ]);
  });
});

describe('finding a saved food', () => {
  it('matches a name or alias exactly first', () => {
    expect(exactSavedFood('Mayonnaise, regular', FOODS)).toBe(MAYO);
    expect(exactSavedFood('Cabbage, raw, shredded', FOODS)).toBe(CABBAGE);
    const labneh = myFood({ id: 'food-labneh', name: 'Labneh', brand: 'Taanayel', aliases: [] });
    expect(exactSavedFood('Taanayel labneh', [...FOODS, labneh])).toBe(labneh);
    expect(exactSavedFood('Ketchup', FOODS)).toBeNull();
  });

  it('falls back to the closest compatible name', () => {
    expect(findSavedFood('Tomato ketchup', FOODS)).toBe(KETCHUP);
    expect(findSavedFood('Sofisoft potato bun, top hollowed', FOODS)).toBe(BUN);
    expect(findSavedFood('Added table salt', FOODS)).toBe(SALT);
    expect(findSavedFood('Garlic mayonnaise sauce', FOODS)).toBeNull();
    expect(findSavedFood('Chicken breast, grilled', FOODS)).toBeNull();
    expect(findSavedFood('Cucumber pickles', FOODS)).toBeNull();
    expect(findSavedFood('   ', FOODS)).toBeNull();
  });

  it('offers nothing for a flavour of a saved food', () => {
    const yogurt = myFood({ id: 'food-plain-yogurt', name: 'Greek yogurt', aliases: [] });
    expect(findSavedFood('Strawberry Greek yogurt', [yogurt])).toBeNull();
    expect(findSavedFood('Tomato', FOODS)).toBeNull();
    expect(findSavedFood('Greek yogurt', [yogurt])).toBe(yogurt);
  });

  it('reuses the tokens of an unchanged saved food', () => {
    const foods = [KETCHUP, MAYO];
    expect(findSavedFood('Ketchup', foods)).toBe(KETCHUP);
    const renamed = { ...KETCHUP, aliases: ['Red sauce'] };
    expect(findSavedFood('Red sauce', [renamed, MAYO])).toBe(renamed);
    expect(findSavedFood('Red sauce', foods)).toBeNull();
  });

  it('prefers the saved food with the fewest extra words', () => {
    const squeezed = myFood({ id: 'food-squeezed', name: 'Heinz tomato ketchup, squeezed' });
    expect(findSavedFood('Tomato ketchup', [{ ...squeezed, aliases: [] }, KETCHUP])).toBe(KETCHUP);
  });

  it('searches names, brands and aliases', () => {
    expect(searchSavedFoods(FOODS, 'mayo reg').map((food) => food.id)).toEqual(['food-mayo']);
    expect(searchSavedFoods(FOODS, 'khoury').map((food) => food.id)).toEqual(['food-yogurt']);
    expect(searchSavedFoods(FOODS, '  ')).toHaveLength(FOODS.length);
    expect(searchSavedFoods(FOODS, 'crème')).toEqual([]);
  });
});
