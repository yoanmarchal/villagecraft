/**
 * Escaliers intérieurs, du rez-de-chaussée au grenier : planification et
 * gabarits (trémie, emprise au sol). La géométrie est dans stairParts.ts.
 *
 * Par pièce (cellules creuses d'un étage reliées par leurs côtés ouverts,
 * voir findRooms), de bas en haut :
 *  - pour chaque pièce de l'étage du dessus posée sur elle, un escalier qui
 *    y monte, dans une cellule de la pièce située sous cette pièce : en L
 *    dans les maisons (deux volées le long de deux murs, palier dans le
 *    coin), en vis dans les tours (colonne `isTowerColumn` : noyau central,
 *    marches en éventail, même départ à chaque étage) ;
 *  - une pièce sans étage au-dessus (dernier étage) : une échelle de meunier
 *    contre un mur, jusqu'à une trappe dans le plafond — ouverte sur le
 *    grenier d'un toit à deux pans, fermée sous la flèche ou la plate-forme
 *    d'une tour, le chemin de ronde d'une courtine.
 * Chaque escalier perce une trémie dans le plafond de sa cellule et dans le
 * plancher de la cellule du dessus (hollowShellGeo, hollowSheetGeo), bordée
 * de chevêtres en dessous et d'un garde-corps au-dessus. Cheminées et
 * meubles s'écartent des emprises (`stairObstacles`). Ne dépend que de la
 * forme du village.
 *
 * Échelle : un étage fait une unité de plancher à plancher (une case,
 * `CELL_METERS`). Le nombre de contremarches en découle (~17,5 cm chacune,
 * `TARGET_RISE`) : 16 pour une case de 2,8 m, 20 pour 3,36 m ; les volées
 * s'allongent d'autant, leurs marches se raccourcissent pour tenir entre les murs.
 */

import { BlockType, type GridCell } from '../../types';
import { FACE_ROTATION_Y, getCell, isGableRoofCell, type CellFace } from '../../utils/cellUtils';
import { findRooms } from '../../utils/roomLamps';
import { offsetPolygon, polygonInside, polygonsOverlap, type Point, type Polygon } from '../../utils/polygon';
import { FLOOR_T, innerContourXZ, OPENING_SIZES, WALL_T } from '../geometryCache';
import { meters } from '../../config/scale';
import type { CellContext } from './context';
import { openingKindsOf } from './openings';

/** Dessus du plancher (dalle FLOOR_T + lames de 8 mm, voir interiorParts). */
export const STAIR_FLOOR_Y = -0.5 + FLOOR_T + 0.008;
/** Nu intérieur des murs. */
export const STAIR_INNER = 0.5 - WALL_T;
/** Jour entre un escalier et le nu du mur. */
const WALL_CLEARANCE = 0.004;
/** Hauteur de marche visée, à taille humaine. */
const TARGET_RISE = meters(0.175);
/** Marches dansantes du quart tournant d'un escalier en L. */
const L_WINDERS = 3;
/**
 * Marches de chaque volée droite d'un escalier en L : deux volées et le quart
 * tournant, plus la dernière contremarche jusqu'au plancher, rachètent l'étage.
 */
const L_FLIGHT = Math.max(4, Math.round((1 / TARGET_RISE - 1 - L_WINDERS) / 2));
/** Contremarches d'un étage à l'autre : un étage fait exactement une unité. */
export const STAIR_RISERS = 2 * L_FLIGHT + L_WINDERS + 1;
export const STAIR_RISE = 1 / STAIR_RISERS;
/**
 * Lèvre de dalle laissée entre une trémie et le nu du mur : la découpe ne
 * partage jamais le plan du mur (faces coplanaires en CSG).
 */
const HOLE_INSET = 0.003;
/** Garde-corps et mains courantes : hauteur au-dessus du plancher / du nez des marches (~85 cm, à taille humaine). */
export const RAIL_H = meters(0.84);
/**
 * Passage laissé entre le garde-corps et le bord d'arrivée de la trémie :
 * en haut de l'escalier, le palier entre trémie et mur peut ne faire que
 * quelques centimètres — on contourne le bout du garde-corps par là.
 */
