/**
 * Géométrie des escaliers intérieurs (gabarits et planification :
 * stairPlan.ts). Tout est en boîtes et en coins de vis (`wedgeGeo`), en
 * repère de la cellule de départ ; la volée du haut monte à travers la
 * trémie jusqu'au plancher de l'étage.
 *
 *  - En L (maisons) : volée du bas en marches pleines coffrées, quart
 *    tournant de marches dansantes autour d'un poteau dans le coin, volée du
 *    haut à marches et contremarches sur un limon, mains courantes côté
 *    pièce. ~1 000 sommets.
 *  - En vis (tours) : noyau de pierre, 15 marches en éventail ; dans la
 *    cellule du chandelier, un falot pend au noyau à sa place. ~450 sommets.
 *  - Échelle de meunier : deux montants et des barreaux jusqu'à la trappe,
 *    fermée par un abattant quand il n'y a pas de grenier ouvert au-dessus.
 *
 * Plus, autour des trémies : chevêtres sous le plafond (cellule de départ)
 * et garde-corps sur le plancher de l'étage (cellule d'arrivée).
 */

import { varyColorBrightness } from '../../colorPalettes';
import { meters } from '../../config/scale';
import { FACE_ROTATION_Y, type HollowShape } from '../../utils/cellUtils';
import { offsetPolygon, signedArea, type Point } from '../../utils/polygon';
import { boxGeo, cylinderGeo, prismGeo, wedgeGeo } from '../geometryCache';
import { mul, part, xform, type MaterialSpec, type Part, type Vec3 } from '../parts';
import type { CellContext } from './context';
import {
  faceFramePoint,
  L_LAYOUT,
  L_STAIR,
  LADDER,
  lStairPoint,
  RAIL_H,
  ARRIVAL_PASSAGE,
  SPIRAL,
  STAIR_FLOOR_Y,
  STAIR_RISE,
  type LadderPlan,
  type LStairPlan,
  type OpeningEdge,
  type SlabOpening,
  type SpiralStairPlan,
} from './stairPlan';

const TREAD_WOOD = '#94704a';
const CASING_WOOD = '#6e4d32';
const RISER_WOOD = '#5f422c';
const RAIL_WOOD = '#5a3d27';
const LADDER_WOOD = '#8b6a45';
const IRON = '#2b2622';
const WAX = '#efe6d2';
/** Mèche : sombre le jour, flamme le soir (groupe "glow"), comme celles du chandelier. */
const FLAME = '#4a3420';
const WOOD: MaterialSpec = { roughness: 0.85 };
const STONE: MaterialSpec = { roughness: 0.92 };
const IRON_MAT: MaterialSpec = { roughness: 0.6, metalness: 0.4 };

/** Épaisseur des girons, débord du nez de marche. */
const BOARD = 0.02;
const NOSING = 0.01;
const POST = 0.025;
const BALUSTER = 0.012;

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Pièce de bois droite de `p0` à `p1` (axe), section `width` (horizontale) × `height`. */
function beamBetween(p0: Vec3, p1: Vec3, width: number, height: number, color: string, mat: MaterialSpec): Part {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const horizontal = Math.hypot(dx, dz);
  const length = Math.hypot(horizontal, dy);
  const mid: Vec3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  return part(
    boxGeo(r4(length), height, width),
    color,
    mat,
    mul(xform(mid, [0, Math.atan2(-dz, dx), 0]), xform([0, 0, 0], [0, 0, Math.atan2(dy, horizontal)])),
  );
}

// ── Escalier en L ────────────────────────────────────────────────────────

/** Boîte alignée sur les axes, donnée en coordonnées canoniques (a, b) de l'escalier (voir lStairPoint). */
function lBox(
  plan: LStairPlan,
  [a0, a1]: [number, number],
  [b0, b1]: [number, number],
  [y0, y1]: [number, number],
  color: string,
): Part {
  const [x0, z0] = lStairPoint(plan, a0, b0);
  const [x1, z1] = lStairPoint(plan, a1, b1);
  return part(
    boxGeo(r4(Math.abs(x1 - x0)), r4(y1 - y0), r4(Math.abs(z1 - z0))),
    color,
    WOOD,
    xform([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]),
  );
}

