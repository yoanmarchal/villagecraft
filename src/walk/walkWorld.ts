/**
 * Monde de collision du mode promenade : le sol (champ de hauteur) et les
 * volumes solides, en coordonnées monde.
 *
 * Pur (ni three, ni React, ni store) : `walker.ts` ne connaît que
 * l'interface `WalkWorld`, ce qui permet de la tester avec un monde fait
 * main et, plus tard, d'affiner les volumes sans toucher à la physique.
 *
 * Première version : chaque colonne bâtie est un bloc plein (on fait le tour
 * des maisons). Pour entrer dans les pièces, `solidsIn` rendra plutôt les
 * murs de chaque coque creuse (épaisseur `WALL_T`), percés aux portes, et
 * les escaliers comme une suite de marches — voir docs/walk.md.
 */

import type { GridCell } from '../types';

export type Vec3 = [number, number, number];

/** Boîte alignée sur les axes (monde). */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface WalkWorld {
  /** Hauteur du sol (terrain, paysage) en (x, z) monde. */
  groundAt: (x: number, z: number) => number;
  /** Volumes solides qui recoupent le rectangle [minX, maxX] × [minZ, maxZ] (en plan). */
  solidsIn: (minX: number, minZ: number, maxX: number, maxZ: number) => Aabb[];
  /** Distance horizontale maximale au centre de la scène (bord du paysage). */
  reach: number;
}

/** Profondeur sous le niveau du bâtiment jusqu'où descend le soubassement d'une case posée au sol. */
const PLINTH_DEPTH = 50;

export interface VillageWorldOptions {
  cells: readonly Pick<GridCell, 'x' | 'y' | 'z'>[];
  gridWidth: number;
  gridDepth: number;
  /** Niveau (y monde du pied) de la colonne (x, z) de la grille (ground.ts). */
  baseAt: (x: number, z: number) => number;
  groundAt: (x: number, z: number) => number;
  reach: number;
}

/**
 * Monde du village : une boîte par suite de cases empilées d'une colonne. La
 * case (x, y, z) occupe [x − W/2, x − W/2 + 1] × [b + y, b + y + 1] ×
 * [z − D/2, z − D/2 + 1], b = `baseAt(x, z)` ; celle du bas d'une colonne
 * posée au sol descend jusque sous le terrain (soubassement, comme dans
 * voxelRaycast.ts). Une arche, qui ne touche pas le sol, laisse passer dessous.
 */
export function createVillageWorld({
  cells,
  gridWidth,
  gridDepth,
  baseAt,
  groundAt,
  reach,
}: VillageWorldOptions): WalkWorld {
  const columns = new Map<number, Aabb[]>();
  const levels = new Map<number, number[]>();
  for (const { x, y, z } of cells) {
    const key = x + gridWidth * z;
    const list = levels.get(key);
    if (list) list.push(y);
    else levels.set(key, [y]);
  }
  for (const [key, ys] of levels) {
    const x = key % gridWidth;
    const z = (key - x) / gridWidth;
    const base = baseAt(x, z);
    const minX = x - gridWidth / 2;
    const minZ = z - gridDepth / 2;
    ys.sort((a, b) => a - b);
    const boxes: Aabb[] = [];
    let start = ys[0];
    for (let i = 1; i <= ys.length; i += 1) {
      if (i < ys.length && ys[i] === ys[i - 1] + 1) continue;
      const end = ys[i - 1] + 1;
      const bottom = start === 0 ? base - PLINTH_DEPTH : base + start;
      boxes.push({ min: [minX, bottom, minZ], max: [minX + 1, base + end, minZ + 1] });
      if (i < ys.length) start = ys[i];
    }
    columns.set(key, boxes);
  }

  const solidsIn = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    const x0 = Math.max(0, Math.floor(minX + gridWidth / 2));
    const x1 = Math.min(gridWidth - 1, Math.floor(maxX + gridWidth / 2));
    const z0 = Math.max(0, Math.floor(minZ + gridDepth / 2));
    const z1 = Math.min(gridDepth - 1, Math.floor(maxZ + gridDepth / 2));
    const found: Aabb[] = [];
    for (let z = z0; z <= z1; z += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const boxes = columns.get(x + gridWidth * z);
        if (boxes) found.push(...boxes);
      }
    }
    return found;
  };

  return { groundAt, solidsIn, reach };
}