export const ARRIVAL_PASSAGE = meters(0.6);
/** Marge autour d'une trémie vue d'en haut : son garde-corps (poteaux de 2,5 cm posés au bord). */
export const RAILING_MARGIN = 0.035;

/**
 * Escalier en L, large de ~84 cm : volée du bas (`flightTreads` marches) le
 * long d'un mur, quart tournant de `winders` marches dansantes autour du
 * poteau dans le coin, volée du haut (`flightTreads` marches) le long du mur
 * voisin. Un palier plat, à cette largeur, laissait des marches de ~17 cm
 * dans une pièce de 2,35 m ; les marches dansantes rachètent trois
 * contremarches dans le coin. La trémie couvre tout sauf les
 * `headroomTreads` premières marches, sous lesquelles il reste ~2 m.
 */
export const L_STAIR = {
  width: 0.3,
  // Giron de ~20 cm à l'échelle de référence ; plus court s'il faut plus de marches pour tenir entre les murs.
  tread: Math.min(0.072, (2 * STAIR_INNER - 0.3 - 0.03) / L_FLIGHT),
  flightTreads: L_FLIGHT,
  winders: L_WINDERS,
  headroomTreads: 2,
} as const;
/**
 * Vis : une marche par contremarche moins la dernière (15 de 18° pour une
 * case de 2,8 m) autour d'un noyau, soit 270° par étage ; le quart
 * restant est le palier, au-dessus duquel la volée suivante repart au même
 * angle. La trémie (en part de tarte, noyau compris) commence après les
 * marches sous lesquelles on passe encore la tête (45°).
 */
export const SPIRAL = {
  newelR: 0.04,
  outerR: 0.4,
  holeR: 0.405,
  steps: STAIR_RISERS - 1,
  stepAngle: (3 * Math.PI) / 2 / (STAIR_RISERS - 1),
  holeFrom: Math.PI / 4,
  arc: (3 * Math.PI) / 2,
} as const;
/** Échelle de meunier : rails à ±`halfWidth`, pied à `foot` du mur, tête à `top` ; trappe au plafond. */
export const LADDER = { halfWidth: 0.05, foot: 0.25, top: 0.08, hatchHalf: 0.085, hatchDepth: 0.17 } as const;

/**
 * Bord d'une trémie : contre le mur d'une face (rien à faire, sauf si ce côté
 * est ouvert dans la cellule), libre (chevêtre dessous, garde-corps dessus),
 * ou arrivée de l'escalier (chevêtre seulement : on y débouche).
 */
export type OpeningEdge = CellFace | 'free' | 'arrival';

/** Trémie (repère de la cellule) ; `edges[i]` est le bord de `points[i]` à `points[i + 1]`. */
export interface SlabOpening {
  points: Polygon;
  edges: OpeningEdge[];
}

interface PlanBase {
  /** Trémie percée dans le plafond de la cellule (et le plancher de la cellule du dessus). */
  opening: SlabOpening;
  /** Emprise au sol de l'escalier, garde-corps et limon compris. */
  footprint: Polygon;
  /** Partie de l'emprise sous laquelle on ne passe pas debout : ce qui doit rester hors du passage d'une porte. */
  lowFootprint: Polygon;
}

/** Escalier en L, palier dans le coin (sx, sz) ; `mirror` échange les murs des deux volées. */
export interface LStairPlan extends PlanBase {
  kind: 'L';
  sx: 1 | -1;
  sz: 1 | -1;
  mirror: boolean;
}

/** Vis : la première marche part de l'angle `angle` (direction (sin, cos)) et monte dans le sens des angles croissants. */
export interface SpiralStairPlan extends PlanBase {
  kind: 'spiral';
  angle: number;
}

/**
 * Échelle contre le mur de `face`, décalée de `offset` le long du mur ;
 * `wall` = distance du centre au mur dans cet axe (moindre dans un coin
 * arrondi). `closed` : trappe fermée (pas de grenier ouvert au-dessus).
 */
