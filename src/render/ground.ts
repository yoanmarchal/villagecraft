/**
 * Le village sur un terrain en pente.
 *
 * Un bâtiment ne penche jamais et ses pièces restent de plain-pied : toutes
 * les colonnes qui se touchent (4-connexes, arches comprises — elles relient
 * leurs deux appuis) partagent une même cote de sol, le « niveau » du
 * bâtiment. C'est le point le plus haut du terrain sous son emprise : côté
 * amont le seuil est au ras du sol, côté aval le bâtiment repose sur un
 * soubassement de pierre (plinthParts.ts) — jamais d'herbe dans une pièce.
 * Des bâtiments séparés par une rue ont chacun leur niveau ; la rue, elle,
 * suit la pente (pavingParts.ts).
 *
 * Toute la logique de voisinage (pièces communes, faîtages, courtines,
 * arches) continue donc de raisonner sur une grille régulière : seul le
 * placement vertical des colonnes change, ici.
 */

import type { GridCell } from '../types';
import { isFlatRelief, reliefBound, reliefHeight, type Relief } from './relief';

type ToWorld = (x: number, y: number, z: number) => [number, number, number];

export interface Ground {
  relief: Relief;
  /** Hauteur du terrain en (x, z) monde. */
  heightAt: (worldX: number, worldZ: number) => number;
  /**
   * Niveau (y monde du pied) de la colonne (x, z) de la grille : celui de son
   * bâtiment si elle est bâtie, sinon celui qu'aurait un bloc posé là.
   */
  baseAt: (x: number, z: number) => number;
}

/** Échantillons par côté de case pour chercher le point haut du terrain sous un bloc. */
const SAMPLES = 5;

const columnKey = (x: number, z: number) => `${x},${z}`;

export function createGround(cells: GridCell[], toWorldPosition: ToWorld, relief: Relief): Ground {
  if (isFlatRelief(relief)) {
    return { relief, heightAt: () => 0, baseAt: () => 0 };
  }
  const heightAt = (worldX: number, worldZ: number) => reliefHeight(worldX, worldZ, relief);

  /** Point haut du terrain sous la case (x, z), arrondi au centimètre supérieur. */
  const footprintTop = (x: number, z: number) => {
    const [wx, , wz] = toWorldPosition(x, 0, z);
    let top = -Infinity;
    for (let i = 0; i < SAMPLES; i += 1) {
      for (let j = 0; j < SAMPLES; j += 1) {
        top = Math.max(top, heightAt(wx - 0.5 + i / (SAMPLES - 1), wz - 0.5 + j / (SAMPLES - 1)));
      }
    }
    // Au centième : le pivot des cellules est stocké en entiers (voir mergeParts).
    return Math.ceil(top * 100 - 1e-6) / 100;
  };

  // Colonnes bâties, et celles qui touchent le sol (une arche n'y touche pas).
  const columns = new Map<string, { x: number; z: number; grounded: boolean }>();
  for (const cell of cells) {
    const key = columnKey(cell.x, cell.z);
    const column = columns.get(key);
    if (!column) columns.set(key, { x: cell.x, z: cell.z, grounded: cell.y === 0 });
    else if (cell.y === 0) column.grounded = true;
  }

  // Bâtiments : composantes 4-connexes des colonnes bâties.
  const bases = new Map<string, number>();
  for (const [start, first] of columns) {
    if (bases.has(start)) continue;
    const group = [first];
    bases.set(start, 0);
    for (let i = 0; i < group.length; i += 1) {
      const { x, z } = group[i];
      for (const [nx, nz] of [
        [x - 1, z],
        [x + 1, z],
        [x, z - 1],
        [x, z + 1],
      ]) {
        const key = columnKey(nx, nz);
        const neighbour = columns.get(key);
        if (!neighbour || bases.has(key)) continue;
        bases.set(key, 0);
        group.push(neighbour);
      }
    }
    const grounded = group.filter((column) => column.grounded);
    const base = Math.max(...(grounded.length > 0 ? grounded : group).map(({ x, z }) => footprintTop(x, z)));
    for (const { x, z } of group) bases.set(columnKey(x, z), base);
  }

  const free = new Map<string, number>();
  const baseAt = (x: number, z: number) => {
    const key = columnKey(x, z);
    const known = bases.get(key) ?? free.get(key);
    if (known !== undefined) return known;
    // Case libre : un bloc posé là rejoindrait les bâtiments voisins.
    const base = Math.max(
      footprintTop(x, z),
      bases.get(columnKey(x - 1, z)) ?? -Infinity,
      bases.get(columnKey(x + 1, z)) ?? -Infinity,
      bases.get(columnKey(x, z - 1)) ?? -Infinity,
      bases.get(columnKey(x, z + 1)) ?? -Infinity,
    );
    free.set(key, base);
    return base;
  };

  return { relief, heightAt, baseAt };
}

/**
 * Premier point du terrain touché par un rayon (monde), ou null. Marche le
 * long du rayon puis affine par dichotomie : le relief est doux, un pas d'un
 * quart d'unité ne saute par-dessus aucune bosse.
 */
export function raycastGround(
  ground: Ground,
  origin: [number, number, number],
  direction: [number, number, number],
  maxDistance = 400,
): { t: number; x: number; z: number } | null {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  const above = (t: number) => oy + dy * t - ground.heightAt(ox + dx * t, oz + dz * t);
  if (above(0) <= 0) return { t: 0, x: ox, z: oz };
  if (isFlatRelief(ground.relief)) {
    if (dy >= 0) return null;
    const t = -oy / dy;
    return t <= maxDistance ? { t, x: ox + dx * t, z: oz + dz * t } : null;
  }
  // Rien à chercher tant que le rayon vole au-dessus du plus haut relief possible.
  const ceiling = reliefBound(ground.relief) + 0.01;
  let t = dy < 0 && oy > ceiling ? (ceiling - oy) / dy : 0;
  const step = 0.25;
  while (t < maxDistance) {
    const next = t + step;
    if (above(next) <= 0) {
      let low = t;
      let high = next;
      for (let i = 0; i < 16; i += 1) {
        const mid = (low + high) / 2;
        if (above(mid) <= 0) high = mid;
        else low = mid;
      }
      return { t: high, x: ox + dx * high, z: oz + dz * high };
    }
    // Reparti au-dessus de tout relief en montant : il ne redescendra pas.
    if (dy >= 0 && oy + dy * next > ceiling) return null;
    t = next;
  }
  return null;
}
