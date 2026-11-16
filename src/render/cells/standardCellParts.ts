/**
 * Mur sans ouverture / fondation (coque creuse) — ex-StandardCell, porté en builder de parts.
 */

import type { Part } from '../parts';
import { shellParts } from './shellParts';
import { quoinHoles } from './decorations';
import { masonryFacesOf, masonryParts } from './masonryParts';
import type { CellContext } from './context';

export function standardCellParts(ctx: CellContext): Part[] {
  const { cell, settings } = ctx;
  const baseColor = settings.wallBaseColor;

  const parts: Part[] = shellParts(ctx, baseColor);

  // Parement de pierre (masonryParts.ts), continu d'un étage à l'autre. Plus
  // de « plinthe » au pied des faces : un bloc `Wall` n'est jamais au
  // rez-de-chaussée (toujours `WallWithWindow` ou `Foundation`), elle
  // filait donc à chaque niveau d'étage, et droite, elle sortait des coins
  // arrondis des tours.
  parts.push(
    ...masonryParts(
      ctx,
      // Taillé autour des chaînages d'angle (decorations.ts).
      masonryFacesOf(ctx.lookup, cell).map((face) => ({ face, holes: quoinHoles(ctx, face) })),
      baseColor,
      settings.windowStoneRoughness,
    ),
  );

  // (Plus de "dalle de fondation" : posée à mi-hauteur de la cellule, elle
  // n'était qu'enfouie dans le bloc plein ; dans une coque creuse elle
  // flottait au milieu de la pièce. Le plancher de la coque en tient lieu.)

  return parts;
}