export interface LadderPlan extends PlanBase {
  kind: 'ladder';
  face: CellFace;
  offset: number;
  wall: number;
  closed: boolean;
}

export type StairPlan = LStairPlan | SpiralStairPlan | LadderPlan;

export interface StairLayout {
  /** Escalier (ou échelle) qui part de la cellule vers l'étage du dessus. */
  up: Map<GridCell, StairPlan>;
  /** Escalier de la cellule du dessous, qui débouche dans celle-ci par son plancher. */
  below: Map<GridCell, StairPlan>;
}

// ── Gabarits ──────────────────────────────────────────────────────────────

const faceTowards = (x: number, z: number): CellFace =>
  Math.abs(x) > Math.abs(z) ? (x > 0 ? 'right' : 'left') : z > 0 ? 'front' : 'back';

/**
 * Point du repère canonique d'un escalier en L vers la cellule. Repère
 * canonique : palier dans le coin (+, +), volée du bas contre le mur +X
 * (montant vers +Z), volée du haut contre le mur +Z (montant vers −X).
 * Symétries seulement : à n'appliquer qu'à des positions, jamais à une
 * matrice (les faces se retourneraient).
 */
export function lStairPoint({ sx, sz, mirror }: Pick<LStairPlan, 'sx' | 'sz' | 'mirror'>, a: number, b: number): Point {
  return mirror ? [sx * b, sz * a] : [sx * a, sz * b];
}

/** Murs contre lesquels courent la volée du bas et celle du haut. */
export function lStairWalls(plan: Pick<LStairPlan, 'sx' | 'sz' | 'mirror'>): [CellFace, CellFace] {
  return [faceTowards(...lStairPoint(plan, 1, 0)), faceTowards(...lStairPoint(plan, 0, 1))];
}

/** Abscisses canoniques d'un escalier en L. */
export const L_LAYOUT = (() => {
  const { width, tread, flightTreads, headroomTreads } = L_STAIR;
  const inner = STAIR_INNER - width; // nu des volées côté pièce, et poteau du quart tournant
  const start = inner - flightTreads * tread; // pied de la volée du bas, arrivée de celle du haut
  return {
    inner,
    outer: STAIR_INNER - WALL_CLEARANCE,
    hole: STAIR_INNER - HOLE_INSET,
    start,
    holeStart: start + headroomTreads * tread,
    stringer: 0.02,
  };
})();

function lStairPlan(sx: 1 | -1, sz: 1 | -1, mirror: boolean): LStairPlan {
  const frame = { sx, sz, mirror };
  const map = (points: Polygon) => points.map(([a, b]) => lStairPoint(frame, a, b));
  const [wall1, wall2] = lStairWalls(frame);
  const { inner, outer, hole, start, holeStart, stringer } = L_LAYOUT;
  const lowEnd = inner - 4 * L_STAIR.tread; // volée du haut : les marches dont le dessous est sous ~2 m
  // Bords de la trémie côté pièce : un peu au-delà des volées, pour que le
  // limon et la main courante de la volée du haut montent à travers.
  const holeInnerA = inner - 0.005;
  const holeInnerB = inner - stringer - 0.005;
  const lShape = (end2: number): Polygon => [
    [inner, start],
    [outer, start],
    [outer, outer],
    [end2, outer],
    [end2, inner - stringer],
    [inner, inner - stringer],
  ];
  return {
    kind: 'L',
    ...frame,
    opening: {
      points: map([
        [holeInnerA, holeStart],
        [hole, holeStart],
        [hole, hole],
        [start, hole],
        [start, holeInnerB],
        [holeInnerA, holeInnerB],
      ]),
      edges: ['free', wall1, wall2, 'arrival', 'free', 'free'],
    },
    footprint: map(lShape(start)),
    lowFootprint: map(lShape(lowEnd)),
  };
}

const direction = (angle: number): Point => [Math.sin(angle), Math.cos(angle)];