const lPoint = (plan: LStairPlan, a: number, y: number, b: number): Vec3 => {
  const [x, z] = lStairPoint(plan, a, b);
  return [x, y, z];
};

function lStairParts(plan: LStairPlan): Part[] {
  const { inner, outer, start, stringer } = L_LAYOUT;
  const { tread, flightTreads, winders } = L_STAIR;
  const y0 = STAIR_FLOOR_Y;
  const r = STAIR_RISE;
  const parts: Part[] = [];

  // Volée du bas, le long du mur « a = outer » : marches pleines, coffrées, giron de chêne.
  for (let k = 1; k <= flightTreads; k += 1) {
    const b0 = start + (k - 1) * tread;
    const b1 = b0 + tread;
    const top = y0 + k * r;
    parts.push(lBox(plan, [inner, outer], [b0, b1], [y0, top - BOARD], CASING_WOOD));
    parts.push(lBox(plan, [inner - 0.006, outer], [b0 - NOSING, b1], [top - BOARD, top], TREAD_WOOD));
  }

  // Quart tournant dans le coin : marches dansantes en éventail autour du
  // poteau (inner, inner), pleines elles aussi, de la volée du bas (rayon
  // +a) à celle du haut (rayon +b).
  const span = outer - inner;
  const rayEnd = (phi: number): [number, number] =>
    phi <= Math.PI / 4 + 1e-9
      ? [outer, inner + span * Math.tan(phi)]
      : [inner + span / Math.tan(Math.min(phi, Math.PI / 2 - 1e-9)), outer];
  for (let w = 1; w <= winders; w += 1) {
    const phi0 = ((w - 1) * Math.PI) / 2 / winders;
    const phi1 = (w * Math.PI) / 2 / winders;
    const canonical: Array<[number, number]> = [[inner, inner], rayEnd(phi0)];
    if (phi0 < Math.PI / 4 && phi1 > Math.PI / 4) canonical.push([outer, outer]);
    canonical.push(rayEnd(phi1));
    const section = canonical.map(([a, b]) => lStairPoint(plan, +a.toFixed(4), +b.toFixed(4)));
    const top = y0 + (flightTreads + w) * r;
    parts.push(part(prismGeo(section, top - BOARD - y0), CASING_WOOD, WOOD, xform([0, y0, 0])));
    parts.push(part(prismGeo(section, BOARD), TREAD_WOOD, WOOD, xform([0, top - BOARD, 0])));
  }

  // Volée du haut, le long du mur « b = outer », vers −a : girons, contremarches, limon.
  const turnTop = y0 + (flightTreads + winders) * r;
  for (let j = 1; j <= flightTreads; j += 1) {
    const a1 = inner - (j - 1) * tread;
    const top = turnTop + j * r;
    parts.push(lBox(plan, [a1 - tread, a1 + NOSING], [inner, outer], [top - BOARD, top], TREAD_WOOD));
    parts.push(lBox(plan, [a1 - 0.012, a1], [inner, outer], [top - r, top - BOARD], RISER_WOOD));
  }
  // Limon côté pièce, sous la ligne des nez de marche ; il s'arrête sous le plancher de l'étage.
  const slope = r / tread;
  const nose = (a: number) => turnTop + r + (inner - a) * slope;
  const stringerH = 0.09;
  const lift = 0.02 - stringerH / 2 / Math.cos(Math.atan(slope));
  const stringerB = inner - stringer / 2;
  parts.push(
    beamBetween(
      lPoint(plan, inner, nose(inner) + lift, stringerB),
      lPoint(plan, start + 0.03, nose(start + 0.03) + lift, stringerB),
      stringer,
      stringerH,
      RISER_WOOD,
      WOOD,
    ),
  );

  // Poteaux (pied de la volée, poteau du quart tournant) et mains courantes.
  const postA = inner + 0.02;
  const newelB = inner;
  const rail1 = (b: number) => y0 + r + RAIL_H + (b - start - 0.0175) * slope;
  const rail2 = (a: number) => nose(a) + RAIL_H;
  parts.push(
    lBox(plan, [inner + 0.0025, inner + 0.0375], [start, start + 0.035], [y0, rail1(start) + 0.03], RAIL_WOOD),
  );
  // Le poteau du quart tournant monte jusqu'à la main courante du haut, sous le plancher de l'étage.
  parts.push(lBox(plan, [inner, inner + 0.04], [newelB - 0.02, newelB + 0.02], [y0, rail2(postA) + 0.03], RAIL_WOOD));
  parts.push(
    beamBetween(
      lPoint(plan, postA, rail1(start + 0.0175), start + 0.0175),
      lPoint(plan, postA, rail1(newelB), newelB),
      0.026,
      0.022,
      RAIL_WOOD,
      WOOD,
    ),
  );
  // Celle du haut, au-dessus du limon, monte par la trémie jusqu'au garde-corps de l'étage.
  parts.push(
    beamBetween(
      lPoint(plan, postA, rail2(postA), stringerB),
      lPoint(plan, start, rail2(start), stringerB),
      0.026,
      0.022,
      RAIL_WOOD,
      WOOD,
    ),
  );

  // Balustres, une marche sur deux : sur les marches en bas, sur le limon en haut.
  for (let k = 2; k < flightTreads; k += 2) {
    const b = start + (k - 0.5) * tread;
    const top = y0 + k * r;
    const h = rail1(b) - 0.011 - top;
    const [x, z] = lStairPoint(plan, postA, b);
    parts.push(part(boxGeo(BALUSTER, r4(h), BALUSTER), RAIL_WOOD, WOOD, xform([x, top + h / 2, z])));
  }
  for (let j = 1; j <= flightTreads; j += 2) {
    const a = inner - (j - 0.5) * tread;
    const base = nose(a) + 0.02;
    const h = rail2(a) - 0.011 - base;
    const [x, z] = lStairPoint(plan, a, stringerB);
    parts.push(part(boxGeo(BALUSTER, r4(h), BALUSTER), RAIL_WOOD, WOOD, xform([x, base + h / 2, z])));
  }
  return parts;
}

