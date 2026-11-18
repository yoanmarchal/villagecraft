/**
 * Décorations d'angle communes (quoins) + protection associée.
 * Ex-cornerDecorations.tsx, porté en builders de parts. La détection de
 * coin exposé est mutualisée via `isCornerExposed` (cellUtils).
 */

import type { GridCell } from '../../types';
import type { CellFace, CellLookup } from '../../utils/cellUtils';
import { CELL_CORNERS, hasOccupiedCell, isCornerExposed } from '../../utils/cellUtils';
import { varyColorBrightness } from '../../colorPalettes';
import { roundedBoxGeo } from '../geometryCache';
import { part, xform, type Part } from '../parts';
import type { CellContext } from './context';
import { courseBed, MASONRY_COURSES, type MasonryHole } from './masonryParts';

/** Joint entre deux pierres d'angle : celui que l'utilisateur a validé (le parement, lui, est plus serré). */
export const QUOIN_JOINT = 0.006;

/**
 * True si une pierre placée en (x ± w/2) sur `face` empiéterait sur un quoin.
 * Utilisé par les zones protégées des stone patches.
 */
export function isQuoinProtected(
  cell: GridCell,
  lookup: CellLookup,
  isIsolated: boolean,
  face: string,
  x: number,
  w: number,
  margin: number,
): boolean {
  if (isIsolated) return false;

  const isNearLeft = x - w / 2 < -0.5 + margin;
  const isNearRight = x + w / 2 > 0.5 - margin;
  if (!isNearLeft && !isNearRight) return false;

  const checkEdge = (isLeftEdge: boolean): boolean => {
    let dx = 0;
    let dz = 0;

    if (face === 'front') {
      dz = 1;
      dx = isLeftEdge ? -1 : 1;
    } else if (face === 'back') {
      dz = -1;
      dx = isLeftEdge ? -1 : 1;
    } else if (face === 'left') {
      dx = -1;
      dz = isLeftEdge ? -1 : 1;
    } else if (face === 'right') {
      dx = 1;
      dz = isLeftEdge ? -1 : 1;
    }

    return isCornerExposed(lookup, cell, dx, dz);
  };

  if (isNearLeft && checkEdge(true)) return true;
  if (isNearRight && checkEdge(false)) return true;
  return false;
}

// En dessous de ce rayon, le coin est considéré "carré" : pierres d'angle
// en harpe (longue sur une face, courte sur l'autre, en alternance) ; au-delà,
// une colonne de pierres posées sur l'arc.
const SHARP_CORNER_RADIUS = 0.2;

// ── Chaînages d'angle ─────────────────────────────────────────────────────

/** Une pierre de chaînage toutes les deux assises ; la dernière de l'étage en prend trois (9 assises). */
const QUOIN_GROUPS: ReadonlyArray<[number, number]> = [
  [0, 2],
  [2, 4],
  [4, 6],
  [6, MASONRY_COURSES],
];
/**
 * Longueur visible d'une pierre d'angle carrée sur chaque face, alternée
 * d'une pierre à l'autre (harpe : longue sur une face, courte sur l'autre).
 * La longue s'arrête avant le cadre d'une fenêtre (±0,30 du milieu de la face).
 */
const QUOIN_LONG = 0.18;
const QUOIN_SHORT = 0.1;
/** Pierre d'angle sur un coin arrondi : largeurs alternées, épaisseur. */
const ARC_QUOIN_WIDE = 0.11;
const ARC_QUOIN_NARROW = 0.075;
const ARC_QUOIN_DEPTH = 0.06;
/** Saillie des chaînages : en avant du parement (pierres saillantes de 2,4 cm au plus). */
const QUOIN_PROTRUSION = 0.034;
/** En deçà, une jonction arrondie n'est qu'une entaille : pas de chaînage. */
const GROOVE_MIN_RADIUS = 0.05;

/** Une pierre de chaînage : coin, hauteur (repère cellule) et sa forme. */
export type QuoinStone = { dx: -1 | 1; dz: -1 | 1; y0: number; y1: number } & (
  | { kind: 'square'; lenX: number; lenZ: number }
  | { kind: 'arc'; radius: number; phi: number; width: number }
);

/** Un coin qui reçoit un chaînage : angle carré, ou colonne sur l'arc (angle `phi` depuis l'axe X). */
interface QuoinCorner {
  dx: -1 | 1;
  dz: -1 | 1;
  arc: boolean;
  radius: number;
  phi: number;
}

/**
 * Coins chaînés d'une cellule de mur : angles saillants du bâtiment (aucune
 * voisine de côté) et fond des gorges des jonctions arrondies — pas les
 * jonctions d'une façade droite, où ils redessinaient la grille des cases,
 * ni les angles rentrants. Les tours n'en ont pas.
 */
