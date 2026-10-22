import { areComparableFoodNames, type FoodName } from './food-names.js';

export interface GroupNode {
  id: string;
  names: readonly FoodName[];
  weight: number;
}

interface Pairing {
  left: number;
  right: number;
  weight: number;
}

export function areComparableNodes(a: GroupNode, b: GroupNode): boolean {
  return a.names.some((left) =>
    b.names.some((right) => areComparableFoodNames(left, right)),
  );
}

function nodeTokens(node: GroupNode): Set<string> {
  return new Set(node.names.flatMap((name) => [...name.tokens]));
}

function indexByToken(nodes: readonly GroupNode[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  nodes.forEach((node, position) => {
    for (const token of nodeTokens(node)) {
      const positions = index.get(token);
      if (positions) {
        positions.push(position);
      } else {
        index.set(token, [position]);
      }
    }
  });
  return index;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePairings(
  nodes: readonly GroupNode[],
): (a: Pairing, b: Pairing) => number {
  const idOf = (position: number) => nodes[position]?.id ?? '';
  return (a, b) =>
    b.weight - a.weight ||
    compareIds(idOf(a.left), idOf(b.left)) ||
    compareIds(idOf(a.right), idOf(b.right));
}

export type NodeComparator<T extends GroupNode> = (a: T, b: T) => boolean;

class Comparisons<T extends GroupNode> {
  private readonly cache = new Map<string, boolean>();

  constructor(
    private readonly nodes: readonly T[],
    private readonly compare: NodeComparator<T>,
  ) {}

  comparable(a: number, b: number): boolean {
    if (a === b) {
      return true;
    }
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const left = this.nodes[a];
    const right = this.nodes[b];
    const result =
      left !== undefined && right !== undefined && this.compare(left, right);
    this.cache.set(key, result);
    return result;
  }
}

function orderedPair(
  nodes: readonly GroupNode[],
  a: number,
  b: number,
): [number, number] {
  return compareIds(nodes[a]?.id ?? '', nodes[b]?.id ?? '') <= 0
    ? [a, b]
    : [b, a];
}

function candidatePairings<T extends GroupNode>(
  nodes: readonly T[],
  comparisons: Comparisons<T>,
): Pairing[] {
  const seen = new Set<string>();
  const pairings: Pairing[] = [];
  for (const positions of indexByToken(nodes).values()) {
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const [left, right] = orderedPair(
          nodes,
          positions[i] ?? 0,
          positions[j] ?? 0,
        );
        const key = `${left}:${right}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        if (comparisons.comparable(left, right)) {
          pairings.push({
            left,
            right,
            weight: (nodes[left]?.weight ?? 0) + (nodes[right]?.weight ?? 0),
          });
        }
      }
    }
  }
  return pairings.sort(comparePairings(nodes));
}

export function groupComparableNodes<T extends GroupNode>(
  nodes: readonly T[],
  compare: NodeComparator<T> = areComparableNodes,
): T[][] {
  const comparisons = new Comparisons(nodes, compare);
  const groupOf = nodes.map((_, position) => position);
  const members = new Map<number, number[]>(
    nodes.map((_, position) => [position, [position]]),
  );
  for (const { left, right } of candidatePairings(nodes, comparisons)) {
    const leftGroup = groupOf[left] ?? left;
    const rightGroup = groupOf[right] ?? right;
    const leftMembers = members.get(leftGroup);
    const rightMembers = members.get(rightGroup);
    if (
      leftGroup === rightGroup ||
      leftMembers === undefined ||
      rightMembers === undefined ||
      !leftMembers.every((a) =>
        rightMembers.every((b) => comparisons.comparable(a, b)),
      )
    ) {
      continue;
    }
    for (const position of rightMembers) {
      groupOf[position] = leftGroup;
    }
    leftMembers.push(...rightMembers);
    members.delete(rightGroup);
  }
  return [...members.values()].map((positions) =>
    positions.flatMap((position) => {
      const node = nodes[position];
      return node === undefined ? [] : [node];
    }),
  );
}
