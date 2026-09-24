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
 * n'est bâti au-dessus, le dessus dépend des voisins de l'arche : chemin de
 * ronde crénelé si elle touche une tour, toit à deux pans (faîtage d'un
 * appui à l'autre) si au moins deux bâtiments voisins sont coiffés d'un toit
 * à deux pans, sinon simple tablier dallé.
 */

import { BlockType } from '../../types';
import { getColumnTop, getCell, hasOccupiedCell, isIsolatedBlock, isRampart, isTowerColumn } from '../../utils/cellUtils';
import { shades } from '../../colorPalettes';
import { archBodyGeo, archVoussoirGeo, archVoussoirMidX } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import { gableRoofParts } from './roofCellParts';
import { crenellatedWalkwayParts, walkwayDeckParts } from './walkwayParts';
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

    if (besideTower) {
      parts.push(...crenellatedWalkwayParts(G, 0.5, settings));
    } else if (gabledColumns.size >= 2) {
      // Faîtage d'un appui à l'autre ; pignon aux bouts de l'arche seulement
      // si rien n'est bâti contre, à hauteur du toit.
      const endFree = (k: number) => !hasOccupiedCell(lookup, x + dx * k, y + 1, z + dz * k);
      parts.push(...gableRoofParts(settings, {
        axis: spanAlongX ? 'x' : 'z',
        gablePos: after === 0 && endFree(1),
        gableNeg: before === 0 && endFree(-1),
        baseY: 1,
      }));
    } else {
      parts.push(...walkwayDeckParts(G, 0.5, settings.wallBaseColor));
    }
  }

  return parts;
}