function quoinCorners(ctx: CellContext): QuoinCorner[] {
  const { cell, lookup, isIsolated, radii, settings } = ctx;
  if (isIsolated) return [];
  const has = (dx: number, dz: number) => hasOccupiedCell(lookup, cell.x + dx, cell.y, cell.z + dz);
  const corners: QuoinCorner[] = [];
  for (const { dx, dz, corner } of CELL_CORNERS) {
    const sideX = has(dx, 0);
    const sideZ = has(0, dz);
    const radius = radii[corner];
    const convex = !sideX && !sideZ;
    const groove = sideX !== sideZ && !has(dx, dz) && radius > GROOVE_MIN_RADIUS;
    if (!convex && !groove) continue;
    const arc = groove || radius >= SHARP_CORNER_RADIUS;
    corners.push({ dx, dz, arc, radius, phi: arc ? arcQuoinAngle(radius, settings.quoinMargin) : 0 });
  }
  return corners;
}

/**
 * Pierre du coin `corner` entre les lits `fromRow` et `toRow` (rangs
 * d'assise en repère grille, voir `courseBed`), `index` = son rang dans la
 * colonne (l'alternance longue / courte en dépend), cotes ramenées à la
 * cellule d'étage `storey`.
 */
function quoinStone(corner: QuoinCorner, fromRow: number, toRow: number, index: number, storey: number): QuoinStone {
  const { dx, dz, arc, radius, phi } = corner;
  const odd = ((index % 2) + 2) % 2 === 1;
  const y0 = courseBed(fromRow) - storey - 0.5 + QUOIN_JOINT / 2;
  const y1 = courseBed(toRow) - storey - 0.5 - QUOIN_JOINT / 2;
  if (arc) return { dx, dz, y0, y1, kind: 'arc', radius, phi, width: odd ? ARC_QUOIN_NARROW : ARC_QUOIN_WIDE };
  return { dx, dz, y0, y1, kind: 'square', lenX: odd ? QUOIN_SHORT : QUOIN_LONG, lenZ: odd ? QUOIN_LONG : QUOIN_SHORT };
}

/**
 * Chaînages de la cellule : une colonne continue de pierres calées sur les
 * lits du parement, deux assises par pierre — seul un joint les sépare, le
 * parement est taillé autour (`quoinHoles`).
 */
function quoinStones(ctx: CellContext): QuoinStone[] {
  const { y } = ctx.cell;
  return quoinCorners(ctx).flatMap((corner) =>
    QUOIN_GROUPS.map(([from, to], index) =>
      // Alternance continue d'un étage à l'autre.
      quoinStone(corner, y * MASONRY_COURSES + from, y * MASONRY_COURSES + to, y * QUOIN_GROUPS.length + index, y),
    ),
  );
}

/** Enfouissement de la dernière pierre de chaînage du soubassement sous le terrain. */
const QUOIN_BURY = 0.03;

/**
 * Chaînages du soubassement (plinthParts.ts : sur un terrain en pente, le
 * mur du rez-de-chaussée descend jusqu'au sol) : la colonne de chaque coin
 * se poursuit sous le pied de la cellule, dans les assises du parement et
 * dans la même alternance, jusqu'au terrain au pied du coin (`groundAt`,
 * repère de la cellule), la dernière pierre arrêtée juste dessous.
 */
export function plinthQuoinStones(ctx: CellContext): QuoinStone[] {
  const { groundAt, cell } = ctx;
  if (!groundAt || cell.y !== 0) return [];
  const stones: QuoinStone[] = [];
  for (const corner of quoinCorners(ctx)) {
    const { dx, dz, arc, radius, phi } = corner;
    // Terrain au pied du chaînage : à l'angle, ou sous la colonne posée sur l'arc.
    const [gx, gz] = arc
      ? [dx * (0.5 - radius + radius * Math.cos(phi)), dz * (0.5 - radius + radius * Math.sin(phi))]
      : [dx * 0.5, dz * 0.5];
    const bottom = groundAt(gx, gz) - QUOIN_BURY;
    // Pas de soubassement visible à cet angle.
    if (bottom > -0.5 - 0.004 - QUOIN_BURY) continue;
    // Groupes de deux assises sous le niveau 0, du haut vers le bas.
    for (let index = -1; ; index -= 1) {
      const top = 2 * (index + 1);
      const stone = quoinStone(corner, top - 2, top, index, 0);
      if (stone.y1 <= bottom) break;
      stone.y0 = Math.max(stone.y0, bottom);
      if (stone.y1 - stone.y0 > 0.02) stones.push(stone);
      if (stone.y0 <= bottom) break;
    }
  }
  return stones;
}

