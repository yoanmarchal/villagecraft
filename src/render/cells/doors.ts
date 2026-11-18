/**
 * Portes : ce que partagent leur géométrie (wallWindowCellParts.ts), leurs
 * collisions (walk/cellColliders.ts) et leur ouverture en promenade
 * (VillageMeshes) — largeur réelle de l'ouverture, perron, côté des gonds.
 *
 * Le vantail pivote vers l'intérieur autour de ses gonds, sur le chant
 * intérieur du côté `hingeSide` ; il est rendu à part (un petit groupe par
 * porte, voir `Part.door`) pour que la page puisse l'ouvrir sans rien refusionner.
 */

import { FACE_ROTATION_Y, getFaceCorners, type CellFace, type CornerRadii } from '../../utils/cellUtils';
import { polygonsOverlap, type Polygon } from '../../utils/polygon';
import { OPENING_SIZES, WALL_T, type OpeningKind } from '../geometryCache';
import type { DoorHinge, Vec3 } from '../parts';
import type { CellContext } from './context';
import { faceFramePoint, stairObstacles } from './stairPlan';

/** Largeur nominale du cadre de chaque ouverture (le jour, lui, fait `OPENING_SIZES[kind].w`). */
const NOMINAL_WIDTH: Record<OpeningKind, number> = { door: 0.48, slit: 0.14, window: 0.6 };
/** Une ouverture n'est jamais rétrécie en deçà (au prix d'un léger débord à rayon extrême). */
const MIN_OPENING_SCALE = 0.75;

/**
 * La face d'un mur n'est plate qu'entre l'arrondi de ses coins (largeur
 * `1 - 2 × rayon`) : cadre et ouverture doivent y tenir, on les rétrécit.
 */
export function openingScale(radii: CornerRadii, face: CellFace, kind: OpeningKind): number {
  const [crNeg, crPos] = getFaceCorners(face, radii, 'numeric');
  const flatWidth = 1 - 2 * Math.max(crNeg, crPos);
  return Math.min(1, Math.max(MIN_OPENING_SCALE, flatWidth / NOMINAL_WIDTH[kind]));
}

/** Profondeur (repère de face, vers l'extérieur) du milieu de l'épaisseur du mur, où se loge le vantail. */
export const REVEAL_Z = 0.5 - WALL_T / 2;
/** Épaisseur du fond du vantail ; ses gonds sont sur son chant intérieur. */
export const DOOR_PANEL_T = 0.03;
/** Ouverture complète (rad) : un peu plus d'un quart de tour, le vantail s'écarte du passage. */
export const DOOR_OPEN_ANGLE = (100 * Math.PI) / 180;

/** Perron (terrain en pente) : hauteur et giron d'une marche (~18 × 27 cm), nombre maximal de marches. */
const STEP_RISE = 0.065;
const STEP_RUN = 0.095;
const STEP_MAX = 10;

/** Marche du perron, en repère de face : giron de `near` à `near + run`, dessus à `top`, sur `width` centrée. */
export interface DoorStep {
  top: number;
  height: number;
  near: number;
  run: number;
  width: number;
}

/**
 * Terrain en pente : le seuil est au niveau du bâtiment, le sol devant la
 * porte parfois plus bas. Des marches de pierre descendent alors de la porte
 * jusqu'à lui — autant qu'il en faut, chacune fondée dans le terrain.
 */
export function doorSteps(ctx: Pick<CellContext, 'groundAt' | 'cell'>, face: CellFace, scale: number): DoorStep[] {
  const { groundAt } = ctx;
  if (!groundAt || ctx.cell.y !== 0) return [];
  const rotation = FACE_ROTATION_Y[face];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  /** Terrain au point (u le long de la façade, w vers l'extérieur) du repère de la face. */
  const groundFace = (u: number, w: number) => groundAt(u * cos + w * sin, -u * sin + w * cos);
  const width = OPENING_SIZES.door.w * scale + 0.16;
  const steps: DoorStep[] = [];
  for (let k = 0; k < STEP_MAX; k += 1) {
    const top = -0.5 - k * STEP_RISE;
    const near = 0.5 + k * STEP_RUN;
    // Marche utile tant que le sol est nettement plus bas que son giron.
    if (top - groundFace(0, near + STEP_RUN / 2) < 0.012) break;
    let lowest = Infinity;
    for (const u of [-width / 2, 0, width / 2]) {
      for (const w of [near, near + STEP_RUN]) lowest = Math.min(lowest, groundFace(u, w));
    }
    const height = Math.ceil((top - lowest + 0.03) * 50) / 50;
    steps.push({ top, height, near, run: STEP_RUN, width: +width.toFixed(3) });
  }
  return steps;
}

/** Aire balayée par le vantail en s'ouvrant (repère de la cellule), gonds du côté `side` (−1 / +1 en latéral). */
export function doorSwingArea(face: CellFace, scale: number, side: -1 | 1): Polygon {
  const w = OPENING_SIZES.door.w * scale;
  const hingeL = (side * w) / 2;
  const hingeD = REVEAL_Z - DOOR_PANEL_T / 2;
  const points: Polygon = [faceFramePoint(face, hingeL, hingeD)];
  for (let i = 0; i <= 6; i += 1) {
    const angle = (DOOR_OPEN_ANGLE * i) / 6;
    // Chant libre : part du côté opposé aux gonds, entre dans la pièce (profondeur décroissante).
    points.push(faceFramePoint(face, hingeL - side * w * Math.cos(angle), hingeD - w * Math.sin(angle)));
  }
  return points;
}

/**
 * Côté des gonds : à gauche (latéral −) par défaut ; à droite si, à gauche,
 * le vantail ouvert heurterait l'escalier de la cellule ou la trémie de
 * celui qui y arrive (planifiés après les portes).
 */
export function doorHingeSide(ctx: Pick<CellContext, 'stair' | 'stairBelow'>, face: CellFace, scale: number): -1 | 1 {
  const obstacles = stairObstacles(ctx);
  const clear = (side: -1 | 1) => !obstacles.some((o) => polygonsOverlap(doorSwingArea(face, scale, side), o));
  return clear(-1) || !clear(1) ? -1 : 1;
}

/**
 * Pose des pièces mobiles d'une porte ouverte de `angle` (0 = fermée) :
 * rotation autour de +y, et translation qui garde la charnière en place
 * (leurs sommets sont déjà en monde).
 */
export function doorPose(door: DoorHinge, angle: number): { rotationY: number; position: Vec3 } {
  const rotationY = door.sign * angle;
  const [hx, , hz] = door.hinge;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  return { rotationY, position: [hx - (hx * cos + hz * sin), 0, hz - (-hx * sin + hz * cos)] };
}
