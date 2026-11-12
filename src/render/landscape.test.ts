import { describe, expect, it } from 'vitest';
import { MAX_TREES, scatterTrees, terrainHeight, TREE_CLEARANCE } from './landscape';

describe('terrainHeight', () => {
  it('reste parfaitement plat dans la zone où la caméra orbite', () => {
    for (const [x, z] of [
      [0, 0],
      [39, 0],
      [-20, 30],
      [28, -28],
    ]) {
      expect(terrainHeight(x, z, 40)).toBe(0);
    }
  });

  it('ondule au-delà, sans creux sous le niveau du village ni falaise', () => {
    let highest = 0;
    for (let x = -150; x <= 150; x += 7) {
      for (let z = -150; z <= 150; z += 7) {
        const height = terrainHeight(x, z, 40);
        expect(height).toBeGreaterThanOrEqual(0);
        // Pente douce : jamais plus de ~1 pour 2 entre deux points voisins.
        expect(Math.abs(height - terrainHeight(x + 1, z, 40))).toBeLessThan(0.5);
        highest = Math.max(highest, height);
      }
    }
    expect(highest).toBeGreaterThan(3);
    expect(highest).toBeLessThan(40 * 0.22);
  });
});

describe('scatterTrees', () => {
  const trees = scatterTrees(8, 40, 110);

  it('est déterministe', () => {
    expect(scatterTrees(8, 40, 110)).toEqual(trees);
  });

  it('plante les deux essences, en nombre borné', () => {
    expect(trees.length).toBeGreaterThan(100);
    expect(trees.length).toBeLessThanOrEqual(MAX_TREES);
    expect(trees.some((tree) => tree.kind === 'broadleaf')).toBe(true);
    expect(trees.some((tree) => tree.kind === 'conifer')).toBe(true);
  });

  it('laisse la grille et ses abords dégagés, et reste dans le rayon visible', () => {
    for (const tree of trees) {
      expect(Math.max(Math.abs(tree.x), Math.abs(tree.z))).toBeGreaterThanOrEqual(4 + TREE_CLEARANCE);
      expect(Math.hypot(tree.x, tree.z)).toBeLessThanOrEqual(110);
    }
  });

  it('pose chaque arbre sur le terrain', () => {
    for (const tree of trees) expect(tree.y).toBe(terrainHeight(tree.x, tree.z, 40));
  });

  it('reste borné sur la plus grande scène', () => {
    expect(scatterTrees(12, 90, 264).length).toBeLessThanOrEqual(MAX_TREES);
  });
});