/**
 * Angle (depuis l'axe X, vers Z) de la colonne de chaînage sur l'arc d'un
 * coin : au milieu de la plage où ses pierres ne débordent pas de la marge
 * d'angle (`quoinMargin`) sur l'une ou l'autre face.
 *
 * Le retrait d'un point de l'arc dépend de phi sur DEUX faces à la fois :
 * vers la face Z, r − (r + saillie)·cos φ, qui grandit avec φ ; vers la face
 * X, r − (r + saillie)·sin φ, qui grandit quand φ diminue — d'où les deux
 * plafonds. À rayon élevé, sans eux, les pierres plongeaient loin dans les
 * faces voisines, jusque sur les fenêtres.
 */
function arcQuoinAngle(r: number, quoinMargin: number): number {
  const budget = Math.max(0, quoinMargin - ARC_QUOIN_WIDE / 2);
  let lo = 0.18;
  let hi = 0.82;
  if (r > budget) {
    const v = Math.min(1, Math.max(-1, (r - budget) / (r + QUOIN_PROTRUSION)));
    hi = Math.min(hi, Math.acos(v) / (Math.PI / 2));
    lo = Math.max(lo, Math.asin(v) / (Math.PI / 2));
  }
  return ((lo + hi) / 2) * (Math.PI / 2);
}

/** Pierres d'angle (chaînages) d'une cellule de mur, en repère de la cellule. */
export function quoinParts(ctx: CellContext, baseColor: string, stones = quoinStones(ctx)): Part[] {
  const { quoinRoughness } = ctx.settings;
  const mat = { roughness: quoinRoughness };
  const quoinColor = varyColorBrightness(baseColor, -0.12);
  const parts: Part[] = [];
  for (const stone of stones) {
    const { dx, dz, y0, y1 } = stone;
    const height = +(y1 - y0).toFixed(3);
    if (height <= 0) continue;
    const y = (y0 + y1) / 2;
    // Une pierre sur deux un rien plus claire ou plus foncée : la colonne se lit pierre à pierre.
    const color = varyColorBrightness(quoinColor, (Math.abs(Math.round(y * 37)) % 3) * 0.025 - 0.025);
    if (stone.kind === 'square') {
      const { lenX, lenZ } = stone;
      parts.push(
        part(
          roundedBoxGeo(lenX, height, lenZ, 0.01, 2),
          color,
          mat,
          xform([dx * (0.5 + QUOIN_PROTRUSION - lenX / 2), y, dz * (0.5 + QUOIN_PROTRUSION - lenZ / 2)]),
        ),
      );
    } else {
      // Sur l'arc du coin (quart de cercle de rayon r centré en (0,5 − r, 0,5 − r), signé par dx, dz).
      const { radius, phi, width } = stone;
      const nx = dx * Math.cos(phi);
      const nz = dz * Math.sin(phi);
      const reach = radius + QUOIN_PROTRUSION - ARC_QUOIN_DEPTH / 2;
      parts.push(
        part(
          roundedBoxGeo(width, height, ARC_QUOIN_DEPTH, 0.01, 2),
          color,
          mat,
          // Face avant (+Z local) sur la normale sortante, comme FACE_ROTATION_Y.
          xform([dx * (0.5 - radius) + reach * nx, y, dz * (0.5 - radius) + reach * nz], [0, Math.atan2(nx, nz), 0]),
        ),
      );
    }
  }
  return parts;
}

/**
 * Emprises des chaînages sur le parement de `face` (repère de la face, t
 * déroulé le long de l'arc des coins comme dans masonryParts) : le parement
 * est taillé autour, avec de vrais joints, au lieu de passer derrière.
 */
export function quoinHoles(ctx: CellContext, face: CellFace, stones = quoinStones(ctx)): MasonryHole[] {
  const holes: MasonryHole[] = [];
  const alongX = face === 'front' || face === 'back';
  for (const stone of stones) {
    const { dx, dz, y0, y1 } = stone;
    // La face Z du coin (front/back) a t le long de X ; la face X (left/right), t le long de Z.
    const onZFace = face === (dz > 0 ? 'front' : 'back');
    const onXFace = face === (dx > 0 ? 'right' : 'left');
    if (!onZFace && !onXFace) continue;
    const sign = alongX ? dx : dz;
    let near: number;
    let far: number;
    if (stone.kind === 'square') {
      // Longueur de la pierre le long de cette face, comptée depuis son nez saillant.
      const length = onZFace ? stone.lenX : stone.lenZ;
      near = 0.5 + QUOIN_PROTRUSION - length;
      far = 0.6;
    } else {
      // Arc : t = (0,5 − r) + r·tour, le tour compté depuis le plat de la face.
      const { radius, phi, width } = stone;
      const turn = onZFace ? Math.PI / 2 - phi : phi;
      const half = width / 2 / radius;
      near = 0.5 - radius + radius * (turn - half);
      far = 0.5 - radius + radius * (turn + half);
    }
    holes.push({ t0: sign > 0 ? near : -far, t1: sign > 0 ? far : -near, y0, y1 });
  }
  return holes;
}
