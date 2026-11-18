/**
 * Monde de collision du mode promenade : le sol (champ de hauteur) et les
 * volumes solides, en coordonnées monde.
 *
 * Pur (ni three, ni React, ni store) : `walker.ts` ne connaît que
 * l'interface `WalkWorld`, ce qui permet de la tester avec un monde fait main.
 * Les volumes du village viennent du worker de construction, qui les tire
 * des mêmes `CellContext` que la géométrie (cellColliders.ts) : murs,
 * planchers percés des trémies, portes, escaliers.
 */

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

/** Côté des cases de l'index spatial (unités monde). */
const BUCKET = 1;

/**
 * Monde fait de boîtes (6 nombres chacune, min puis max : le format que
 * livre le worker), indexées par cases de `BUCKET` en plan.
 */
export function createBoxWorld(
  boxes: ArrayLike<number>,
  groundAt: (x: number, z: number) => number,
  reach: number,
): WalkWorld {
  const buckets = new Map<number, Aabb[]>();
  const keyOf = (i: number, j: number) => i * 4096 + j;
  for (let b = 0; b + 5 < boxes.length; b += 6) {
    const box: Aabb = {
      min: [boxes[b], boxes[b + 1], boxes[b + 2]],
      max: [boxes[b + 3], boxes[b + 4], boxes[b + 5]],
    };
    for (let i = Math.floor(box.min[0] / BUCKET); i <= Math.floor(box.max[0] / BUCKET); i += 1) {
      for (let j = Math.floor(box.min[2] / BUCKET); j <= Math.floor(box.max[2] / BUCKET); j += 1) {
        const key = keyOf(i, j);
        const list = buckets.get(key);
        if (list) list.push(box);
        else buckets.set(key, [box]);
      }
    }
  }

  const solidsIn = (minX: number, minZ: number, maxX: number, maxZ: number) => {
    const found = new Set<Aabb>();
    for (let i = Math.floor(minX / BUCKET); i <= Math.floor(maxX / BUCKET); i += 1) {
      for (let j = Math.floor(minZ / BUCKET); j <= Math.floor(maxZ / BUCKET); j += 1) {
        for (const box of buckets.get(keyOf(i, j)) ?? []) {
          if (box.min[0] <= maxX && box.max[0] >= minX && box.min[2] <= maxZ && box.max[2] >= minZ) found.add(box);
        }
      }
    }
    return [...found];
  };

  return { groundAt, solidsIn, reach };
}
