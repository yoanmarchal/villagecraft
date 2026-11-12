/**
 * Paysage autour du village : relief lointain et semis d'arbres. Pur et
 * déterministe (mêmes paramètres → même paysage), sans three.js : utilisé par
 * `Terrain.tsx` et `Trees.tsx`, et testé.
 *
 * Le terrain est parfaitement plat jusqu'à `flatRadius` (la grille, et toute
 * la zone où la caméra peut orbiter : elle ne doit jamais passer sous une
 * colline), puis ondule doucement vers l'horizon, où le brouillard le fond
 * dans le ciel.
 */

import { createValueNoise } from '../utils/noise';

const hillNoise = createValueNoise(7919);
const forestNoise = createValueNoise(104729);
const speciesNoise = createValueNoise(1299709);

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Hash entier → [0, 1), stable (jamais Math.random : le paysage ne doit pas changer d'un rendu à l'autre). */
function hash2(x: number, z: number, salt: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hauteur du terrain en (x, z) monde : 0 jusqu'à `flatRadius`, collines au-delà. */
export function terrainHeight(x: number, z: number, flatRadius: number): number {
  const r = Math.hypot(x, z);
  if (r <= flatRadius) return 0;
  const rise = smoothstep(flatRadius, flatRadius * 2.2, r);
  // Longueur d'onde proportionnelle à la scène : les collines gardent leur allure sur une grande grille.
  const frequency = 1.4 / flatRadius;
  return rise * hillNoise(x * frequency + 31.7, z * frequency + 11.3) * flatRadius * 0.22;
}

export type TreeKind = 'broadleaf' | 'conifer';

export interface TreeInstance {
  kind: TreeKind;
  x: number;
  y: number;
  z: number;
  /** Échelle uniforme (1 = arbre de référence, ~2,6 unités de haut). */
  scale: number;
  /** Rotation autour de la verticale, en radians. */
  rotation: number;
  /** Variation de teinte du feuillage, dans [0, 1). */
  tint: number;
}

/** Les arbres ne s'approchent pas à moins de cette distance (en cases) du bord de la grille. */
export const TREE_CLEARANCE = 2.5;
/** Plafond du nombre d'arbres, quelle que soit l'étendue du paysage. */
export const MAX_TREES = 2600;

/**
 * Semis d'arbres hors de la grille : bosquets (bruit basse fréquence), rares
 * près du village — ils masqueraient les façades vues en rase-mottes — puis
 * de plus en plus denses, jusqu'à `reach`.
 */
export function scatterTrees(gridSize: number, flatRadius: number, reach: number): TreeInstance[] {
  const half = gridSize / 2;
  // Maille élargie avec la scène : le nombre d'arbres reste borné.
  const spacing = 2.3 * Math.max(1, reach / 75);
  const steps = Math.ceil(reach / spacing);
  const trees: TreeInstance[] = [];

  for (let iz = -steps; iz <= steps; iz += 1) {
    for (let ix = -steps; ix <= steps; ix += 1) {
      const x = (ix + (hash2(ix, iz, 1) - 0.5) * 0.9) * spacing;
      const z = (iz + (hash2(ix, iz, 2) - 0.5) * 0.9) * spacing;
      if (Math.hypot(x, z) > reach) continue;
      const edge = Math.max(Math.abs(x), Math.abs(z)) - half;
      if (edge < TREE_CLEARANCE) continue;

      const grove = smoothstep(0.4, 0.62, forestNoise(x * 0.045, z * 0.045));
      const approach = 0.1 + 0.9 * smoothstep(0, 16, edge - TREE_CLEARANCE);
      if (hash2(ix, iz, 3) > approach * (0.05 + 0.95 * grove)) continue;

      const conifer = speciesNoise(x * 0.03, z * 0.03) + (hash2(ix, iz, 4) - 0.5) * 0.3 > 0.58;
      trees.push({
        kind: conifer ? 'conifer' : 'broadleaf',
        x,
        y: terrainHeight(x, z, flatRadius),
        z,
        scale: 0.75 + hash2(ix, iz, 5) * 0.6,
        rotation: hash2(ix, iz, 6) * Math.PI * 2,
        tint: hash2(ix, iz, 7),
      });
      if (trees.length >= MAX_TREES) return trees;
    }
  }
  return trees;
}
