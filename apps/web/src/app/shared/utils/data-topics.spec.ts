import { quickLogTopics } from './data-topics';

describe('quickLogTopics', () => {
  it('adds products for a product result so product views refresh', () => {
    expect(quickLogTopics({ kind: 'product' })).toEqual(['entries', 'favorites', 'products']);
    expect(quickLogTopics({ kind: 'meal' })).toEqual(['entries', 'favorites']);
    expect(quickLogTopics({ kind: 'favorite' })).toEqual(['entries', 'favorites']);
    expect(quickLogTopics({ kind: 'food' })).toEqual(['entries', 'favorites']);
  });
});
