import { describe, expect, it } from 'vitest';
import { VillageGrid } from './villageGrid';
import { BlockType } from './types';

const HEIGHT = 10;

/** PRNG déterministe (mulberry32) pour des ordres de construction reproductibles. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Signature "x,y,z:type" triée de toutes les cellules occupées. */
function snapshot(grid: VillageGrid): string[] {
  return grid
    .getOccupiedCells()
    .map((c) => `${c.x},${c.y},${c.z}:${c.type}${c.isAutoRoof ? '(auto)' : ''}`)
    .sort();
}

function typeAt(grid: VillageGrid, x: number, y: number, z: number): BlockType | undefined {
  return grid.getCell({ x, y, z })?.type;
}

/** Colonne d'exactement `height` étages réels (y = 0 … height-1). */
function buildColumn(grid: VillageGrid, x: number, z: number, height: number): void {
  for (let y = 0; y < height; y += 1) grid.addBlock(x, y, z);
}

describe('VillageGrid — toits automatiques', () => {
  it('coiffe automatiquement une colonne à un seul étage', () => {
    const grid = new VillageGrid(3, HEIGHT, 3);
    grid.addBlockInColumn(1, 1);

    const cap = grid.getCell({ x: 1, y: 1, z: 1 });
    expect(cap?.isOccupied).toBe(true);
    expect(cap?.isAutoRoof).toBe(true);
    expect(cap?.type).toBe(BlockType.Roof);
  });

  it('construit au-dessus du cap, qui devient alors un vrai mur', () => {
    const grid = new VillageGrid(3, HEIGHT, 3);
    grid.addBlockInColumn(1, 1);
    expect(grid.getNextPlacementY(1, 1)).toBe(2);

    grid.addBlockInColumn(1, 1);
    expect(grid.getCell({ x: 1, y: 1, z: 1 })?.isAutoRoof).toBeFalsy();
    expect(typeAt(grid, 1, 2, 1)).toBe(BlockType.Roof);
    expect(grid.getCell({ x: 1, y: 2, z: 1 })?.isAutoRoof).toBeFalsy();
  });

  it('addBlock sur un cap auto le transforme en vrai bloc', () => {
    const grid = new VillageGrid(3, HEIGHT, 3);
    grid.addBlock(1, 0, 1);
    grid.addBlock(1, 1, 1); // emplacement du cap auto

    expect(grid.getCell({ x: 1, y: 1, z: 1 })?.isAutoRoof).toBeFalsy();
    expect(grid.exportBlocks()).toEqual([[1, 0, 1], [1, 1, 1]]);
  });

  it("retirer le sommet d'une colonne à 2 étages produit toujours un changement visible", () => {
    const grid = new VillageGrid(3, HEIGHT, 3);
    buildColumn(grid, 1, 1, 2);
    const before = snapshot(grid);

    grid.removeTopBlockInColumn(1, 1);
    expect(snapshot(grid)).not.toEqual(before);
  });
});

describe('VillageGrid — types de blocs', () => {
  it("pose une arche entre deux colonnes porteuses, sans support dessous", () => {
    const grid = new VillageGrid(3, HEIGHT, 3);
    buildColumn(grid, 0, 0, 3);
    buildColumn(grid, 2, 0, 3);
    grid.addBlock(1, 1, 0);

    expect(typeAt(grid, 1, 1, 0)).toBe(BlockType.Arch);
  });

  it('le rez-de-chaussée exposé porte une ouverture, le sommet un toit', () => {
    const grid = new VillageGrid(3, HEIGHT, 3);
    buildColumn(grid, 1, 1, 3);

    expect(typeAt(grid, 1, 0, 1)).toBe(BlockType.WallWithWindow);
    expect(typeAt(grid, 1, 2, 1)).toBe(BlockType.Roof);
  });

  it("n'a jamais deux fenêtres adjacentes sur un même étage", () => {
    const grid = new VillageGrid(5, HEIGHT, 5);
    for (let x = 0; x < 5; x += 1) buildColumn(grid, x, 0, 4);

    for (let y = 1; y < 3; y += 1) {
      for (let x = 1; x < 5; x += 1) {
        const both = typeAt(grid, x - 1, y, 0) === BlockType.WallWithWindow && typeAt(grid, x, y, 0) === BlockType.WallWithWindow;
        expect(both, `fenêtres adjacentes en x=${x - 1}/${x}, y=${y}`).toBe(false);
      }
    }
  });

  it("le résultat ne dépend que de la forme, pas de l'ordre de construction", () => {
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 2]];
    const floors = 3;

    const buildInRandomOrder = (seed: number) => {
      const random = seededRandom(seed);
      const grid = new VillageGrid(5, HEIGHT, 5);
      const remaining = new Map(footprint.map(([x, z]) => [`${x},${z}`, floors]));
      while (remaining.size > 0) {
        const keys = [...remaining.keys()];
        const key = keys[Math.floor(random() * keys.length)];
        const [x, z] = key.split(',').map(Number);
        grid.addBlockInColumn(x, z);
        const left = remaining.get(key)! - 1;
        if (left === 0) remaining.delete(key);
        else remaining.set(key, left);
      }
      return snapshot(grid);
    };

    const reference = buildInRandomOrder(1);
    for (let seed = 2; seed <= 50; seed += 1) {
      expect(buildInRandomOrder(seed)).toEqual(reference);
    }
  });
});

describe('VillageGrid — export / import', () => {
  const buildSample = () => {
    const grid = new VillageGrid(5, HEIGHT, 5);
    buildColumn(grid, 0, 0, 2);
    buildColumn(grid, 1, 0, 3);
    buildColumn(grid, 3, 3, 1); // colonne à 1 étage → cap auto
    return grid;
  };

  it("n'exporte pas les caps de toit automatiques", () => {
    const blocks = buildSample().exportBlocks();
    expect(blocks).not.toContainEqual([3, 1, 3]);
    expect(blocks).toContainEqual([3, 0, 3]);
  });

  it('un aller-retour export → import reconstruit le même village', () => {
    const grid = buildSample();
    const copy = new VillageGrid(5, HEIGHT, 5);
    copy.importBlocks(grid.exportBlocks());
    expect(snapshot(copy)).toEqual(snapshot(grid));
  });

  it("applique le décalage et ignore les blocs hors grille", () => {
    const grid = buildSample();
    const small = new VillageGrid(3, HEIGHT, 3);
    small.importBlocks(grid.exportBlocks(), -1, -1);

    // (0,0) sort de la grille, (1,0) → (0,-1) aussi, (3,3) → (2,2) reste.
    expect(small.exportBlocks()).toEqual([[2, 0, 2]]);
  });
});
