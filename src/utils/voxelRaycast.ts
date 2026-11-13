/**
 * Lancer de rayon dans la grille de voxels.
 *
 * Sert à viser ce que l'on voit : la surface de clic est un plan sous le
 * sol, un rayon qui touche le toit d'une maison haute y arrive donc
 * *derrière* elle. On parcourt plutôt les colonnes traversées par le rayon
 * (DDA d'Amanatides & Woo, en plan) jusqu'à la première case occupée — exact
 * à la case près et bien moins cher qu'un raycast sur les ~1 M de sommets du
 * village fusionné.
 *
 * Repère "grille" : la case (x, y, z) occupe le cube
 * [x, x+1] × [b + y, b + y + 1] × [z, z+1], où b = `baseOf(x, z)` est le
 * niveau de sa colonne (0 sur terrain plat ; sur un terrain en pente chaque
 * bâtiment a le sien, voir ground.ts — la grille n'est donc régulière qu'en
 * plan, d'où le parcours colonne par colonne).
 */

export type Vec3 = [number, number, number];

export interface VoxelHit {
  x: number;
  y: number;
  z: number;
  /** Normale de la face d'entrée (axe unique, ±1) ; nulle si le rayon part de l'intérieur de la case. */
  normal: Vec3;
  /** Distance le long du rayon (en longueurs de `direction`). */
  t: number;
}

export function raycastVoxels(
  origin: Vec3,
  direction: Vec3,
  size: Vec3,
  isSolid: (x: number, y: number, z: number) => boolean,
  /**
   * Niveau de chaque colonne. S'il est fourni, la case du bas se prolonge
   * vers le bas (soubassement du bâtiment, jusqu'au terrain).
   */
  baseOf?: (x: number, z: number) => number,
): VoxelHit | null {
  const oy = origin[1];
  const dy = direction[1];
  const height = size[1];

  // Entrée/sortie du rayon dans l'emprise de la grille, en plan (méthode des slabs).
  let tEnter = 0;
  let tExit = Infinity;
  let enterAxis = -1;
  for (const a of [0, 2]) {
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

  const column = [0, 0];
  const step = [0, 0];
  const tMax = [Infinity, Infinity];
  const tDelta = [Infinity, Infinity];
  for (const [i, a] of [0, 2].entries()) {
    const d = direction[a];
    const p = origin[a] + d * tEnter;
    column[i] = Math.min(size[a] - 1, Math.max(0, Math.floor(p)));
    if (d !== 0) {
      step[i] = d > 0 ? 1 : -1;
      tDelta[i] = Math.abs(1 / d);
      tMax[i] = ((d > 0 ? column[i] + 1 : column[i]) - origin[a]) / d;
    }
  }

  // Face par laquelle le rayon est entré dans la colonne courante.
  let side: Vec3 = [0, 0, 0];
  if (enterAxis >= 0) side[enterAxis] = -step[enterAxis === 0 ? 0 : 1];

  let t0 = tEnter;
  for (;;) {
    const [cx, cz] = column;
    const t1 = Math.min(tMax[0], tMax[1], tExit);
    const base = baseOf ? baseOf(cx, cz) : 0;
    // Hauteurs d'entrée et de sortie dans la colonne, relatives à son niveau.
    const yIn = oy + dy * t0 - base;
    const yOut = dy === 0 ? yIn : oy + dy * t1 - base;
    /** Case où le rayon entre dans la colonne (−1 : au-dessus ou au-dessous). */
    const entry = yIn >= height ? -1 : yIn >= 0 ? Math.floor(yIn) : baseOf ? 0 : -1;

    if (dy <= 0) {
      if (yIn >= 0 || baseOf) {
        const from = Math.min(height - 1, Math.max(0, Math.floor(yIn)));
        const to = Math.max(0, Math.floor(yOut));
        for (let y = from; y >= to; y -= 1) {
          if (!isSolid(cx, y, cz)) continue;
          if (y === entry) return { x: cx, y, z: cz, normal: side, t: t0 };
          return { x: cx, y, z: cz, normal: [0, 1, 0], t: (base + y + 1 - oy) / dy };
        }
      }
    } else if (yIn < height) {
      const from = Math.max(0, Math.floor(yIn));
      const to = Math.min(height - 1, Math.floor(yOut));
      for (let y = from; y <= to; y += 1) {
        if (!isSolid(cx, y, cz)) continue;
        if (y === entry) return { x: cx, y, z: cz, normal: side, t: t0 };
        return { x: cx, y, z: cz, normal: [0, -1, 0], t: (base + y - oy) / dy };
      }
    }

    if (t1 >= tExit) return null;
    const i = tMax[0] < tMax[1] ? 0 : 1;
    column[i] += step[i];
    if (column[i] < 0 || column[i] >= size[i === 0 ? 0 : 2]) return null;
    t0 = tMax[i];
    tMax[i] += tDelta[i];
    side = [0, 0, 0];
    side[i === 0 ? 0 : 2] = -step[i];
  }
}

/**
 * Colonne visée par un impact. Démolition, ou construction sur le dessus
 * d'un bloc : la colonne touchée. Construction sur un flanc : la colonne
 * voisine, de ce côté (on bâtit "contre" le mur), si elle est dans la grille.
 */
export function targetColumn(
  hit: Pick<VoxelHit, 'x' | 'z' | 'normal'>,
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
