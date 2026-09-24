import { describe, expect, it } from 'vitest';
import { VillageGrid } from '../../villageGrid';
import { makeCellLookup } from '../../utils/cellUtils';
import { pavingParts } from './pavingParts';

describe('pavingParts', () => {
  const paved = (grid: VillageGrid, size: number) =>
    new Set(pavingParts(makeCellLookup(grid.getOccupiedCells()), { width: size, depth: size }).map(({ x, z }) => `${x},${z}`));

  it('pave les cases vides qui touchent un bâtiment, y compris en diagonale', () => {
    const grid = new VillageGrid(5, 10, 5);
    grid.addBlock(2, 0, 2);
    const cells = paved(grid, 5);

    expect(cells.size).toBe(8);
    expect(cells.has('1,1')).toBe(true);
    expect(cells.has('3,2')).toBe(true);
  });

  it('laisse l’herbe loin des bâtiments et ne pave jamais sous un bloc', () => {
    const grid = new VillageGrid(5, 10, 5);
    grid.addBlock(2, 0, 2);
    const cells = paved(grid, 5);

    expect(cells.has('2,2')).toBe(false);
    expect(cells.has('0,0')).toBe(false);
    expect(cells.has('4,4')).toBe(false);
  });

  it('pave le passage sous une arche', () => {
    const grid = new VillageGrid(5, 10, 5);
    for (const x of [1, 3]) for (let y = 0; y < 3; y += 1) grid.addBlock(x, y, 2);
    grid.addBlock(2, 1, 2); // arche : rien en dessous
    expect(paved(grid, 5).has('2,2')).toBe(true);
  });

  it("n'émet rien sans bâtiment", () => {
    expect(paved(new VillageGrid(4, 10, 4), 4).size).toBe(0);
  });
});