function spiralPlan(angle: number): SpiralStairPlan {
  const { holeR, outerR, holeFrom, arc } = SPIRAL;
  const segments = Math.round((arc - holeFrom) / (Math.PI / 12)); // 15° par segment d'arc
  const points: Polygon = [[0, 0]];
  const edges: OpeningEdge[] = ['free'];
  for (let i = 0; i <= segments; i += 1) {
    const [x, z] = direction(angle + holeFrom + ((arc - holeFrom) * i) / segments);
    points.push([+(x * holeR).toFixed(4), +(z * holeR).toFixed(4)]);
    if (i < segments) {
      const [mx, mz] = direction(angle + holeFrom + ((arc - holeFrom) * (i + 0.5)) / segments);
      edges.push(faceTowards(mx, mz));
    }
  }
  edges.push('arrival');
  const footprint: Polygon = [];
  for (let i = 0; i < 24; i += 1) {
    const [x, z] = direction((i / 24) * Math.PI * 2);
    footprint.push([x * (outerR + 0.01), z * (outerR + 0.01)]);
  }
  return { kind: 'spiral', angle, opening: { points, edges }, footprint, lowFootprint: footprint };
}

/** Repère d'un mur : (latéral, profondeur vers le mur) → cellule. */
export function faceFramePoint(face: CellFace, lateral: number, depth: number): Point {
  const a = FACE_ROTATION_Y[face];
  return [lateral * Math.cos(a) + depth * Math.sin(a), -lateral * Math.sin(a) + depth * Math.cos(a)];
}

/** Rectangle du repère d'un mur (latéral de l0 à l1, profondeur de d0 à d1), dans la cellule. */
export const faceZone = (face: CellFace, l0: number, l1: number, d0: number, d1: number): Polygon =>
  [
    [l0, d0],
    [l1, d0],
    [l1, d1],
    [l0, d1],
  ].map(([l, d]) => faceFramePoint(face, l, d));

function ladderPlan(face: CellFace, offset: number, wall: number, closed: boolean): LadderPlan {
  const { hatchHalf, hatchDepth, foot } = LADDER;
  const footprint = faceZone(face, offset - 0.065, offset + 0.065, wall - foot - 0.02, wall - WALL_CLEARANCE);
  return {
    kind: 'ladder',
    face,
    offset,
    wall,
    closed,
    opening: {
      points: faceZone(face, offset - hatchHalf, offset + hatchHalf, wall - hatchDepth, wall - HOLE_INSET),
      edges: ['free', 'free', face, 'free'],
    },
    footprint,
    lowFootprint: footprint,
  };
}

/** Distance du centre au contour intérieur, vers `face`, le long de la ligne d'abscisse `lateral` du mur. */
function wallDistance(contour: Polygon, face: CellFace, lateral: number): number {
  const a = FACE_ROTATION_Y[face];
  const local = contour.map(([x, z]): Point => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)]);
  let best = Infinity;
  for (let i = 0; i < local.length; i += 1) {
    const [l0, d0] = local[i];
    const [l1, d1] = local[(i + 1) % local.length];
    if ((l0 - lateral) * (l1 - lateral) > 0 || l0 === l1) continue;
    const d = d0 + ((lateral - l0) / (l1 - l0)) * (d1 - d0);
    if (d > 0) best = Math.min(best, d);
  }
  return best;
}

// ── Obstacles partagés avec le mobilier et les cheminées ─────────────────

/**
 * Ce qu'un meuble ou une cheminée ne doit pas toucher dans la cellule :
 * l'escalier qui en part (emprise et trémie, la hotte monte au plafond) et
 * la trémie de celui qui arrive par le plancher, garde-corps compris.
 */
export function stairObstacles(ctx: Pick<CellContext, 'stair' | 'stairBelow'>): Polygon[] {
  const obstacles: Polygon[] = [];
  if (ctx.stair) obstacles.push(ctx.stair.footprint, ctx.stair.opening.points);
  if (ctx.stairBelow) obstacles.push(offsetPolygon(ctx.stairBelow.opening.points, RAILING_MARGIN));
  return obstacles;
}

