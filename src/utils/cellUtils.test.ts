import { describe, expect, it } from 'vitest';
import { VillageGrid } from '../villageGrid';
import {
  getCell,
  getColumnTop,
  getCornerRadii,
  isIsolatedBlock,
  isRampart,
  isTowerColumn,
  makeCellLookup,
} from './cellUtils';

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

describe('isRampart', () => {
  /** Deux tours de 3 étages en x = 0 et x = 3, reliées par un mur de 2 étages. */
  const build = (extra: (grid: VillageGrid) => void = () => {}) => {
    const grid = new VillageGrid(6, 10, 6);
    for (let y = 0; y < 3; y += 1) {
      grid.addBlock(0, y, 0);
      grid.addBlock(3, y, 0);
    }
    for (let y = 0; y < 2; y += 1) {
      grid.addBlock(1, y, 0);
      grid.addBlock(2, y, 0);
    }
    extra(grid);
    return makeCellLookup(grid.getOccupiedCells());
  };

  it("reconnaît un mur d'une case tendu entre deux tours", () => {
    const lookup = build();
    expect(isRampart(lookup, getCell(lookup, 1, 1, 0)!)).toBe(true);
    expect(isRampart(lookup, getCell(lookup, 2, 1, 0)!)).toBe(true);
  });

  it("ne s'applique pas aux sommets des tours elles-mêmes", () => {
    const lookup = build();
    expect(isRampart(lookup, getCell(lookup, 0, 2, 0)!)).toBe(false);
  });

  it("refuse un mur de deux cases d'épaisseur (bâtiment)", () => {
    const lookup = build((grid) => {
      for (let y = 0; y < 2; y += 1) grid.addBlock(2, y, 1);
    });
    expect(isRampart(lookup, getCell(lookup, 1, 1, 0)!)).toBe(false);
  });

  it('refuse un mur qui se termine dans le vide', () => {
    const grid = new VillageGrid(6, 10, 6);
    for (let y = 0; y < 3; y += 1) grid.addBlock(0, y, 0);
    for (let y = 0; y < 2; y += 1) {
      grid.addBlock(1, y, 0);
      grid.addBlock(2, y, 0);
    }
    const lookup = makeCellLookup(grid.getOccupiedCells());
    expect(isRampart(lookup, getCell(lookup, 1, 1, 0)!)).toBe(false);
  });

  it('getColumnTop remonte au sommet de la colonne', () => {
    const lookup = build();
    expect(getColumnTop(lookup, getCell(lookup, 0, 0, 0)!).y).toBe(2);
  });
});

describe('getCornerRadii', () => {
  const SHAPE = { isolatedWallRadius: 0.22, connectedWallExposedRadius: 0.1, connectedWallInteriorRadius: 0.3 };
  // Bloc 2 × 2 en (2..3, 2..3) et une aile en (4, 2) : un angle rentrant en (4, 3).
  const grid = new VillageGrid(7, 10, 7);
  for (const [x, z] of [
    [2, 2],
    [3, 2],
    [2, 3],
    [3, 3],
    [4, 2],
  ])
    grid.addBlock(x, 0, z);
  const lookup = makeCellLookup(grid.getOccupiedCells());
  const radiiAt = (x: number, z: number) => getCornerRadii(lookup, getCell(lookup, x, 0, z)!, SHAPE);

  it('arrondit les angles saillants et les jonctions sur une façade droite', () => {
    expect(radiiAt(2, 2).backLeft).toBe(0.1); // angle du bloc
    expect(radiiAt(3, 2).backLeft).toBe(0.3); // façade arrière, jonction avec (2, 2)
    expect(radiiAt(2, 2).backRight).toBe(0.3); // et symétriquement
  });

  it('garde vifs les coins au cœur d’un bloc et les angles rentrants', () => {
    // Centre du bloc 2 × 2 : arrondi, il creusait un puits à travers les planchers.
    expect(radiiAt(2, 2).frontRight).toBe(0);
    expect(radiiAt(3, 3).backLeft).toBe(0);
    // Angle rentrant entre (3, 3) et l'aile (4, 2), des deux côtés.
    expect(radiiAt(3, 3).backRight).toBe(0);
    expect(radiiAt(4, 2).frontLeft).toBe(0);
    expect(radiiAt(3, 2).frontRight).toBe(0);
  });
});
