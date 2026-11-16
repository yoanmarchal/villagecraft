/**
 * Finitions intérieures d'un bloc creux : sol (dallage de pierre au
 * rez-de-chaussée, parquet aux étages — joints sombres tous les 25 cm),
 * plafond enduit sur solives, une poutre par cellule et un chandelier
 * par pièce (source de sa lumière le soir, voir roomLamps.ts). Sans elles, sol,
 * murs et plafond ont la teinte de la maçonnerie et l'intérieur se lit comme
 * une boîte uniforme.
 *
 * Tout reste dans le volume intérieur de la coque (`hollowSheetGeo` suit son
 * contour : coins arrondis des tours, piliers d'angle) et s'arrête au bord de
 * la cellule côté `open`, pour se raccorder au voisin sans chevauchement.
 */

import type { CellFace } from '../../utils/cellUtils';
import { varyColorBrightness } from '../../colorPalettes';
import {
  boxGeo,
  cylinderGeo,
  FLOOR_T,
  hollowSheetGeo,
  innerContourXZ,
  torusArcGeo,
  type OpeningSpec,
} from '../geometryCache';
import { asInterior, part, xform, type Part } from '../parts';
import { offsetPolygon, outsideSpans, outsideSpansOfBeam, type Point, type Polygon } from '../../utils/polygon';
import { furnitureParts, HOOD_REACH } from './furnitureParts';
import { spiralLanternParts, stairParts, stairwellRailingParts, trimmerParts } from './stairParts';
import type { CellContext } from './context';

const WOOD = '#9a6b43';
const BEAM_WOOD = '#6b4a32';
const FLOORBOARD_T = 0.008;
const CEILING_T = 0.006;
/** Joints de lames, espacés de 25 cm d'une cellule à l'autre. */
const SEAM_Z = [-0.375, -0.125, 0.125, 0.375];
const BEAM_W = 0.06;
const BEAM_H = 0.05;
/** Solives : portées par la poutre, quatre par cellule, alignées d'une cellule à l'autre. */
const JOIST_W = 0.028;
const JOIST_H = 0.026;
const JOIST_WOOD = '#7a573a';
/** Dallage du rez-de-chaussée (les étages sont planchéiés). */
const FLAGSTONE = '#8c8273';
/** Chevêtres qui bordent une trémie sous le plafond (les solives coupées s'y arrêtent). */
const TRIMMER_W = 0.04;
const TRIMMER_H = 0.04;

/**
 * Pièce de bois (ou joint) horizontale d'axe a→b à la hauteur `y`, coupée
 * là où elle traverserait une trémie : une boîte par tronçon restant.
 */
function clippedRun(
  a: Point,
  b: Point,
  y: number,
  [width, height]: [number, number],
  cuts: Polygon[],
  color: string,
  roughness: number,
): Part[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-6) return [];
  const ux = (b[0] - a[0]) / length;
  const uz = (b[1] - a[1]) / length;
  const spans = width > 0.01 ? outsideSpansOfBeam(a, b, width / 2, cuts) : outsideSpans(a, b, cuts);
  return spans
    .filter(([s0, s1]) => s1 - s0 > 0.01)
    .map(([s0, s1]) => {
      const mid = (s0 + s1) / 2;
      const run = +(s1 - s0).toFixed(3);
      // Boîte le long de X ou de Z (les pièces d'une cellule sont parallèles à ses murs).
      const size: [number, number, number] = Math.abs(ux) > Math.abs(uz) ? [run, height, width] : [width, height, run];
      return part(boxGeo(...size), color, { roughness }, xform([a[0] + ux * mid, y, a[1] + uz * mid]));
    });
}

// ── Chandelier ────────────────────────────────────────────────────────────
const IRON = '#2b2622';
const WAX = '#efe6d2';
/** Mèche : sombre le jour ; le soir, son émission (groupe "glow") en fait une flamme. */
const FLAME = '#4a3420';
const CHANDELIER_RING_Y = 0.18;
const CHANDELIER_RING_R = 0.09;
const CANDLE_R = 0.011;
const CANDLE_H = 0.045;
const FLAME_H = 0.024;
/**
 * Hauteur (y local de la cellule) des flammes du chandelier — c'est là que
 * growMaterial.ts place la lampe qui éclaire la pièce le soir.
 */
export const INTERIOR_LAMP_Y = CHANDELIER_RING_Y + 0.006 + CANDLE_H + FLAME_H / 2;

/**
 * Chandelier en fer suspendu à la poutre, au centre de la cellule : une
 * chaîne, une couronne et quatre bougies. ~250 sommets (soudés) — un par
 * pièce, ou par zone d'une grande salle.
 */
