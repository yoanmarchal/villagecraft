import { describe, expect, it } from 'vitest';
import { dropFloatingBlocks, type SavedBlock } from './villageStorage';

describe('dropFloatingBlocks', () => {
  it('keeps stacked columns, in their original order', () => {
    // Cap promu en mur : numéroté après le bloc posé dessus.
    const blocks: SavedBlock[] = [[0, 0, 0], [0, 2, 0], [0, 1, 0], [1, 0, 1]];
    expect(dropFloatingBlocks(blocks)).toEqual(blocks);
  });

  it('drops blocks with a gap anywhere below them', () => {
    const blocks: SavedBlock[] = [[0, 0, 0], [0, 2, 0], [0, 3, 0], [2, 1, 2], [3, 0, 3]];
    expect(dropFloatingBlocks(blocks)).toEqual([[0, 0, 0], [3, 0, 3]]);
  });
});