// ── Vis ──────────────────────────────────────────────────────────────────

function spiralParts(plan: SpiralStairPlan, stone: string): Part[] {
  const { newelR, outerR, steps, stepAngle } = SPIRAL;
  const y0 = STAIR_FLOOR_Y;
  const r = STAIR_RISE;
  // Noyau d'un plancher à l'autre : il se prolonge d'étage en étage.
  const parts: Part[] = [
    part(cylinderGeo(newelR, newelR, 1, 8), varyColorBrightness(stone, -0.08), STONE, xform([0, y0 + 0.5, 0])),
  ];
  // Marches pleines, un peu plus épaisses que la contremarche : leur dessous dessine l'hélice.
  // La première, posée sur le plancher, n'a que la hauteur de sa contremarche.
  for (let k = 1; k <= steps; k += 1) {
    const thickness = Math.min(r + 0.03, k * r);
    const geo = wedgeGeo(newelR * 0.7, outerR, stepAngle + 0.03, thickness);
    const tone = varyColorBrightness(stone, ((k * 7) % 5) * 0.012 - 0.024);
    parts.push(
      part(geo, tone, STONE, xform([0, y0 + k * r - thickness / 2, 0], [0, plan.angle + (k - 0.5) * stepAngle, 0])),
    );
  }
  return parts;
}

/**
 * Falot accroché au noyau d'une vis, à la hauteur des flammes du chandelier
 * qu'il remplace (le noyau occupe le centre) : potence, cage, bougie. Placé
 * à l'opposé de la marche qui passe à cette hauteur.
 */
