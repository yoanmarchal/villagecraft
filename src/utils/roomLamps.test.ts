import { describe, expect, it } from 'vitest';
import { VillageGrid } from '../villageGrid';
import { makeCellLookup } from './cellUtils';
import { assignRoomLamps } from './roomLamps';

/** Grille avec une colonne d'un étage (+ cap de toit) par case listée. */
function village(columns: Array<[number, number]>, levels = 1): VillageGrid {
  const grid = new VillageGrid(9, 10, 9);
  for (const [x, z] of columns) for (let i = 0; i < levels; i += 1) grid.addBlockInColumn(x, z);
  return grid;
}

function lampsOf(grid: VillageGrid) {
  const cells = grid.getOccupiedCells();
  const lamps = assignRoomLamps(cells, makeCellLookup(cells));
  const holders = [...lamps].filter(([, l]) => l.dx === 0 && l.dz === 0).map(([c]) => `${c.x},${c.y},${c.z}`);
  return { lamps, holders: holders.sort() };
}

const square = (x0: number, z0: number, size: number) => {
  const columns: Array<[number, number]> = [];
  for (let x = x0; x < x0 + size; x += 1) for (let z = z0; z < z0 + size; z += 1) columns.push([x, z]);
  return columns;
};

describe('assignRoomLamps', () => {
  it('gives a lone room its own chandelier', () => {
    expect(lampsOf(village([[4, 4]])).holders).toEqual(['4,0,4']);
  });

  it('hangs a single chandelier in the middle of a 3 × 3 room, lighting every cell', () => {
    const { lamps, holders } = lampsOf(village(square(2, 2, 3)));
    expect(holders).toEqual(['3,0,3']);
    for (const [cell, lamp] of lamps) {
      expect([cell.x + lamp.dx, cell.z + lamp.dz]).toEqual([3, 3]);
    }
  });

  it('adds chandeliers only when a hall outgrows one (6 × 6 → 4)', () => {
    expect(lampsOf(village(square(1, 1, 5))).holders).toHaveLength(1);
    expect(lampsOf(village(square(1, 1, 6))).holders).toHaveLength(4);
  });

  it('keeps separate buildings and storeys as separate rooms', () => {
    const { holders } = lampsOf(village([[1, 1], [6, 6]], 2));
    // Deux maisons à deux étages (+ caps de toit, non creux) : 4 pièces.
    expect(holders).toHaveLength(4);
  });

  it('does not depend on the order of the cells', () => {
    const grid = village(square(1, 1, 6));
    const cells = grid.getOccupiedCells();
    const forward = assignRoomLamps(cells, makeCellLookup(cells));
    const reversed = assignRoomLamps([...cells].reverse(), makeCellLookup(cells));
    for (const cell of cells) expect(reversed.get(cell)).toEqual(forward.get(cell));
  });
});