/** Profondeur du passage à garder libre devant une porte (~55 cm). */
export const DOOR_PASSAGE_DEPTH = 0.2;

/** Passage devant la porte de la cellule : largeur de la porte, sur `DOOR_PASSAGE_DEPTH`. */
export function doorPassage(ctx: Pick<CellContext, 'doorFace'>): Polygon | null {
  if (!ctx.doorFace) return null;
  const half = OPENING_SIZES.door.w / 2;
  return faceZone(ctx.doorFace, -half, half, STAIR_INNER - DOOR_PASSAGE_DEPTH, 0.5);
}

/** Devant chaque fenêtre ou meurtrière : sa largeur, sur ~40 cm, à laisser dégagé (échelles). */
function windowZones(ctx: CellContext): Polygon[] {
  const zones: Polygon[] = [];
  for (const [face, kind] of openingKindsOf(ctx)) {
    if (kind === 'door') continue;
    const half = OPENING_SIZES[kind].w / 2;
    zones.push(faceZone(face, -half, half, STAIR_INNER - 0.15, 0.5));
  }
  return zones;
}

// ── Planification ─────────────────────────────────────────────────────────

const FACES: CellFace[] = ['front', 'right', 'back', 'left'];

function hashOf(x: number, y: number, z: number, salt: number): number {
  return Math.abs(
    Math.imul(x + salt, 73856093) ^ Math.imul(y + 3 * salt, 19349663) ^ Math.imul(z + 7 * salt, 83492791),
  );
}

/** Tolérance de l'emprise contre le contour : un palier peut mordre de 1 cm dans un coin à peine arrondi. */
const CONTOUR_TOLERANCE = 0.012;

const fitsIn = (polygon: Polygon, contour: Polygon) =>
  polygonInside(offsetPolygon(polygon, -CONTOUR_TOLERANCE), contour);

/** Les huit escaliers en L possibles (coin du quart tournant × sens) : les mêmes dans toutes les cellules. */
const L_PLANS: LStairPlan[] = ([1, -1] as const).flatMap((sx) =>
  ([1, -1] as const).flatMap((sz) => [false, true].map((mirror) => lStairPlan(sx, sz, mirror))),
);

/** Clé de la forme intérieure d'une cellule (côtés, piliers, coins) : peu de formes différentes dans un village. */
const shapeKey = ({ hollow, radii }: CellContext) =>
  `${hollow!.sides.front}${hollow!.sides.back}${hollow!.sides.left}${hollow!.sides.right}|` +
  `${+hollow!.pillars.backLeft}${+hollow!.pillars.backRight}${+hollow!.pillars.frontLeft}${+hollow!.pillars.frontRight}|` +
  `${radii.backLeft},${radii.backRight},${radii.frontLeft},${radii.frontRight}`;

/** L'escalier en L n° `index` tient dans la cellule (emprise) et sa trémie dans celle du dessus — mémorisé par forme. */
const lFits = (() => {
  const memo = new Map<string, boolean>();
  return (index: number, ctx: CellContext, upper: CellContext): boolean => {
    const key = `${index}|${shapeKey(ctx)}|${shapeKey(upper)}`;
    let fits = memo.get(key);
    if (fits === undefined) {
      const plan = L_PLANS[index];
      fits =
        fitsIn(plan.footprint, innerContourXZ(ctx.hollow!, ctx.radii)) &&
        fitsIn(plan.opening.points, innerContourXZ(upper.hollow!, upper.radii));
      if (memo.size > 5000) memo.clear();
      memo.set(key, fits);
    }
    return fits;
  };
})();