function chandelierParts(ceilingBottomY: number): { structure: Part[]; flames: Part[] } {
  const chainH = +(ceilingBottomY - CHANDELIER_RING_Y).toFixed(3);
  const structure: Part[] = [
    part(
      boxGeo(0.008, chainH, 0.008),
      IRON,
      { roughness: 0.6, metalness: 0.4 },
      xform([0, CHANDELIER_RING_Y + chainH / 2, 0]),
    ),
    part(
      torusArcGeo(CHANDELIER_RING_R, 0.006, 4, 16, Math.PI * 2),
      IRON,
      { roughness: 0.6, metalness: 0.4 },
      xform([0, CHANDELIER_RING_Y, 0], [Math.PI / 2, 0, 0]),
    ),
  ];
  const flames: Part[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const x = Math.cos(angle) * CHANDELIER_RING_R;
    const z = Math.sin(angle) * CHANDELIER_RING_R;
    const candleY = CHANDELIER_RING_Y + 0.006 + CANDLE_H / 2;
    structure.push(part(cylinderGeo(CANDLE_R, CANDLE_R, CANDLE_H, 6), WAX, { roughness: 0.7 }, xform([x, candleY, z])));
    flames.push(
      part(
        cylinderGeo(0, 0.007, FLAME_H, 5),
        FLAME,
        { roughness: 1, glow: true },
        xform([x, candleY + CANDLE_H / 2 + FLAME_H / 2, z]),
      ),
    );
  }
  return { structure, flames };
}

/**
 * Demi-étendue intérieure depuis l'axe de la cellule : distance de `origin`
 * au contour intérieur (`innerContourXZ` : nu des murs, bord de la cellule
 * côté ouvert, coins arrondis, gorges des jonctions) dans la direction
 * `dir` (±X ou ±Z). Poutre, solives et joints s'y arrêtent.
 */
function innerReach(contour: Polygon, [ox, oz]: Point, [dx, dz]: Point): number {
  let best = Infinity;
  for (let i = 0; i < contour.length; i += 1) {
    const [x0, z0] = contour[i];
    const [x1, z1] = contour[(i + 1) % contour.length];
    // Croisement du bord avec la droite portée par `dir` (horizontale ou verticale).
    if (dx !== 0) {
      if ((z0 - oz) * (z1 - oz) > 0 || z0 === z1) continue;
      const x = x0 + ((oz - z0) / (z1 - z0)) * (x1 - x0);
      const t = (x - ox) * dx;
      if (t > 0) best = Math.min(best, t);
    } else {
      if ((x0 - ox) * (x1 - ox) > 0 || x0 === x1) continue;
      const z = z0 + ((ox - x0) / (x1 - x0)) * (z1 - z0);
      const t = (z - oz) * dz;
      if (t > 0) best = Math.min(best, t);
    }
  }
  return Number.isFinite(best) ? best : 0;
}