export function spiralLanternParts(plan: SpiralStairPlan, lampY: number): { structure: Part[]; flames: Part[] } {
  const { newelR, stepAngle } = SPIRAL;
  const step = Math.floor((lampY - STAIR_FLOOR_Y) / STAIR_RISE);
  const angle = plan.angle + (step + 0.5) * stepAngle + Math.PI;
  const reach = newelR + 0.055;
  const at = (radius: number, y: number): Vec3 => [Math.sin(angle) * radius, y, Math.cos(angle) * radius];
  const turn = xform([0, 0, 0], [0, angle, 0]);
  const structure: Part[] = [
    // Potence scellée dans le noyau, crochet.
    part(
      boxGeo(0.008, 0.008, reach - newelR + 0.01),
      IRON,
      IRON_MAT,
      mul(xform(at((newelR + reach) / 2, lampY + 0.075)), turn),
    ),
    part(boxGeo(0.004, 0.012, 0.004), IRON, IRON_MAT, xform(at(reach, lampY + 0.065))),
    // Chapeau, socle, quatre montants.
    part(cylinderGeo(0.016, 0.026, 0.02, 6), IRON, IRON_MAT, xform(at(reach, lampY + 0.049))),
    part(cylinderGeo(0.024, 0.024, 0.008, 6), IRON, IRON_MAT, xform(at(reach, lampY - 0.036))),
    part(cylinderGeo(0.008, 0.008, 0.03, 6), WAX, { roughness: 0.7 }, xform(at(reach, lampY - 0.017))),
  ];
  for (let i = 0; i < 4; i += 1) {
    const a = angle + Math.PI / 4 + (i * Math.PI) / 2;
    const [x, , z] = at(reach, 0);
    structure.push(
      part(
        boxGeo(0.004, 0.08, 0.004),
        IRON,
        IRON_MAT,
        xform([x + Math.sin(a) * 0.02, lampY + 0.002, z + Math.cos(a) * 0.02]),
      ),
    );
  }
  const flames = [part(cylinderGeo(0, 0.007, 0.024, 5), FLAME, { roughness: 1, glow: true }, xform(at(reach, lampY)))];
  return { structure, flames };
}

// ── Échelle ──────────────────────────────────────────────────────────────

function ladderParts(plan: LadderPlan): Part[] {
  const { face, offset, wall, closed } = plan;
  const { halfWidth, foot, top } = LADDER;
  const y0 = STAIR_FLOOR_Y;
  // Ouverte : les montants dépassent dans le grenier ; fermée : ils s'arrêtent sous l'abattant.
  const y1 = closed ? 0.5 - 0.016 : 0.5 + 0.09;
  const depthAt = (y: number) => wall - foot + ((y - y0) / (y1 - y0)) * (foot - top);
  const point = (lateral: number, y: number): Vec3 => {
    const [x, z] = faceFramePoint(face, lateral, depthAt(y));
    return [x, y, z];
  };
  const parts: Part[] = [];
  for (const side of [1, -1]) {
    parts.push(
      beamBetween(
        // Les bouts des montants, coupés d'équerre, plongeraient sous le plancher.
        point(offset + side * halfWidth, y0 + 0.003),
        point(offset + side * halfWidth, y1),
        0.018,
        0.03,
        LADDER_WOOD,
        WOOD,
      ),
    );
  }
  const turn = FACE_ROTATION_Y[face];
  const rungColor = varyColorBrightness(LADDER_WOOD, -0.08);
  // Barreaux tous les ~25 cm, à taille humaine quelle que soit la case.
  for (let y = y0 + meters(0.3); y < y1 - 0.04; y += meters(0.25)) {
    parts.push(part(boxGeo(2 * halfWidth, 0.014, 0.014), rungColor, WOOD, xform(point(offset, y), [0, turn, 0])));
  }
  if (closed) {
    // Abattant de chêne qui ferme la trappe, en haut de la dalle.
    const { hatchHalf, hatchDepth } = LADDER;
    const [x, z] = faceFramePoint(face, offset, wall - hatchDepth / 2 - 0.0015);
    parts.push(
      part(
        boxGeo(2 * hatchHalf, 0.012, r4(hatchDepth - 0.003)),
        varyColorBrightness(CASING_WOOD, -0.05),
        WOOD,
        xform([x, 0.5 - 0.008, z], [0, turn, 0]),
      ),
    );
  }
  return parts;
}

