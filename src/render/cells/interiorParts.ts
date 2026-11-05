/**
 * Finitions intérieures d'un bloc creux : parquet en bois (lames de 25 cm,
 * joints sombres), plafond enduit et une poutre par cellule. Sans elles, sol,
 * murs et plafond ont la teinte de la maçonnerie et l'intérieur se lit comme
 * une boîte uniforme.
 *
 * Tout reste dans le volume intérieur de la coque (`hollowSheetGeo` suit son
 * contour : coins arrondis des tours, piliers d'angle) et s'arrête au bord de
 * la cellule côté `open`, pour se raccorder au voisin sans chevauchement.
 */

import type { CornerRadii, HollowShape } from '../../utils/cellUtils';
import { varyColorBrightness } from '../../colorPalettes';
import { boxGeo, FLOOR_T, hollowSheetGeo, WALL_T } from '../geometryCache';
import { part, xform, type Part } from '../parts';
import type { CellContext } from './context';

const WOOD = '#9a6b43';
const BEAM_WOOD = '#6b4a32';
const FLOORBOARD_T = 0.008;
const CEILING_T = 0.006;
/** Joints de lames, espacés de 25 cm d'une cellule à l'autre. */
const SEAM_Z = [-0.375, -0.125, 0.125, 0.375];
const BEAM_W = 0.06;
const BEAM_H = 0.05;

/**
 * Demi-étendue intérieure le long de X (côté `sx`) à la profondeur `z` :
 * bord de la cellule côté ouvert, sinon face intérieure du mur, réduite dans
 * un coin arrondi (rayon intérieur = rayon du mur − WALL_T).
 */
function innerExtentX(hollow: HollowShape, radii: CornerRadii, sx: 1 | -1, z: number): number {
  const xSide = sx > 0 ? 'right' : 'left';
  if (hollow.sides[xSide] === 'open') return 0.5;
  const inner = 0.5 - WALL_T;
  const zSide = z > 0 ? 'front' : 'back';
  if (hollow.sides[zSide] === 'open') return inner;
  const corner = `${z > 0 ? 'front' : 'back'}${sx > 0 ? 'Right' : 'Left'}` as keyof Omit<CornerRadii, 'max' | 'uniform'>;
  const ri = Math.max(0, radii[corner] - WALL_T);
  const dz = Math.abs(z) - (inner - ri);
  if (ri <= 0 || dz <= 0) return inner;
  return inner - ri + Math.sqrt(Math.max(0, ri * ri - dz * dz));
}

/** Même chose le long de Z, côté `sz`, à l'abscisse `x`. */
function innerExtentZ(hollow: HollowShape, radii: CornerRadii, sz: 1 | -1, x: number): number {
  const zSide = sz > 0 ? 'front' : 'back';
  if (hollow.sides[zSide] === 'open') return 0.5;
  const inner = 0.5 - WALL_T;
  const xSide = x > 0 ? 'right' : 'left';
  if (hollow.sides[xSide] === 'open') return inner;
  const corner = `${sz > 0 ? 'front' : 'back'}${x > 0 ? 'Right' : 'Left'}` as keyof Omit<CornerRadii, 'max' | 'uniform'>;
  const ri = Math.max(0, radii[corner] - WALL_T);
  const dx = Math.abs(x) - (inner - ri);
  if (ri <= 0 || dx <= 0) return inner;
  return inner - ri + Math.sqrt(Math.max(0, ri * ri - dx * dx));
}

export function interiorParts(ctx: CellContext): Part[] {
  const { hollow, radii, cell, settings } = ctx;
  if (!hollow) return [];

  const floorY = -0.5 + FLOOR_T;
  const ceilingY = 0.5 - FLOOR_T;
  // Teinte de parquet légèrement variée d'une cellule à l'autre (déterministe).
  const hash = Math.abs(Math.imul(cell.x, 73856093) ^ Math.imul(cell.y, 19349663) ^ Math.imul(cell.z, 83492791));
  const floorColor = varyColorBrightness(WOOD, ((hash % 7) - 3) * 0.015);
  const seamColor = varyColorBrightness(WOOD, -0.4);
  const ceilingColor = varyColorBrightness(settings.wallBaseColor, -0.04);

  const parts: Part[] = [
    // Parquet posé sur la dalle, plafond enduit sous la dalle du dessus.
    part(hollowSheetGeo(radii, hollow, FLOORBOARD_T), floorColor, { roughness: 0.8 }, xform([0, floorY, 0])),
    part(hollowSheetGeo(radii, hollow, CEILING_T), ceilingColor, { roughness: 0.95 }, xform([0, ceilingY - CEILING_T, 0])),
  ];

  // Joints des lames (selon X), à fleur du parquet.
  for (const z of SEAM_Z) {
    const x0 = -innerExtentX(hollow, radii, -1, z);
    const x1 = innerExtentX(hollow, radii, 1, z);
    if (x1 - x0 < 0.02) continue;
    parts.push(part(boxGeo(+(x1 - x0).toFixed(3), 0.002, 0.008), seamColor, { roughness: 0.9 },
      xform([(x0 + x1) / 2, floorY + FLOORBOARD_T + 0.0005, z])));
  }

  // Poutre au milieu de la cellule : elle franchit la portée entre deux murs
  // (selon Z si la cellule est fermée devant et derrière), sinon elle file
  // selon X et se prolonge de cellule en cellule.
  const alongZ = hollow.sides.front !== 'open' && hollow.sides.back !== 'open';
  const beamY = ceilingY - CEILING_T - BEAM_H / 2;
  if (alongZ) {
    const z0 = -innerExtentZ(hollow, radii, -1, 0);
    const z1 = innerExtentZ(hollow, radii, 1, 0);
    parts.push(part(boxGeo(BEAM_W, BEAM_H, +(z1 - z0).toFixed(3)), BEAM_WOOD, { roughness: 0.9 },
      xform([0, beamY, (z0 + z1) / 2])));
  } else {
    const x0 = -innerExtentX(hollow, radii, -1, 0);
    const x1 = innerExtentX(hollow, radii, 1, 0);
    parts.push(part(boxGeo(+(x1 - x0).toFixed(3), BEAM_H, BEAM_W), BEAM_WOOD, { roughness: 0.9 },
      xform([(x0 + x1) / 2, beamY, 0])));
  }

  return parts;
}
