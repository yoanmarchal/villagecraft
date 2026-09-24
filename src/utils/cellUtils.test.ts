import { describe, expect, it } from 'vitest';
import { VillageGrid } from '../villageGrid';
import { getCell, isIsolatedBlock, isTowerColumn, makeCellLookup } from './cellUtils';

describe('isTowerColumn / isIsolatedBlock', () => {
  // Colonne (0,0) sur 3 étages, collée à une colonne (1,0) de 2 étages :
  // seul son dernier étage (y=2) est horizontalement isolé.
  const grid = new VillageGrid(3, 10, 3);
  for (let y = 0; y < 3; y += 1) grid.addBlock(0, y, 0);
  for (let y = 0; y < 2; y += 1) grid.addBlock(1, y, 0);
  const lookup = makeCellLookup(grid.getOccupiedCells());

  const base = getCell(lookup, 0, 0, 0)!;
  const top = getCell(lookup, 0, 2, 0)!;

  it("propage la forme de tour vers le bas depuis l'étage isolé", () => {
    expect(isTowerColumn(lookup, top)).toBe(true);
    expect(isTowerColumn(lookup, base)).toBe(true);
  });

  it('isIsolatedBlock reste un test local, non propagé (asymétrie voulue)', () => {
    expect(isIsolatedBlock(lookup, top)).toBe(true);
    expect(isIsolatedBlock(lookup, base)).toBe(false);
  });

  it("une colonne jamais isolée n'est pas une tour", () => {
    expect(isTowerColumn(lookup, getCell(lookup, 1, 0, 0)!)).toBe(false);
  });
});
