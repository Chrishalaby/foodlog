import { type GroupNode, groupComparableNodes } from './food-groups.js';
import { toFoodName } from './food-names.js';

function node(name: string, weight: number): GroupNode {
  return { id: name, names: [toFoodName(name)], weight };
}

function groupedIds(nodes: GroupNode[]): string[][] {
  return groupComparableNodes(nodes)
    .map((group) => group.map(({ id }) => id).sort())
    .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}

describe('groupComparableNodes', () => {
  it('groups the owner names into ketchup, mayo and bun groups', () => {
    const nodes = [
      node('Heinz tomato ketchup', 2),
      node('Tomato ketchup', 1),
      node('Heinz mayonnaise', 2),
      node('Mayonnaise', 1),
      node('Garlic mayonnaise sauce', 1),
      node('Sofisoft potato bun', 1),
      node('Sofisoft potato bun, top hollowed', 2),
      node('Chicken breast cooked skinless', 1),
      node('Chicken breast grilled', 1),
    ];

    expect(groupedIds(nodes)).toEqual([
      ['Chicken breast cooked skinless'],
      ['Chicken breast grilled'],
      ['Garlic mayonnaise sauce'],
      ['Heinz mayonnaise', 'Mayonnaise'],
      ['Heinz tomato ketchup', 'Tomato ketchup'],
      ['Sofisoft potato bun', 'Sofisoft potato bun, top hollowed'],
    ]);
  });

  it('never puts two incomparable names in one group and prefers the pairing with more logged items', () => {
    const toasted = [
      node('Potato bun', 3),
      node('Sofisoft potato bun', 1),
      node('Potato bun, toasted', 2),
    ];
    expect(groupedIds(toasted)).toEqual([
      ['Potato bun', 'Potato bun, toasted'],
      ['Sofisoft potato bun'],
    ]);

    const branded = [
      node('Potato bun', 3),
      node('Sofisoft potato bun', 4),
      node('Potato bun, toasted', 2),
    ];
    expect(groupedIds(branded)).toEqual([
      ['Potato bun', 'Sofisoft potato bun'],
      ['Potato bun, toasted'],
    ]);
  });

  it('keeps a plain food out of the condiment made from it', () => {
    const nodes = [
      node('Heinz tomato ketchup', 2),
      node('Tomato ketchup', 1),
      node('Tomato', 3),
    ];

    expect(groupedIds(nodes)).toEqual([
      ['Heinz tomato ketchup', 'Tomato ketchup'],
      ['Tomato'],
    ]);
  });

  it('joins a node through any of its names', () => {
    const saved: GroupNode = {
      id: 'saved',
      names: [
        toFoodName('Heinz ketchup, squeeze bottle'),
        toFoodName('Tomato ketchup'),
      ],
      weight: 1,
    };
    expect(groupedIds([saved, node('Ketchup', 1)])).toEqual([
      ['Ketchup', 'saved'],
    ]);
  });

  it('keeps unrelated names apart and is deterministic', () => {
    const nodes = [node('Apple', 1), node('Banana', 1), node('Apple', 1)];
    expect(groupComparableNodes(nodes)).toHaveLength(2);
    expect(groupedIds([node('Pear', 1)])).toEqual([['Pear']]);
    expect(groupComparableNodes([])).toEqual([]);
  });
});
