/**
 * Décorations d'angle communes (quoins) + protection associée.
 * Ex-cornerDecorations.tsx, porté en builders de parts. La détection de
 * coin exposé est mutualisée via `isCornerExposed` (cellUtils).
 */

import type { GridCell } from '../../types';
import type { CellLookup } from '../../utils/cellUtils';
import { CELL_CORNERS, isCornerExposed } from '../../utils/cellUtils';
import { varyColorBrightness } from '../../colorPalettes';
import { roundedBoxGeo } from '../geometryCache';
import { part, xform, type Part } from '../parts';
import type { CellContext } from './context';
import { useControlStore } from '../../store/controlStore';

/**
 * True si une pierre placée en (x ± w/2) sur `face` empiéterait sur un quoin.
 * Utilisé par les zones protégées des stone patches.
 */
export function isQuoinProtected(
  cell: GridCell,
  lookup: CellLookup,
  isIsolated: boolean,
  face: string,
  x: number,
  w: number,
): boolean {
  if (isIsolated) return false;

  const { quoinMargin: margin } = useControlStore.getState();
  const isNearLeft = x - w / 2 < -0.5 + margin;
  const isNearRight = x + w / 2 > 0.5 - margin;
  if (!isNearLeft && !isNearRight) return false;

  const checkEdge = (isLeftEdge: boolean): boolean => {
    let dx = 0;
    let dz = 0;

    if (face === 'front') { dz = 1; dx = isLeftEdge ? -1 : 1; }
    else if (face === 'back') { dz = -1; dx = isLeftEdge ? -1 : 1; }
    else if (face === 'left') { dx = -1; dz = isLeftEdge ? -1 : 1; }
    else if (face === 'right') { dx = 1; dz = isLeftEdge ? -1 : 1; }

    return isCornerExposed(lookup, cell, dx, dz);
  };

  if (isNearLeft && checkEdge(true)) return true;
  if (isNearRight && checkEdge(false)) return true;
  return false;
}

/** Pierres d'angle (3 niveaux alternés) sur chaque coin exposé non supprimé. */
export function quoinParts(ctx: CellContext, baseColor: string): Part[] {
  const { cell, lookup, isIsolated } = ctx;

  // Les tours n'ont pas de quoins
  if (isIsolated) return [];

  const { quoinRoughness } = useControlStore.getState();
  const quoinColor = varyColorBrightness(baseColor, -0.12);
  const mat = { roughness: quoinRoughness };
  const parts: Part[] = [];

  // Niveaux 0 et 2 : longs le long de X ; niveau 1 : long le long de Z
  const w1x = 0.16;
  const w1z = 0.08;
  const w2x = 0.08;
  const w2z = 0.16;
  const protrusion = 0.01;
  const geoA = roundedBoxGeo(w1x, 0.18, w1z, 0.01, 2);
  const geoB = roundedBoxGeo(w2x, 0.18, w2z, 0.01, 2);

  for (const { dx, dz } of CELL_CORNERS) {
    if (!isCornerExposed(lookup, cell, dx, dz)) continue;

    const posX1 = dx * (0.5 + protrusion - w1x / 2);
    const posZ1 = dz * (0.5 + protrusion - w1z / 2);
    const posX2 = dx * (0.5 + protrusion - w2x / 2);
    const posZ2 = dz * (0.5 + protrusion - w2z / 2);

    parts.push(
      part(geoA, quoinColor, mat, xform([posX1, -0.32, posZ1])),
      part(geoB, quoinColor, mat, xform([posX2, 0.0, posZ2])),
      part(geoA, quoinColor, mat, xform([posX1, 0.32, posZ1])),
    );
  }

  return parts;
}
