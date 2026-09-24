import { describe, expect, it } from 'vitest';
import { decodeVillage, encodeVillage } from './shareLink';
import type { SavedVillage } from './villageStorage';

describe('encodeVillage / decodeVillage', () => {
  it('aller-retour sans perte, ordre des blocs compris', () => {
    const village: SavedVillage = { gridSize: 5, blocks: [[4, 0, 4], [0, 0, 0], [0, 1, 0], [4, 1, 4], [4, 9, 4]] };
    expect(decodeVillage(encodeVillage(village))).toEqual(village);
  });

  it('gère un village vide', () => {
    expect(decodeVillage(encodeVillage({ gridSize: 3, blocks: [] }))).toEqual({ gridSize: 3, blocks: [] });
  });

  it('produit un code utilisable tel quel dans une URL', () => {
    const blocks: SavedVillage['blocks'] = [];
    for (let x = 0; x < 5; x += 1) for (let z = 0; z < 5; z += 1) for (let y = 0; y < 10; y += 1) blocks.push([x, y, z]);
    const code = encodeVillage({ gridSize: 5, blocks });

    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(1100);
  });

  it.each([
    ['garbage', '%%%'],
    ['mauvaise version', encodeVillage({ gridSize: 3, blocks: [] }).replace(/^A/, 'B')],
    ['taille de grille hors bornes', encodeVillage({ gridSize: 99, blocks: [] })],
    ['bloc hors grille', encodeVillage({ gridSize: 3, blocks: [[3, 0, 0]] })],
    ['bloc trop haut', encodeVillage({ gridSize: 3, blocks: [[0, 10, 0]] })],
  ])('rejette un code invalide (%s)', (_label, code) => {
    expect(decodeVillage(code)).toBeNull();
  });
});
