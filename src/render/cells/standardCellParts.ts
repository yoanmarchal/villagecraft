/**
 * Mur plein / fondation — ex-StandardCell, porté en builder de parts.
 */

import { BlockType } from '../../types';
import { FACE_ROTATION_Y } from '../../utils/cellUtils';
import { shades } from '../../colorPalettes';
import { STANDARD_PROTECTED_AREAS, checkInProtectedZones } from '../../config/protectedAreasConfig';
import { roundedBoxGeo, shapedBoxGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import { shellParts } from './shellParts';
import { stoneParts } from './stoneParts';
import { isQuoinProtected } from './decorations';
import type { CellContext } from './context';
import { useControlStore } from '../../store/controlStore';

export function standardCellParts(ctx: CellContext): Part[] {
  const { cell, lookup, exposedFaces, radii, isIsolated } = ctx;
  const { standardStonesPerFace, standardStoneRoughness } = useControlStore.getState();

  const isFoundation = cell.type === BlockType.Foundation;
  const baseColor = cell.color ?? (isFoundation ? '#8d8a80' : '#c0b0a0');
  const { patchColor, trimColor } = shades(baseColor, { patchColor: -0.15, trimColor: -0.08 });

  const parts: Part[] = shellParts(ctx, baseColor);

  // ── Pierres apparentes (style STONE uniquement) ───────────────────────────
  if (exposedFaces.length > 0 && cell.propertyBundle?.decorationStyle === 'STONE') {
    parts.push(
      ...stoneParts({
        cell,
        exposedFaces,
        isIsolated,
        radii,
        cornerMode: 'numeric',
        wallSurfaceOffset: 0.003,
        stonesPerFace: standardStonesPerFace,
        baseSize: { width: 0.14, height: 0.09 },
        visual: {
          thickness: 0.012,
          cornerRadius: 0.004,
          smoothness: 2,
          color: patchColor,
          roughness: standardStoneRoughness,
        },
        // 🔒 Zone protégée propre à StandardCell (quoins, base trim, etc.)
        isInProtectedZone: (face, x, y, w, h) => {
          if (checkInProtectedZones(STANDARD_PROTECTED_AREAS, x, y, w, h)) return true;
          if (isQuoinProtected(cell, lookup, isIsolated, face, x, w)) return true;
          return false;
        },
      }),
    );
  }

  // ── Plinthes (base trim) sur les faces exposées ────────────────────────────
  if (!isFoundation) {
    const flags = cell.propertyBundle?.mergeFlags.suppressBaseTrim;
    const allSuppressed = flags && flags.front && flags.back && flags.left && flags.right;
    if (!allSuppressed) {
      const trimGeo = roundedBoxGeo(1.02, 0.08, 0.02, 0.01, 2);
      for (const face of exposedFaces) {
        if (cell.propertyBundle?.mergeFlags.suppressBaseTrim[face]) continue;
        parts.push(
          part(trimGeo, trimColor, { roughness: 0.9 },
            mul(xform([0, 0, 0], [0, FACE_ROTATION_Y[face], 0]), xform([0, -0.46, 0.505]))),
        );
      }
    }
  }

  // ── Dalle de fondation en pierre ───────────────────────────────────────────
  if (isFoundation) {
    parts.push(part(shapedBoxGeo(1.08, 0.02, 1.08, radii), '#7d7a70', { roughness: 0.96 }));
  }

  return parts;
}
