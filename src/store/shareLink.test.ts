import { describe, expect, it } from 'vitest';
import { decodeVillage, encodeVillage } from './shareLink';
import type { SavedVillage } from './villageStorage';

describe('encodeVillage / decodeVillage', () => {
  it('aller-retour sans perte, ordre des blocs compris', () => {
    const village: SavedVillage = {
      gridSize: 5,
      blocks: [
        [4, 0, 4],
        [0, 0, 0],
        [0, 1, 0],
        [4, 1, 4],
        [4, 9, 4],
      ],
      terrain: {
        seed: 0xfedcba98,
        sculpt: [
          [0, 0, -8],
          [4, 2, 3],
        ],
      },
    };
    expect(decodeVillage(encodeVillage(village))).toEqual(village);
  });

  it('gère un village vide', () => {
    expect(decodeVillage(encodeVillage({ gridSize: 3, blocks: [] }))).toEqual({
      gridSize: 3,
      blocks: [],
      terrain: { seed: 0, sculpt: [] },
    });
  });

  it('lit encore les liens d’avant le terrain (v1)', () => {
    // [1, 3, (0, 0, 0), (2, 1, 2)]
    expect(decodeVillage(btoa(String.fromCharCode(1, 3, 0, 0, 0, 2, 1, 2)))).toEqual({
      gridSize: 3,
      blocks: [
        [0, 0, 0],
        [2, 1, 2],
      ],
      terrain: { seed: 0, sculpt: [] },
    });
  });

  it('produit un code utilisable tel quel dans une URL', () => {
    const blocks: SavedVillage['blocks'] = [];
    for (let x = 0; x < 5; x += 1)
      for (let z = 0; z < 5; z += 1) for (let y = 0; y < 10; y += 1) blocks.push([x, y, z]);
    const code = encodeVillage({ gridSize: 5, blocks });

    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(1100);
  });

  it.each([
    ['garbage', '%%%'],
    ['mauvaise version', encodeVillage({ gridSize: 3, blocks: [] }).replace(/^A/, 'B')],
    ['taille de grille hors bornes', encodeVillage({ gridSize: 99, blocks: [] })],
    ['bloc hors grille', encodeVillage({ gridSize: 3, blocks: [[3, 0, 0]] })],
    ['modelage hors grille', encodeVillage({ gridSize: 3, blocks: [], terrain: { seed: 1, sculpt: [[3, 0, 1]] } })],
    ['bloc trop haut', encodeVillage({ gridSize: 3, blocks: [[0, 10, 0]] })],
  ])('rejette un code invalide (%s)', (_label, code) => {
    expect(decodeVillage(code)).toBeNull();
  });
});