/** Escalier qui part de la cellule (en L, en vis, échelle), en repère de la cellule. */
export function stairParts(ctx: CellContext): Part[] {
  const plan = ctx.stair;
  if (!plan) return [];
  if (plan.kind === 'L') return lStairParts(plan);
  if (plan.kind === 'ladder') return ladderParts(plan);
  return spiralParts(plan, varyColorBrightness(ctx.settings.wallBaseColor, -0.12));
}

// ── Bords de trémie ──────────────────────────────────────────────────────

type EdgeRole = 'free' | 'arrival' | 'wall';

/** Rôle d'un bord dans cette cellule : un côté de mur ouvert (pas de mur derrière) est libre. */
function edgeRole(edge: OpeningEdge, hollow: HollowShape, arrivalIsFree: boolean): EdgeRole {
  if (edge === 'free') return 'free';
  if (edge === 'arrival') return arrivalIsFree ? 'free' : 'arrival';
  return hollow.sides[edge] === 'open' ? 'free' : 'wall';
}

interface FreeEdge {
  from: Point;
  to: Point;
  /** Direction du bord (unitaire) et normale sortante (vers le plancher qui reste). */
  dir: Point;
  out: Point;
  /** Coin d'offset (onglet) à chaque bout, quand le bord voisin est libre aussi. */
  fromMiter: Point | null;
  toMiter: Point | null;
  /** Rôle du bord voisin à chaque bout, et si la trémie fait un angle saillant à ce coin. */
  before: EdgeRole;
  after: EdgeRole;
  fromConvex: boolean;
  toConvex: boolean;
}

/** Bords libres d'une trémie (chevêtres, garde-corps), décalés de `offset` hors de la trémie aux coins libres. */
function freeEdges(opening: SlabOpening, hollow: HollowShape, arrivalIsFree: boolean, offset: number): FreeEdge[] {
  const { points, edges } = opening;
  const n = points.length;
  const sign = signedArea(points) > 0 ? 1 : -1;
  const roles = edges.map((edge) => edgeRole(edge, hollow, arrivalIsFree));
  const miters = offsetPolygon(points, offset);
  const dirOf = (i: number): Point => {
    const [x0, z0] = points[i];
    const [x1, z1] = points[(i + 1) % n];
    const length = Math.hypot(x1 - x0, z1 - z0) || 1;
    return [(x1 - x0) / length, (z1 - z0) / length];
  };
  // Coin saillant de la trémie (son intérieur y tourne dans le sens du contour).
  const convexAt = (i: number) => {
    const [ax, az] = dirOf((i - 1 + n) % n);
    const [bx, bz] = dirOf(i);
    return sign * (ax * bz - az * bx) > 0;
  };
  const result: FreeEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    if (roles[i] !== 'free') continue;
    const before = roles[(i - 1 + n) % n];
    const after = roles[(i + 1) % n];
    const dir = dirOf(i);
    result.push({
      from: points[i],
      to: points[(i + 1) % n],
      dir,
      out: [sign * dir[1], -sign * dir[0]],
      fromMiter: before === 'free' ? miters[i] : null,
      toMiter: after === 'free' ? miters[(i + 1) % n] : null,
      before,
      after,
      fromConvex: convexAt(i),
      toConvex: convexAt((i + 1) % n),
    });
  }
  return result;
}

/**
 * Chevêtres : pièces de bois qui bordent la trémie sous le plafond, là où
 * les solives coupées s'arrêtent (interiorParts les arrête contre eux).
 * `y` = axe des pièces, `size` = [largeur, hauteur]. Aux coins saillants,
 * chaque pièce dépasse d'une largeur pour couvrir l'angle ; contre un mur,
 * elle s'arrête au bord de la trémie.
 */
