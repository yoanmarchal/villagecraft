/**
 * Soubassement : sur un terrain en pente, un bâtiment reste de niveau (son
 * pied est au point haut du terrain sous lui, voir ground.ts) ; là où le sol
 * descend, ses murs se prolongent jusqu'à lui en maçonnerie pleine. Même
 * contour que la cellule (tours comprises), même parement de pierre que le
 * mur au-dessus — l'appareil est calculé dans le repère de la grille, les
 * assises se poursuivent sans rupture.
 */

import { shapedBoxGeo } from '../geometryCache';
import { part, xform, type Part } from '../parts';
import type { CellFace } from '../../utils/cellUtils';
import { masonryFacesOf, masonryParts } from './masonryParts';
import type { CellContext } from './context';

/** Enfouissement sous le terrain (pas de jour au pied du mur). */
const EMBED = 0.05;
/** En deçà, le terrain affleure le pied du mur : pas de soubassement. */
const MIN_DEPTH = 0.004;
/** Points sondés le long d'un côté de la case. */
const SAMPLES = 5;

type Point = [number, number];

/** Extrémités (x, z) de l'arête basse de chaque face. */
const FACE_EDGE: Record<CellFace, [Point, Point]> = {
  front: [
    [-0.5, 0.5],
    [0.5, 0.5],
  ],
  back: [
    [-0.5, -0.5],
    [0.5, -0.5],
  ],
  left: [
    [-0.5, -0.5],
    [-0.5, 0.5],
  ],
  right: [
    [0.5, -0.5],
    [0.5, 0.5],
  ],
};

export function plinthParts(ctx: CellContext): Part[] {
  const { cell, groundAt, lookup, radii, settings } = ctx;
  if (!groundAt || cell.y !== 0) return [];

  /** Profondeur du terrain sous le pied de la cellule, au plus bas du segment. */
  const depthAlong = ([x0, z0]: Point, [x1, z1]: Point) => {
    let lowest = Infinity;
    for (let i = 0; i < SAMPLES; i += 1) {
      const t = i / (SAMPLES - 1);
      lowest = Math.min(lowest, groundAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t));
    }
    return -0.5 - lowest;
  };

  const faces = masonryFacesOf(lookup, cell)
    .map((face) => ({ face, depth: depthAlong(...FACE_EDGE[face]) }))
    .filter(({ depth }) => depth > MIN_DEPTH);
  if (faces.length === 0) return [];

  // Noyau : jusqu'au plus bas des faces visibles, par pas de 5 cm (géométries partagées).
  const deepest = Math.max(...faces.map(({ depth }) => depth));
  const height = Math.ceil((deepest + EMBED) * 20) / 20;
  return [
    part(
      shapedBoxGeo(1, height, 1, radii),
      settings.wallBaseColor,
      { roughness: settings.wallRoughness, masonry: true },
      xform([0, -0.5 - height / 2, 0]),
    ),
    ...masonryParts(
      ctx,
      faces.map(({ face, depth }) => ({ face, yRange: [-0.5 - depth - EMBED, -0.5] as [number, number] })),
      settings.wallBaseColor,
      settings.windowStoneRoughness,
    ),
  ];
}
