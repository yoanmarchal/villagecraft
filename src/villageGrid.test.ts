import { describe, expect, it, vi } from 'vitest';
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

describe('VillageGrid — arches automatiques', () => {
  /** Deux bâtiments de `height` blocs, en x = 0 et x = 2, sur z ∈ [z0, z1] ; ruelle en x = 1. */
  const twoRows = (height: number, z0 = 1, z1 = 1, size = 3) => {
    const grid = new VillageGrid(size, HEIGHT, size);
    for (let z = z0; z <= z1; z += 1) {
      buildColumn(grid, 0, z, height);
      buildColumn(grid, 2, z, height);
    }
    return grid;
  };
  const archesIn = (grid: VillageGrid) => grid.getOccupiedCells().filter((cell) => cell.type === BlockType.Arch);

  it('couvre un passage entre deux bâtiments à deux niveaux de murs (+ toit)', () => {
    const grid = twoRows(3);
    const arch = grid.getCell({ x: 1, y: 1, z: 1 });
    expect(arch?.type).toBe(BlockType.Arch);
    expect(arch?.isAutoArch).toBe(true);
    expect(grid.getCell({ x: 1, y: 0, z: 1 })?.isOccupied).toBe(false); // le passage reste libre
  });

  it("se forme dès deux maisons d'un seul clic (rez-de-chaussée + toit auto)", () => {
    const grid = new VillageGrid(3, HEIGHT, 3);
    for (const x of [0, 2]) grid.addBlock(x, grid.getNextPlacementY(x, 1)!, 1); // un clic chacune
    expect(archesIn(grid).map(({ x, y, z }) => [x, y, z])).toEqual([[1, 1, 1]]);
  });

  it("ne se forme pas avec un seul bâtiment, ni en diagonale", () => {
    const single = new VillageGrid(3, HEIGHT, 3);
    buildColumn(single, 0, 1, 3);
    expect(archesIn(single)).toHaveLength(0);

    const diagonal = new VillageGrid(3, HEIGHT, 3);
    buildColumn(diagonal, 0, 0, 3);
    buildColumn(diagonal, 2, 2, 3);
    expect(archesIn(diagonal)).toHaveLength(0);
  });

  it('une seule arche par tronçon de ruelle, au milieu', () => {
    const grid = twoRows(3, 0, 4, 5);
    const arches = archesIn(grid);
    expect(arches).toHaveLength(1);
    expect([arches[0].x, arches[0].z]).toEqual([1, 2]);
  });

  it("enjambe d'un seul tenant une rue de 2 cases, jamais plus", () => {
    const street = (width: number) => {
      const grid = new VillageGrid(6, HEIGHT, 3);
      buildColumn(grid, 0, 1, 2);
      buildColumn(grid, width + 1, 1, 2);
      return archesIn(grid).map(({ x, y, z }) => [x, y, z]);
    };
    expect(street(2)).toEqual([[1, 1, 1], [2, 1, 1]]);
    expect(street(3)).toEqual([]);
  });

  it('disparaît quand un bâtiment porteur est entièrement démoli', () => {
    const grid = twoRows(3);
    while (grid.removeTopBlockInColumn(2, 1) !== null) {
      // démolition complète, clic après clic
    }
    expect(archesIn(grid)).toHaveLength(0);
  });

  it('un clic dans la ruelle bâtit au sol, et bouche le passage', () => {
    const grid = twoRows(3);
    expect(grid.getNextPlacementY(1, 1)).toBe(0);
    grid.addBlock(1, 0, 1);
    expect(archesIn(grid)).toHaveLength(0);
  });

  it("n'est ni sauvegardée ni démolissable", () => {
    const grid = twoRows(3);
    expect(grid.exportBlocks().some(([x, y, z]) => x === 1 && y === 1 && z === 1)).toBe(false);
    expect(grid.removeTopBlockInColumn(1, 1)).toBeNull();
  });

  it('apparaît aussi dans les villages générés', () => {
    let arches = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const grid = new VillageGrid(12, HEIGHT, 12);
      grid.generateTerrain(12, seed);
      arches += archesIn(grid).length;
    }
    expect(arches).toBeGreaterThan(0);
  });
});

describe('VillageGrid — generateTerrain', () => {
  const columnHeights = (grid: VillageGrid, size: number) => {
    const heights: number[][] = [];
    for (let x = 0; x < size; x += 1) {
      heights.push([]);
      for (let z = 0; z < size; z += 1) {
        const top = grid.getTopRealOccupiedY(x, z);
        heights[x].push(top === null ? 0 : top + 1);
      }
    }
    return heights;
  };

  it('même graine → même village', () => {
    const a = new VillageGrid(12, HEIGHT, 12);
    const b = new VillageGrid(12, HEIGHT, 12);
    a.generateTerrain(12, 1234);
    b.generateTerrain(12, 1234);
    expect(a.exportBlocks()).toEqual(b.exportBlocks());
  });

  it('ne produit jamais une parcelle vide, ni pleine', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const grid = new VillageGrid(8, HEIGHT, 8);
      grid.generateTerrain(8, seed);
      const occupied = columnHeights(grid, 8).flat().filter((h) => h > 0).length;
      expect(occupied).toBeGreaterThan(0);
      expect(occupied).toBeLessThan(64);
    }
  });

  it('reste sous le plafond de la grille', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const grid = new VillageGrid(12, HEIGHT, 12);
      grid.generateTerrain(12, seed);
      // < HEIGHT : il reste toujours au moins un étage pour le toit.
      expect(Math.max(...columnHeights(grid, 12).flat())).toBeLessThan(HEIGHT);
    }
  });

  it('laisse des rues vides sur les grandes grilles', () => {
    const grid = new VillageGrid(12, HEIGHT, 12);
    grid.generateTerrain(12, 99);
    const heights = columnHeights(grid, 12);
    const emptyRows = heights.filter((row) => row.every((h) => h === 0)).length;
    const emptyCols = heights[0].filter((_, z) => heights.every((row) => row[z] === 0)).length;
    expect(emptyRows + emptyCols).toBeGreaterThan(0);
  });

  it('ne déborde pas de la taille demandée', () => {
    const grid = new VillageGrid(10, HEIGHT, 10);
    grid.generateTerrain(4, 5);
    expect(grid.exportBlocks().every(([x, , z]) => x < 4 && z < 4)).toBe(true);
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

  it("replaceBlocks ne rejoue l'animation que des cellules qui changent", () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const grid = buildSample();
    const before = grid.exportBlocks();

    now.mockReturnValue(5000);
    grid.replaceBlocks([...before, [4, 0, 0]]);

    const spawn = (x: number, y: number, z: number) => grid.getCell({ x, y, z })?.spawnedAt;
    expect(spawn(1, 0, 0)).toBe(1); // inchangée : spawnedAt d'origine (1000 ms)
    expect(spawn(4, 0, 0)).toBe(5); // nouvelle cellule
    now.mockRestore();
  });

  it("applique le décalage et ignore les blocs hors grille", () => {
    const grid = buildSample();
    const small = new VillageGrid(3, HEIGHT, 3);
    small.importBlocks(grid.exportBlocks(), -1, -1);

    // (0,0) sort de la grille, (1,0) → (0,-1) aussi, (3,3) → (2,2) reste.
    expect(small.exportBlocks()).toEqual([[2, 0, 2]]);
  });
});
