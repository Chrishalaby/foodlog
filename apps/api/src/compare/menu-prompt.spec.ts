import { API_LIMITS } from '@food/shared';
import { buildMenuUserMessage, MENU_INSTRUCTIONS } from './menu-prompt.js';

describe('MENU_INSTRUCTIONS', () => {
  it('asks for orderable dishes only, ignoring prices, categories and drinks', () => {
    expect(MENU_INSTRUCTIONS).toContain('can actually be ordered');
    expect(MENU_INSTRUCTIONS).toContain('Ignore prices, section headings');
    expect(MENU_INSTRUCTIONS).toContain('Skip drinks (');
    expect(MENU_INSTRUCTIONS).toContain('the photos show only drinks');
    expect(MENU_INSTRUCTIONS).toContain(
      `List at most ${API_LIMITS.menuDishesMax} dishes`,
    );
  });

  it('estimates a restaurant serving as served, including hidden fats and sauces', () => {
    expect(MENU_INSTRUCTIONS).toContain('typical restaurant serving as served');
    expect(MENU_INSTRUCTIONS).toContain('cooking oil or butter');
    expect(MENU_INSTRUCTIONS).toContain('sauces');
    expect(MENU_INSTRUCTIONS).toContain(
      'carbs_g = total carbohydrate INCLUDING fiber',
    );
  });

  it('treats the description as ground truth for ordering and goals as context only', () => {
    expect(MENU_INSTRUCTIONS).toContain('is ground truth');
    expect(MENU_INSTRUCTIONS).toContain('"half portion" = half of everything');
    expect(MENU_INSTRUCTIONS).toContain('are context only');
    expect(MENU_INSTRUCTIONS).toContain('never change the estimates');
  });

  it('never refuses and keeps the output terse', () => {
    expect(MENU_INSTRUCTIONS).toContain('Never refuse');
    expect(MENU_INSTRUCTIONS).toContain('Keep text terse');
  });
});

describe('buildMenuUserMessage', () => {
  it('describes a single photo without a description', () => {
    expect(
      buildMenuUserMessage({
        description: null,
        imageCount: 1,
        location: null,
      }),
    ).toBe(
      [
        'Mode: menu. List the dishes that can be ordered from the attached menu photo.',
        'User description: none',
      ].join('\n'),
    );
  });

  it('quotes the description and location and notes that photos share one menu', () => {
    const message = buildMenuUserMessage({
      description: 'Half portion. I want something "high protein"',
      imageCount: 3,
      location: '  Beirut, Lebanon ',
    });

    expect(message.split('\n')).toEqual([
      'Mode: menu. List the dishes that can be ordered from the 3 attached menu photos.',
      'All photos show the same menu.',
      'Location: "Beirut, Lebanon"',
      'User description (ground truth for how they will order): "Half portion. I want something \\"high protein\\""',
    ]);
  });

  it('ignores a blank location', () => {
    expect(
      buildMenuUserMessage({ description: 'x', imageCount: 1, location: '  ' }),
    ).not.toContain('Location');
  });
});
