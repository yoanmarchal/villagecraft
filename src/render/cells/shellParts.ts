/**
 * Squelette commun aux cellules "murs" (Standard, WallWithWindow) —
 * ex-CellShell : coque maçonnée creuse (contour piloté par radii, murs
 * épais, plancher, ouvertures traversantes) + quoins.
 * Le reste (pierres, fenêtres, plinthes, zones protégées...) reste la
 * responsabilité de chaque builder : cette logique est intentionnellement
 * spécifique à chaque type de cellule (voir AGENTS.md).
 */

import { hollowShellGeo, shapedBoxGeo, type OpeningSpec } from '../geometryCache';
import { part, type Part } from '../parts';
import { quoinParts } from './decorations';
import { interiorParts } from './interiorParts';
import type { CellContext } from './context';

export function shellParts(ctx: CellContext, baseColor: string, openings: OpeningSpec[] = []): Part[] {
  const { wallRoughness: roughness } = ctx.settings;
  // Coque creuse (bloc − volume intérieur − ouvertures). Le corps plein ne
  // sert plus que de repli si un builder de mur reçoit un contexte sans forme.
  const body = ctx.hollow ? hollowShellGeo(ctx.radii, ctx.hollow, openings) : shapedBoxGeo(1.0, 1.0, 1.0, ctx.radii);
  return [
    // Coque : seules ses faces de cavité reçoivent la lumière de la pièce.
    { ...part(body, baseColor, { roughness, doubleSide: ctx.hollow !== null, masonry: true }), interior: 'shell' },
    // Pierres d'angle : communes aux deux cell types
    ...quoinParts(ctx, baseColor),
    // Parquet, plafond, poutre, chandelier et mobilier de la pièce
    ...interiorParts(ctx, openings),
  ];
}
