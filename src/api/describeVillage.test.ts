import { describe, expect, it } from 'vitest';
import { VillageGrid } from '../villageGrid';
import { describeVillage } from './describeVillage';

describe('describeVillage', () => {
  it('counts blocks, buildings, towers and draws a height map', () => {
    const grid = new VillageGrid(6, 10, 6);
    // Maison 2 × 1 de deux niveaux, et une tour isolée de quatre.
    for (const x of [1, 2]) for (let y = 0; y < 2; y += 1) grid.addBlock(x, y, 1);
    for (let y = 0; y < 4; y += 1) grid.addBlock(4, y, 4);
    const village = describeVillage(grid);
    expect(village.gridSize).toBe(6);
    expect(village.blocks).toBe(8);
    expect(village.heights[1].slice(0, 4)).toEqual([0, 2, 2, 0]);
    expect(village.heights[4][4]).toBe(4);
    expect(village.buildings).toHaveLength(2);
    const tower = village.buildings.find((b) => b.columns === 1)!;
    expect(tower).toMatchObject({ minX: 4, minZ: 4, maxStoreys: 3, towers: 1 });
    expect(village.buildings.find((b) => b.columns === 2)).toMatchObject({ maxStoreys: 1, towers: 0 });
    expect(village.text).toContain(' 1 . 2 2 . . .');
    expect(village.text).toContain(' 4 . . . . 4 .');
  });

  it('marks arches over lanes', () => {
    // Deux maisons de trois niveaux face à face, une ruelle d'une case : arche automatique.
    const grid = new VillageGrid(6, 10, 6);
    for (const x of [1, 3]) for (let y = 0; y < 3; y += 1) grid.addBlock(x, y, 2);
    const village = describeVillage(grid);
    expect(village.arches).toBeGreaterThan(0);
    expect(village.text).toContain(' 2 . 3 ^ 3 . .');
  });
});
