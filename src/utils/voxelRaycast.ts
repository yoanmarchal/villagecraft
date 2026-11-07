/**
 * Lancer de rayon dans la grille de voxels (traversée DDA d'Amanatides & Woo).
 *
 * Sert à viser ce que l'on voit : la surface de clic est un plan au sol, un
 * rayon qui touche le toit d'une maison haute y arrive donc *derrière* elle.
 * On parcourt plutôt les cases traversées par le rayon jusqu'à la première
 * occupée — exact à la case près et bien moins cher qu'un raycast sur les
 * ~1 M de sommets du village fusionné.
 *
 * Repère "grille" : la case (x, y, z) occupe le cube [x, x+1] × [y, y+1] × [z, z+1].
 */

export type Vec3 = [number, number, number];

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** Normale de la face d'entrée (axe unique, ±1) ; nulle si le rayon part de l'intérieur de la case. */
  normal: Vec3;
}

export function raycastVoxels(
  origin: Vec3,
  direction: Vec3,
  size: Vec3,
  isSolid: (x: number, y: number, z: number) => boolean,
): VoxelHit | null {
  // Entrée/sortie du rayon dans la boîte de la grille (méthode des slabs).
  let tEnter = 0;
  let tExit = Infinity;
  let enterAxis = -1;
  for (let a = 0; a < 3; a += 1) {
    const o = origin[a];
    const d = direction[a];
    if (d === 0) {
      if (o < 0 || o > size[a]) return null;
      continue;
    }
    let t0 = -o / d;
    let t1 = (size[a] - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tEnter) {
      tEnter = t0;
      enterAxis = a;
    }
    tExit = Math.min(tExit, t1);
  }
  if (tEnter > tExit) return null;

  const cell: Vec3 = [0, 0, 0];
  const step: Vec3 = [0, 0, 0];
  const tMax: Vec3 = [Infinity, Infinity, Infinity];
  const tDelta: Vec3 = [Infinity, Infinity, Infinity];
  for (let a = 0; a < 3; a += 1) {
    const d = direction[a];
    const p = origin[a] + d * tEnter;
    cell[a] = Math.min(size[a] - 1, Math.max(0, Math.floor(p)));
    if (d !== 0) {
      step[a] = d > 0 ? 1 : -1;
      tDelta[a] = Math.abs(1 / d);
      tMax[a] = ((d > 0 ? cell[a] + 1 : cell[a]) - origin[a]) / d;
    }
  }

  let normal: Vec3 = [0, 0, 0];
  if (enterAxis >= 0) normal[enterAxis] = -step[enterAxis];

  for (;;) {
    if (isSolid(cell[0], cell[1], cell[2])) {
      return { x: cell[0], y: cell[1], z: cell[2], normal };
    }
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    if (tMax[a] > tExit) return null;
    cell[a] += step[a];
    if (cell[a] < 0 || cell[a] >= size[a]) return null;
    tMax[a] += tDelta[a];
    normal = [0, 0, 0];
    normal[a] = -step[a];
  }
}

/**
 * Colonne visée par un impact. Démolition, ou construction sur le dessus
 * d'un bloc : la colonne touchée. Construction sur un flanc : la colonne
 * voisine, de ce côté (on bâtit "contre" le mur), si elle est dans la grille.
 */
export function targetColumn(
  hit: VoxelHit,
  build: boolean,
  width: number,
  depth: number,
): { x: number; z: number } {
  const [nx, ny, nz] = hit.normal;
  if (build && ny === 0 && (nx !== 0 || nz !== 0)) {
    const x = hit.x + nx;
    const z = hit.z + nz;
    if (x >= 0 && x < width && z >= 0 && z < depth) return { x, z };
  }
  return { x: hit.x, z: hit.z };
}