export function trimmerParts(ctx: CellContext, y: number, [width, height]: [number, number], color: string): Part[] {
  const plan = ctx.stair;
  if (!plan || plan.kind === 'spiral' || !ctx.hollow) return [];
  return freeEdges(plan.opening, ctx.hollow, true, width / 2).map(
    ({ from, to, dir, out, before, after, fromConvex, toConvex }) => {
      const extendFrom = before === 'free' && fromConvex ? width : 0;
      const extendTo = after === 'free' && toConvex ? width : 0;
      const shift = (p: Point, along: number): Vec3 => [
        p[0] + out[0] * (width / 2) + dir[0] * along,
        y,
        p[1] + out[1] * (width / 2) + dir[1] * along,
      ];
      return beamBetween(shift(from, -extendFrom), shift(to, extendTo), width, height, color, WOOD);
    },
  );
}

/**
 * Garde-corps autour de la trémie de l'escalier qui arrive par le plancher :
 * poteaux, balustres tous les ~12 cm et lisse, sur les bords libres — pas
 * du côté où l'on débouche. Au-dessus d'une vis, le bord du palier reste
 * dégagé si la vis de l'étage repart de là.
 */
export function stairwellRailingParts(ctx: CellContext): Part[] {
  const plan = ctx.stairBelow;
  if (!plan || plan.kind === 'ladder' || !ctx.hollow) return [];
  const y0 = STAIR_FLOOR_Y;
  const offset = POST / 2;
  const parts: Part[] = [];
  const posts = new Set<string>();
  for (const edge of freeEdges(plan.opening, ctx.hollow, false, offset)) {
    const { from, to, dir, out, fromMiter, toMiter, before, after } = edge;
    // Bord du palier d'une vis (le rayon de départ des marches) : la vis de l'étage y monte.
    if (plan.kind === 'spiral' && ctx.stair?.kind === 'spiral' && from[0] === 0 && from[1] === 0) continue;
    // Bouts : à l'onglet entre deux bords libres ; contre un mur, le poteau s'y adosse.
    const pullBack = POST / 2 + 0.002;
    // Côté arrivée, le garde-corps s'arrête court : on en contourne le bout pour sortir de l'escalier.
    const pullOf = (role: string) => (role === 'wall' ? pullBack : role === 'arrival' ? ARRIVAL_PASSAGE : 0);
    const p0: Point = fromMiter ?? [
      from[0] + out[0] * offset + dir[0] * pullOf(before),
      from[1] + out[1] * offset + dir[1] * pullOf(before),
    ];
    const p1: Point = toMiter ?? [
      to[0] + out[0] * offset - dir[0] * pullOf(after),
      to[1] + out[1] * offset - dir[1] * pullOf(after),
    ];
    // Bord plus court que le passage : pas de garde-corps du tout.
    if ((p1[0] - p0[0]) * dir[0] + (p1[1] - p0[1]) * dir[1] <= POST) continue;
    const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const count = Math.max(1, Math.ceil(length / 0.12));
    for (let i = 0; i <= count; i += 1) {
      const x = p0[0] + ((p1[0] - p0[0]) * i) / count;
      const z = p0[1] + ((p1[1] - p0[1]) * i) / count;
      const end = i === 0 || i === count;
      const key = `${x.toFixed(3)},${z.toFixed(3)}`;
      if (end && posts.has(key)) continue;
      posts.add(key);
      const size = end ? POST : BALUSTER;
      const h = end ? RAIL_H + 0.02 : RAIL_H - 0.01;
      parts.push(part(boxGeo(size, h, size), RAIL_WOOD, WOOD, xform([x, y0 + h / 2, z])));
    }
    parts.push(beamBetween([p0[0], y0 + RAIL_H, p0[1]], [p1[0], y0 + RAIL_H, p1[1]], 0.026, 0.022, RAIL_WOOD, WOOD));
  }
  return parts;
}