export function interiorParts(ctx: CellContext, openings: OpeningSpec[] = []): Part[] {
  const { hollow, radii, cell, settings } = ctx;
  if (!hollow) return [];
  const contour = innerContourXZ(hollow, radii);
  const innerExtentX = (sx: 1 | -1, z: number) => innerReach(contour, [0, z], [sx, 0]);
  const innerExtentZ = (sz: 1 | -1, x: number) => innerReach(contour, [x, 0], [0, sz]);

  const floorY = -0.5 + FLOOR_T;
  const ceilingY = 0.5 - FLOOR_T;
  // Teinte de parquet légèrement variée d'une cellule à l'autre (déterministe).
  const hash = Math.abs(Math.imul(cell.x, 73856093) ^ Math.imul(cell.y, 19349663) ^ Math.imul(cell.z, 83492791));
  // Rez-de-chaussée dallé de pierre, étages planchéiés.
  const paved = cell.y === 0;
  const floorBase = paved ? FLAGSTONE : WOOD;
  const floorColor = varyColorBrightness(floorBase, ((hash % 7) - 3) * 0.015);
  const seamColor = varyColorBrightness(floorBase, -0.4);
  const ceilingColor = varyColorBrightness(settings.wallBaseColor, -0.04);

  // Trémies : celle de l'escalier qui arrive par le plancher, celle de
  // l'escalier (ou de l'échelle) qui part par le plafond (stairPlan.ts).
  const floorHole = ctx.stairBelow?.opening.points;
  const ceilingHole = ctx.stair?.opening.points;
  const floorCuts = floorHole ? [floorHole] : [];
  // Les solives s'arrêtent contre les chevêtres, posés au bord de la trémie.
  const ceilingCuts = ceilingHole ? [offsetPolygon(ceilingHole, TRIMMER_W)] : [];

  const parts: Part[] = [
    // Parquet posé sur la dalle, plafond enduit sous la dalle du dessus.
    part(hollowSheetGeo(radii, hollow, FLOORBOARD_T, floorHole), floorColor, { roughness: 0.8 }, xform([0, floorY, 0])),
    part(
      hollowSheetGeo(radii, hollow, CEILING_T, ceilingHole),
      ceilingColor,
      { roughness: 0.95 },
      xform([0, ceilingY - CEILING_T, 0]),
    ),
  ];

  // Joints des lames (selon X), à fleur du parquet.
  const seamY = floorY + FLOORBOARD_T + 0.0005;
  for (const z of SEAM_Z) {
    const x0 = -innerExtentX(-1, z);
    const x1 = innerExtentX(1, z);
    if (x1 - x0 < 0.02) continue;
    parts.push(...clippedRun([x0, z], [x1, z], seamY, [0.008, 0.002], floorCuts, seamColor, 0.9));
  }

  // Dallage : joints dans l'autre sens aussi (dalles de 25 cm).
  if (paved) {
    for (const x of SEAM_Z) {
      const z0 = -innerExtentZ(-1, x);
      const z1 = innerExtentZ(1, x);
      if (z1 - z0 < 0.02) continue;
      parts.push(...clippedRun([x, z0], [x, z1], seamY, [0.008, 0.002], floorCuts, seamColor, 0.9));
    }
  }

  // Poutre au milieu de la cellule : elle franchit la portée entre deux murs
  // (selon Z si la cellule est fermée devant et derrière), sinon elle file
  // selon X et se prolonge de cellule en cellule. Une vis n'en a pas : son
  // noyau porte le plancher, et une poutre barrerait la volée.
  const alongZ = hollow.sides.front !== 'open' && hollow.sides.back !== 'open';
  const beamY = ceilingY - CEILING_T - BEAM_H / 2;
  const framed = ctx.stair?.kind !== 'spiral';
  // Une poutre qui aboutit au mur de la cheminée s'arrête contre sa hotte
  // (qui monte jusqu'au plafond), 5 mm dedans pour ne pas laisser de jour.
  const hoodStop = (face: CellFace) => (ctx.fireplaceFace === face ? HOOD_REACH - 0.005 : 0);
  if (framed && alongZ) {
    const z0 = -innerExtentZ(-1, 0) + hoodStop('back');
    const z1 = innerExtentZ(1, 0) - hoodStop('front');
    parts.push(...clippedRun([0, z0], [0, z1], beamY, [BEAM_W, BEAM_H], ceilingCuts, BEAM_WOOD, 0.9));
  } else if (framed) {
    const x0 = -innerExtentX(-1, 0) + hoodStop('left');
    const x1 = innerExtentX(1, 0) - hoodStop('right');
    parts.push(...clippedRun([x0, 0], [x1, 0], beamY, [BEAM_W, BEAM_H], ceilingCuts, BEAM_WOOD, 0.9));
  }

  // Solives, perpendiculaires à la poutre, plaquées sous le plafond.
  const joistY = ceilingY - CEILING_T - JOIST_H / 2;
  for (const offset of framed ? SEAM_Z : []) {
    if (alongZ) {
      const x0 = -innerExtentX(-1, offset);
      const x1 = innerExtentX(1, offset);
      if (x1 - x0 < 0.05) continue;
      parts.push(...clippedRun([x0, offset], [x1, offset], joistY, [JOIST_W, JOIST_H], ceilingCuts, JOIST_WOOD, 0.9));
    } else {
      const z0 = -innerExtentZ(-1, offset);
      const z1 = innerExtentZ(1, offset);
      if (z1 - z0 < 0.05) continue;
      parts.push(...clippedRun([offset, z0], [offset, z1], joistY, [JOIST_W, JOIST_H], ceilingCuts, JOIST_WOOD, 0.9));
    }
  }

  // Escaliers : celui qui monte d'ici, les chevêtres de sa trémie, et le
  // garde-corps autour de celle de l'escalier qui arrive par le plancher.
  parts.push(
    ...stairParts(ctx),
    ...trimmerParts(ctx, ceilingY - CEILING_T - TRIMMER_H / 2, [TRIMMER_W, TRIMMER_H], BEAM_WOOD),
    ...stairwellRailingParts(ctx),
  );

  // Mobilier (furnitureParts.ts) : éclairé par la pièce comme le reste.
  parts.push(...furnitureParts(ctx, openings));

  // Chandelier sous la poutre, dans la cellule désignée de la pièce
  // (assignRoomLamps). Ses flammes ne sont pas "éclairées par la pièce" :
  // ce sont elles la source (émission du groupe glow, le soir).
  if (!ctx.chandelier) return asInterior('room', parts);
  // Dans une vis, le noyau tient le centre : un falot y pend à la place du chandelier.
  if (ctx.stair?.kind === 'spiral') {
    const lantern = spiralLanternParts(ctx.stair, INTERIOR_LAMP_Y);
    parts.push(...lantern.structure);
    return [...asInterior('room', parts), ...lantern.flames];
  }
  const chandelier = chandelierParts(beamY - BEAM_H / 2);
  parts.push(...chandelier.structure);

  return [...asInterior('room', parts), ...chandelier.flames];
}
