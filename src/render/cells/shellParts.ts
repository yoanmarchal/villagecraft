/**
 * Squelette commun aux cellules "murs" (Standard, WallWithWindow) —
 * ex-CellShell : corps principal (contour piloté par radii) + quoins.
 * Le reste (pierres, fenêtres, plinthes, zones protégées...) reste la
 * responsabilité de chaque builder : cette logique est intentionnellement
 * spécifique à chaque type de cellule (voir AGENTS.md).
 */

import { shapedBoxGeo } from '../geometryCache';
import { part, type Part } from '../parts';
import { quoinParts } from './decorations';
import type { CellContext } from './context';
import { useControlStore } from '../../store/controlStore';

export function shellParts(ctx: CellContext, baseColor: string): Part[] {
  const { wallRoughness: roughness } = useControlStore.getState();
  return [
    // Corps principal : forme pilotée par radii (coins exposés arrondis)
    part(shapedBoxGeo(1.0, 1.0, 1.0, ctx.radii), baseColor, { roughness }),
    // Pierres d'angle : communes aux deux cell types
    ...quoinParts(ctx, baseColor),
  ];
}
