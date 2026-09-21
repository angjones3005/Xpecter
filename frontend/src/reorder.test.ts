import { describe, expect, it } from 'vitest';
import { dropSide, reorderIds, wouldNest } from './reorder';

describe('dropSide', () => {
  it('splits a row at its middle', () => {
    expect(dropSide(104, 100, 20)).toBe('before');
    expect(dropSide(110, 100, 20)).toBe('after');
    expect(dropSide(116, 100, 20)).toBe('after');
  });
});

describe('reorderIds', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('puts the moved id on the chosen side of the target', () => {
    expect(reorderIds(ids, 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
    expect(reorderIds(ids, 'a', 'd', 'after')).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderIds(ids, 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd']);
    expect(reorderIds(ids, 'c', 'a', 'after')).toEqual(['a', 'c', 'b', 'd']);
    // Dropping a row just below the one above it is a no-op in effect.
    expect(reorderIds(ids, 'b', 'a', 'after')).toEqual(ids);
  });

  it('changes nothing for a move onto itself or an unknown id, and never hands back the input', () => {
    expect(reorderIds(ids, 'b', 'b', 'after')).toEqual(ids);
    expect(reorderIds(ids, 'x', 'a', 'after')).toEqual(ids);
    expect(reorderIds(ids, 'a', 'x', 'after')).toEqual(ids);
    expect(reorderIds(ids, 'b', 'b', 'after')).not.toBe(ids);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('wouldNest', () => {
  const parentOf = new Map<string, string | undefined>([
    ['root', undefined],
    ['child', 'root'],
    ['grandchild', 'child'],
  ]);

  it('refuses a folder inside itself or its own descendants', () => {
    expect(wouldNest(parentOf, 'root', 'grandchild')).toBe(true);
    expect(wouldNest(parentOf, 'root', 'child')).toBe(true);
    expect(wouldNest(parentOf, 'root', 'root')).toBe(true);
  });

  it('allows any other parent, including none', () => {
    expect(wouldNest(parentOf, 'child', 'root')).toBe(false);
    expect(wouldNest(parentOf, 'grandchild', 'root')).toBe(false);
    expect(wouldNest(parentOf, 'child', undefined)).toBe(false);
  });

  it('stops on a looping parent chain', () => {
    const loop = new Map<string, string | undefined>([['a', 'b'], ['b', 'a']]);
    expect(wouldNest(loop, 'x', 'a')).toBe(false);
  });
});
