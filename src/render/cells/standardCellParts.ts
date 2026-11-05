/**
 * Mur sans ouverture / fondation (coque creuse) — ex-StandardCell, porté en builder de parts.
 */

import { BlockType } from '../../types';
import { FACE_ROTATION_Y } from '../../utils/cellUtils';
import { shades } from '../../colorPalettes';
import { roundedBoxGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import { shellParts } from './shellParts';
import type { CellContext } from './context';

export function standardCellParts(ctx: CellContext): Part[] {
  const { cell, exposedFaces, settings } = ctx;

  const isFoundation = cell.type === BlockType.Foundation;
  const baseColor = settings.wallBaseColor;
  const { trimColor } = shades(baseColor, { trimColor: -0.08 });

  const parts: Part[] = shellParts(ctx, baseColor);

  // ── Plinthes (base trim) sur les faces exposées ────────────────────────────
  if (!isFoundation) {
    const trimGeo = roundedBoxGeo(1.02, 0.08, 0.02, 0.01, 2);
    for (const face of exposedFaces) {
      parts.push(
        part(trimGeo, trimColor, { roughness: 0.9 },
          mul(xform([0, 0, 0], [0, FACE_ROTATION_Y[face], 0]), xform([0, -0.46, 0.505]))),
      );
    }
  }

  // (Plus de "dalle de fondation" : posée à mi-hauteur de la cellule, elle
  // n'était qu'enfouie dans le bloc plein ; dans une coque creuse elle
  // flottait au milieu de la pièce. Le plancher de la coque en tient lieu.)

  return parts;
}