/** Normalise un angle dans [0, 2π), arrondi pour servir de clé de cache. */
const normalAngle = (angle: number) => +(((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(4);

interface Candidate {
  ctx: CellContext;
  plan: StairPlan;
  rank: number;
}

/**
 * Départ d'une vis : le palier (le quart sans marches, de `angle + 270°` à
 * `angle + 360°`) fait face à la porte de la tour, sinon à son côté ouvert
 * sur la maison, sinon à une face tirée au hash. Gardé pour toute la colonne.
 */
function spiralAngle(ctx: CellContext): number {
  const { cell, hollow, doorFace } = ctx;
  const facing =
    doorFace ??
    FACES.find((face) => hollow!.sides[face] === 'open') ??
    FACES[hashOf(cell.x, 0, cell.z, 61) % FACES.length];
  return normalAngle(FACE_ROTATION_Y[facing] + Math.PI / 4);
}

/** Options d'escalier montant de `ctx` vers `upper`, avec leur rang (plus bas = meilleur). */
function stairCandidates(
  ctx: CellContext,
  upper: CellContext,
  arriving: StairPlan | undefined,
  columnAngle: number | undefined,
): Candidate[] {
  const { cell } = ctx;
  const tieBreak = (salt: number) => (hashOf(cell.x, cell.y, cell.z, salt) % 1000) / 10000;

  if (ctx.isIsolated) {
    // Tour : une vis, au même départ à chaque étage — celle de l'étage du
    // dessous débouche sur le palier de celle-ci.
    const angle = columnAngle ?? spiralAngle(ctx);
    if (arriving && (arriving.kind !== 'spiral' || arriving.angle !== angle)) return [];
    return [{ ctx, plan: spiralPlan(angle), rank: -5 + tieBreak(70) }];
  }

  const kinds = openingKindsOf(ctx);
  const passage = doorPassage(ctx);
  const below = arriving ? offsetPolygon(arriving.opening.points, RAILING_MARGIN) : null;
  const candidates: Candidate[] = [];
  for (const [index, plan] of L_PLANS.entries()) {
    if (!lFits(index, ctx, upper)) continue;
    if (passage && polygonsOverlap(plan.lowFootprint, passage)) continue;
    if (below && polygonsOverlap(plan.footprint, below)) continue;
    let rank = 0;
    for (const wall of lStairWalls(plan)) {
      // Un mur plein de préférence (pas une fenêtre masquée par les marches), jamais rien.
      if (ctx.hollow!.sides[wall] === 'open') rank += 30;
      else if (kinds.has(wall)) rank += 10;
      if (upper.hollow!.sides[wall] === 'open') rank += 5;
    }
    // La table et le tapis sous le chandelier restent mieux dégagés ailleurs.
    if (ctx.chandelier) rank += 3;
    if (upper.chandelier) rank += 3;
    candidates.push({ ctx, plan, rank: rank + tieBreak(71 + index) });
  }
  return candidates;
}

/** Options d'échelle vers le grenier depuis `ctx` (dernier étage), avec leur rang. */
function ladderCandidates(ctx: CellContext, arriving: StairPlan | undefined, closed: boolean): Candidate[] {
  const { cell, hollow } = ctx;
  const kinds = openingKindsOf(ctx);
  const contour = innerContourXZ(hollow!, ctx.radii);
  const passage = doorPassage(ctx);
  const windows = windowZones(ctx);
  const below = arriving ? offsetPolygon(arriving.opening.points, RAILING_MARGIN) : null;
  const candidates: Candidate[] = [];
  for (const [index, face] of FACES.entries()) {
    if (hollow!.sides[face] === 'open') continue;
    const kind = kinds.get(face);
    if (kind === 'door') continue;
    // Contre une fenêtre, l'échelle se range dans le coin, hors de son embrasure.
    for (const offset of kind === 'window' ? [0.34, -0.34] : [0.2, -0.2]) {
      const half = LADDER.hatchHalf + 0.005;
      const wall = Math.min(
        STAIR_INNER,
        ...[offset - half, offset, offset + half].map((lateral) => wallDistance(contour, face, lateral)),
      );
      if (!Number.isFinite(wall) || wall < 0.3) continue;
      const plan = ladderPlan(face, offset, +wall.toFixed(4), closed);
      if (!fitsIn(plan.footprint, contour) || !fitsIn(plan.opening.points, contour)) continue;
      if (passage && polygonsOverlap(plan.footprint, passage)) continue;
      if (below && polygonsOverlap(plan.footprint, below)) continue;
      if (windows.some((zone) => polygonsOverlap(plan.footprint, zone))) continue;
      const rank = kind === 'window' ? 10 : kind === 'slit' ? 2 : 0;
      const salt = 80 + index * 2 + (offset > 0 ? 1 : 0);
      candidates.push({ ctx, plan, rank: rank + (hashOf(cell.x, cell.y, cell.z, salt) % 1000) / 10000 });
    }
  }
  return candidates;
}

const best = (candidates: Candidate[]): Candidate | null =>
  candidates.reduce<Candidate | null>((top, c) => (!top || c.rank < top.rank ? c : top), null);

export function planStairs(contexts: CellContext[]): StairLayout {
  const layout: StairLayout = { up: new Map(), below: new Map() };
  const hollow = contexts.filter((ctx) => ctx.hollow);
  if (hollow.length === 0) return layout;
  const { lookup } = hollow[0];
  const ctxOf = new Map(contexts.map((ctx) => [ctx.cell, ctx]));
  const above = (cell: GridCell) => getCell(lookup, cell.x, cell.y + 1, cell.z);

  const rooms = findRooms(
    hollow.map((ctx) => ctx.cell),
    lookup,
  );
  const roomOf = new Map<GridCell, number>();
  rooms.forEach((room, index) => room.forEach((cell) => roomOf.set(cell, index)));
  // De bas en haut : une trémie arrivée d'en bas est connue avant de placer l'escalier suivant.
  const corner = (room: GridCell[]) =>
    room.reduce((min, c) => (c.x < min.x || (c.x === min.x && c.z < min.z) ? c : min), room[0]);
  const order = rooms
    .map((room, index) => ({ index, y: room[0].y, first: corner(room) }))
    .sort((a, b) => a.y - b.y || a.first.x - b.first.x || a.first.z - b.first.z);

  /** Départ de la vis de chaque colonne de tour (clé "x,z"). */
  const columnAngles = new Map<string, number>();

  for (const { index } of order) {
    const room = rooms[index];
    // Pièces de l'étage du dessus posées sur celle-ci, et les cellules qui sont dessous.
    const uppers = new Map<number, GridCell[]>();
    for (const cell of room) {
      const up = above(cell);
      const upperRoom = up ? roomOf.get(up) : undefined;
      if (upperRoom === undefined) continue;
      const list = uppers.get(upperRoom);
      if (list) list.push(cell);
      else uppers.set(upperRoom, [cell]);
    }

    if (uppers.size > 0) {
      for (const upperRoom of [...uppers.keys()].sort((a, b) => a - b)) {
        const candidates: Candidate[] = [];
        for (const cell of uppers.get(upperRoom)!) {
          if (layout.up.has(cell)) continue;
          candidates.push(
            ...stairCandidates(
              ctxOf.get(cell)!,
              ctxOf.get(above(cell)!)!,
              layout.below.get(cell),
              columnAngles.get(`${cell.x},${cell.z}`),
            ),
          );
        }
        const chosen = best(candidates);
        if (!chosen) continue;
        const { cell } = chosen.ctx;
        layout.up.set(cell, chosen.plan);
        layout.below.set(above(cell)!, chosen.plan);
        if (chosen.plan.kind === 'spiral') columnAngles.set(`${cell.x},${cell.z}`, chosen.plan.angle);
      }
      continue;
    }

    // Dernier étage : une échelle vers le grenier (ou la plate-forme de la tour).
    const candidates: Candidate[] = [];
    for (const cell of room) {
      const up = above(cell);
      if (!up?.isOccupied || up.type !== BlockType.Roof) continue;
      candidates.push(...ladderCandidates(ctxOf.get(cell)!, layout.below.get(cell), !isGableRoofCell(lookup, up)));
    }
    const chosen = best(candidates);
    if (chosen) layout.up.set(chosen.ctx.cell, chosen.plan);
  }
  return layout;
}
