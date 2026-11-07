/**
 * Arche : un bloc de maçonnerie plein dont le dessous est creusé par un arc
 * surbaissé, qui s'appuie directement sur les murs voisins — comme une porte
 * de ville ou un pont de rempart, et non un portique sur piliers.
 *
 * Une arche enjambe une rue de 1 ou 2 cases : chaque case en dessine sa
 * tranche (corps + claveaux dont le milieu tombe dans la case), l'arc étant
 * calculé pour toute la portée. Conçue avec la portée selon X (passage selon
 * Z), tournée de 90° quand les murs porteurs sont de part et d'autre selon Z.
 * Claveaux en saillie sur les deux têtes, clé de voûte plus haute. Si rien
 * n'est bâti au-dessus, le dessus dépend des voisins de l'arche : le toit
 * à deux pans d'un appui qui arrive à ce niveau se prolonge sur l'arche ;
 * sinon chemin de ronde crénelé si elle touche une tour et que ses appuis
 * ont des murs à ce niveau (il relie deux murs) ; sinon toit à deux pans
 * (faîtage d'un appui à l'autre) si au moins deux bâtiments voisins en sont
 * coiffés ; sinon simple tablier dallé.
 */

import { BlockType } from '../../types';
import {
  getColumnTop,
  getCell,
  getCornerRadii,
  getRidgeAxis,
  hasOccupiedCell,
  isGableRoofCell,
  isIsolatedBlock,
  isRampart,
  isTowerColumn,
  type CellLookup,
  type CornerRadii,
} from '../../utils/cellUtils';
import { shades } from '../../colorPalettes';
import { archBodyGeo, archVoussoirGeo, archVoussoirMidX, cornerFilletGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import { gableRoofParts } from './roofCellParts';
import { crenellatedWalkwayParts, PARAPET_H, WALKWAY_H, walkwayDeckParts } from './walkwayParts';
import type { RenderSettings } from '../renderSettings';
import type { GridCell } from '../../types';
import type { CellContext } from './context';

/** Montée de l'intrados selon la portée (en cases) : l'arc reste surbaissé et laisse une clé épaisse. */
const ARCH_RISE: Record<number, number> = { 1: 0.42, 2: 0.66 };
const VOUSSOIR_RING = 0.13;
const VOUSSOIR_DEPTH = 0.03;

export function archCellParts(ctx: CellContext): Part[] {
  const { cell, lookup, settings } = ctx;
  const { x, y, z } = cell;

  const spanAlongX = hasOccupiedCell(lookup, x - 1, y, z) && hasOccupiedCell(lookup, x + 1, y, z);
  const G = xform([0, 0, 0], [0, spanAlongX ? 0 : Math.PI / 2, 0]);

  // Position de la case dans l'arche : cases Arch contiguës le long de la portée.
  const [dx, dz] = spanAlongX ? [1, 0] : [0, 1];
  const isArchAt = (k: number) => getCell(lookup, x + dx * k, y, z + dz * k)?.type === BlockType.Arch;
  let before = 0;
  while (isArchAt(-(before + 1))) before += 1;
  let after = 0;
  while (isArchAt(after + 1)) after += 1;
  const span = before + after + 1;
  // Tranche 0 = côté x local négatif. La rotation de 90° autour de Y envoie
  // le x local vers −z : en portée Z, la tranche 0 est donc côté z positif.
  const slice = spanAlongX ? before : after;
  const rise = ARCH_RISE[span] ?? ARCH_RISE[2];
  const offset = -span / 2 + slice + 0.5; // centre de la case dans le repère de l'arche

  const wall = settings.wallBaseColor;
  const { voussoir, keystone } = shades(wall, { voussoir: -0.08, keystone: -0.16 });
  const stone = { roughness: settings.wallRoughness };

  const parts: Part[] = [part(archBodyGeo(rise, span, slice), wall, stone, G)];

  // Claveaux sur les deux têtes de l'arche, légèrement en saillie ; chaque
  // case pose ceux dont le milieu tombe chez elle.
  const count = 5 + 4 * span; // impair : la clé de voûte est au milieu
  const middle = Math.floor(count / 2);
  for (let i = 0; i < count; i += 1) {
    const midX = archVoussoirMidX(rise, span, i, count);
    if (Math.abs(midX - offset) > 0.5 || (midX - offset === 0.5 && slice < span - 1)) continue;
    const isKey = i === middle;
    const geo = archVoussoirGeo(rise, i, count, VOUSSOIR_RING, VOUSSOIR_DEPTH, isKey ? 0.05 : 0, span);
    for (const side of [1, -1] as const) {
      const faceZ = side * (0.5 + VOUSSOIR_DEPTH / 2 - 0.01);
      parts.push(part(geo, isKey ? keystone : voussoir, { roughness: 0.9 }, mul(G, xform([-offset, 0, faceZ]))));
    }
  }

  // Rien au-dessus : le dessus dépend des colonnes voisines de l'arche
  // (toutes ses cases, pour un dessus uniforme).
  let topY = 0.5;
  if (!hasOccupiedCell(lookup, x, y + 1, z)) {
    let besideTower = false;
    const gabledColumns = new Set<string>();
    for (let k = -before; k <= after; k += 1) {
      const ax = x + dx * k;
      const az = z + dz * k;
      for (const [nx, nz] of [[ax - 1, az], [ax + 1, az], [ax, az - 1], [ax, az + 1]]) {
        const neighbour = getCell(lookup, nx, y, nz);
        if (!neighbour?.isOccupied || neighbour.type === BlockType.Arch) continue;
        if (isTowerColumn(lookup, neighbour)) besideTower = true;
        const top = getColumnTop(lookup, neighbour);
        if (top.type === BlockType.Roof && !isIsolatedBlock(lookup, top) && !isRampart(lookup, top)) {
          gabledColumns.add(`${nx},${nz}`);
        }
      }
    }

    // Ce qu'il y a, à hauteur du dessus de l'arche (y + 1), sur ses deux
    // appuis (les cases au-delà des deux bouts de la portée).
    const spanAxis = spanAlongX ? 'x' : 'z';
    // Axes des toits à deux pans d'appui qui arrivent à ce niveau.
    const continuingAxes: Array<'x' | 'z'> = [];
    let walkwayBlocked = false; // un appui n'y a pas de mur : un chemin de ronde n'y mènerait nulle part
    for (const k of [-before - 1, after + 1]) {
      const above = getCell(lookup, x + dx * k, y + 1, z + dz * k);
      if (!above?.isOccupied) {
        walkwayBlocked = true;
      } else if (above.type === BlockType.Roof) {
        if (isGableRoofCell(lookup, above)) {
          continuingAxes.push(getRidgeAxis(lookup, above));
          walkwayBlocked = true;
        } else if (isIsolatedBlock(lookup, above)) {
          walkwayBlocked = true; // pied de la flèche d'une tour, pas un mur
        }
      }
    }

    // Pignon aux bouts du toit seulement si rien n'est bâti contre, à hauteur
    // du toit. Faîtage selon la portée : pignons aux bouts de l'arche (pas
    // entre deux cases d'une même arche). Faîtage en travers : pignons sur
    // les deux têtes de l'arche.
    const endFree = (k: number) => !hasOccupiedCell(lookup, x + dx * k, y + 1, z + dz * k);
    const headFree = (s: number) => !hasOccupiedCell(lookup, x + dz * s, y + 1, z + dx * s);
    const archRoof = (axis: 'x' | 'z') => gableRoofParts(settings, axis === spanAxis
      ? { axis, gablePos: after === 0 && endFree(1), gableNeg: before === 0 && endFree(-1), baseY: 1 }
      : { axis, gablePos: headFree(1), gableNeg: headFree(-1), baseY: 1 });

    if (continuingAxes.length > 0) {
      // Le toit de l'appui continue par-dessus l'arche (et bute contre une
      // tour éventuelle) : pas de merlons de pierre adossés à des tuiles.
      // Même orientation que le toit de l'appui (celui qui suit la portée en
      // priorité) : un toit d'arche en travers butait, bout ouvert, contre le
      // pan descendant de ce toit — un trou.
      parts.push(...archRoof(continuingAxes.includes(spanAxis) ? spanAxis : continuingAxes[0]));
    } else if (besideTower && !walkwayBlocked) {
      // Chemin de ronde : il relie deux murs (tour, mur plus haut, courtine).
      parts.push(...crenellatedWalkwayParts(G, 0.5, settings));
      topY = 0.5 + WALKWAY_H + PARAPET_H;
    } else if (gabledColumns.size >= 2) {
      // Faîtage d'un appui à l'autre.
      parts.push(...archRoof(spanAxis));
    } else {
      parts.push(...walkwayDeckParts(G, 0.5, settings.wallBaseColor));
      topY = 0.5 + WALKWAY_H;
    }
  }

  // Appuis : l'arche bute de toute sa largeur contre ses voisins, mais une
  // tour garde ses coins arrondis sur toute sa hauteur — il resterait un jour
  // vertical dans chaque coin. On les comble, jusqu'en haut du parapet.
  if (before === 0) parts.push(...abutmentFillets(lookup, settings, cell, -dx, -dz, topY, stone));
  if (after === 0) parts.push(...abutmentFillets(lookup, settings, cell, dx, dz, topY, stone));

  return parts;
}

/**
 * Raccords d'angle entre l'arche et son appui situé dans la direction
 * (ddx, ddz) : pour chacun des deux coins de l'appui tournés vers l'arche,
 * comble l'espace entre le plan de la face de l'arche et l'arrondi du coin
 * (`cornerFilletGeo`), de y = −0.5 à `topY`. Ne déborde jamais du contour
 * de l'appui vers l'intérieur : une tour est creuse.
 */
function abutmentFillets(
  lookup: CellLookup,
  settings: RenderSettings,
  cell: GridCell,
  ddx: number,
  ddz: number,
  topY: number,
  mat: { roughness: number },
): Part[] {
  const support = getCell(lookup, cell.x + ddx, cell.y, cell.z + ddz);
  if (!support?.isOccupied || support.type === BlockType.Arch || support.type === BlockType.Roof) return [];
  const radii = getCornerRadii(lookup, support, settings);

  const parts: Part[] = [];
  // Les deux coins de l'appui sur sa face tournée vers l'arche, dans le
  // repère de l'arche : (cx, cz), et la direction (sx, sz) vers laquelle le
  // vide s'ouvre (vers l'appui, et vers le milieu de la face).
  for (const t of [-1, 1] as const) {
    const [cx, cz] = ddx !== 0 ? [ddx * 0.5, t * 0.5] : [t * 0.5, ddz * 0.5];
    // Coin correspondant dans le repère de l'appui (côté opposé à la direction).
    const [lx, lz] = ddx !== 0 ? [-ddx, t] : [t, -ddz];
    const name = `${lz > 0 ? 'front' : 'back'}${lx > 0 ? 'Right' : 'Left'}` as keyof Omit<CornerRadii, 'max' | 'uniform'>;
    const r = radii[name];
    if (r < 0.01) continue;
    const sx = ddx !== 0 ? ddx : -t;
    const sz = ddx !== 0 ? -t : ddz;
    // cornerFilletGeo s'étend vers (+X, +Z) : rotation qui l'envoie vers (sx, sz).
    const rotation = sx > 0 ? (sz > 0 ? 0 : Math.PI / 2) : sz > 0 ? -Math.PI / 2 : Math.PI;
    parts.push(part(cornerFilletGeo(r, +(topY + 0.5).toFixed(3)), settings.wallBaseColor, mat,
      xform([cx, -0.5, cz], [0, rotation, 0])));
  }
  return parts;
}
