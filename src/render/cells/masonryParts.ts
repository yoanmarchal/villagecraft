/**
 * Maçonnerie de pierre en vraie géométrie : chaque pierre est un bloc en
 * saillie sur le nu du mur (de 4 à 7 cm), aux arêtes arrondies. Vu de
 * côté, le parement a donc un vrai relief — silhouette, ombres portées et
 * occlusion ambiante comprises —, ce qu'aucun effet de shader ne donnait
 * (bosselage plat en vue rasante, parallaxe qui tordait les pierres).
 *
 * L'appareil est celui d'un château fort : moellons équarris en assises de
 * hauteurs inégales, pierres de longueurs variables, joints décalés d'une
 * assise à l'autre. Il est calculé dans le repère de la GRILLE, pas de la
 * cellule : les lits de pose ne dépendent que de la hauteur, les joints
 * montants que de l'abscisse le long du mur. Deux cellules voisines d'un même
 * bâtiment dessinent donc chacune leur moitié d'une même pierre, à la même
 * saillie et de la même teinte — la fusion des bâtiments reste invisible, et
 * chaque cellule reste indépendante (un clic ne refusionne que ses chunks).
 *
 * Par face : les pierres sont rognées au bord de la cellule, découpées autour
 * des ouvertures (`holes`), au-dessus d'une arche (`floorAt`), et posées le
 * long de l'arc sur les coins arrondis (tours), par tronçons courts.
 */

import * as THREE from 'three';
import type { GridCell } from '../../types';
import type { CellFace, CellLookup, CornerRadii } from '../../utils/cellUtils';
import { getCell, getFaceCorners } from '../../utils/cellUtils';
import { BlockType } from '../../types';
import { roundedBoxGeo, stoneBlockGeo, STONE_EDGE } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';

/** Assises par étage (1 unité ≈ 2,8 m) : pierres d'une trentaine de centimètres de haut en moyenne. */
export const MASONRY_COURSES = 9;
/** Largeur du joint de mortier entre deux pierres. */
const JOINT = 0.009;
/** Saillie des pierres sur le nu du mur : chacune la sienne, entre ces deux bornes. */
const DEPTH_MIN = 0.014;
const DEPTH_MAX = 0.024;
/** Encastrement dans le mur (couvre la flèche de l'arc sous une pierre droite posée sur un coin arrondi). */
const EMBED = 0.012;
/** En deçà, un éclat de pierre (reste d'une découpe) n'est pas posé. */
const MIN_PIECE = 0.014;
/** Largeur maximale d'un tronçon de pierre sur un arc, en fraction du rayon (≈ 17°). */
const ARC_CHUNK = 0.3;
/** Pas de découpe au-dessus d'une arche. */
const FLOOR_SLICE = 0.045;

/** Rectangle (repère de la face : t le long du mur, y vertical) laissé libre de pierres : ouverture, plinthe… */
export interface MasonryHole {
  t0: number;
  t1: number;
  y0: number;
  y1: number;
}

export interface MasonryFace {
  face: CellFace;
  holes?: MasonryHole[];
  /** Hauteur minimale des pierres à l'abscisse t (extrados d'une arche) ; absent = jusqu'au pied de la cellule. */
  floorAt?: (t: number) => number;
  /** Bande de hauteur à garnir (repère cellule) ; absent = toute la cellule. Parapet d'une tour, par exemple. */
  yRange?: [number, number];
  /**
   * Demi-côté du contour à habiller (0,5 = la cellule). Autre valeur : un
   * ouvrage posé sur la cellule (parapet de tour au rayon `towerR`), dont les
   * bouts sont toujours de vrais bords ; `radii` est alors à son échelle.
   */
  extent?: number;
}

/** Hash entier → [0, 1), stable (jamais Math.random : même grille → mêmes pierres). */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Cote (repère grille, 1 = un étage) du lit de pose n° k. Décalé au hasard
 * autour d'une trame régulière, sauf aux niveaux d'étage : un lit y passe
 * toujours, si bien qu'aucune pierre n'est à cheval sur deux étages.
 */
export function courseBed(k: number): number {
  if (((k % MASONRY_COURSES) + MASONRY_COURSES) % MASONRY_COURSES === 0) return k / MASONRY_COURSES;
  return (k + (hash3(k, 0, 1) - 0.5) * 0.5) / MASONRY_COURSES;
}

/** Abscisse (repère grille) du joint montant n° c de l'assise `row`, pour les murs d'axe `axis` (0 : x, 1 : z). */
function stoneHead(c: number, row: number, axis: number): number {
  // Module et décalage propres à chaque assise : jamais deux assises identiques.
  const width = 0.17 + 0.1 * hash3(row, 1, axis);
  const shift = hash3(row, 2, axis) * width;
  return (c + (hash3(c, row, axis + 3) - 0.5) * 0.55) * width - shift;
}

/** Colonne c telle que stoneHead(c) ≤ u < stoneHead(c + 1). */
function columnAt(u: number, row: number, axis: number): number {
  const width = 0.17 + 0.1 * hash3(row, 1, axis);
  let c = Math.floor((u + hash3(row, 2, axis) * width) / width);
  while (stoneHead(c, row, axis) > u) c -= 1;
  while (stoneHead(c + 1, row, axis) <= u) c += 1;
  return c;
}

/** Morceau de pierre dans le repère de la face ; `edges` : côtés qui sont de vrais bords (joint + chanfrein). */
interface Piece {
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/** Retire `hole` de `piece` : jusqu'à quatre morceaux, dont les côtés tournés vers l'ouverture deviennent des bords. */
function subtract(piece: Piece, hole: MasonryHole): Piece[] {
  if (hole.t1 <= piece.t0 || hole.t0 >= piece.t1 || hole.y1 <= piece.y0 || hole.y0 >= piece.y1) return [piece];
  const out: Piece[] = [];
  if (hole.t0 > piece.t0) out.push({ ...piece, t1: hole.t0, right: true });
  if (hole.t1 < piece.t1) out.push({ ...piece, t0: hole.t1, left: true });
  const t0 = Math.max(piece.t0, hole.t0);
  const t1 = Math.min(piece.t1, hole.t1);
  const left = hole.t0 > piece.t0 ? false : piece.left;
  const right = hole.t1 < piece.t1 ? false : piece.right;
  if (hole.y0 > piece.y0) out.push({ ...piece, t0, t1, left, right, y1: hole.y0, top: true });
  if (hole.y1 < piece.y1) out.push({ ...piece, t0, t1, left, right, y0: hole.y1, bottom: true });
  return out;
}

/** Coupe `piece` aux abscisses `cuts` : les coupes sont internes à la pierre (ni joint ni chanfrein). */
function splitAt(piece: Piece, cuts: number[]): Piece[] {
  const inside = cuts.filter((t) => t > piece.t0 + 1e-6 && t < piece.t1 - 1e-6).sort((a, b) => a - b);
  if (inside.length === 0) return [piece];
  const bounds = [piece.t0, ...inside, piece.t1];
  return bounds.slice(0, -1).map((t0, i) => ({
    ...piece,
    t0,
    t1: bounds[i + 1],
    left: i === 0 ? piece.left : false,
    right: i === bounds.length - 2 ? piece.right : false,
  }));
}

/** Teintes des pierres d'un mur de couleur `base` : chaque pierre vient d'un banc différent. */
const paletteCache = new Map<string, string[]>();
const PALETTE_SIZE = 14;
function stonePalette(base: string): string[] {
  let palette = paletteCache.get(base);
  if (!palette) {
    const warm = new THREE.Color(1.07, 0.99, 0.88);
    const cool = new THREE.Color(0.94, 0.99, 1.06);
    palette = Array.from({ length: PALETTE_SIZE }, (_, i) => {
      // Plus ou moins claire, tirant sur l'ocre ou le gris ; une sur sept nettement plus sombre.
      const tone = (i % 7 === 6 ? 0.72 : 0.84) + 0.24 * hash3(i, 11, 3);
      const tint = warm.clone().lerp(cool, hash3(i, 12, 5));
      const color = new THREE.Color(base).multiply(tint).multiplyScalar(tone);
      return `#${color.getHexString()}`;
    });
    if (paletteCache.size > 32) paletteCache.clear();
    paletteCache.set(base, palette);
  }
  return palette;
}

const FACE_NORMAL: Record<CellFace, [number, number]> = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };

/**
 * La face `face` de la cellule en (x, y, z) porte-t-elle un parement ? Oui si
 * rien n'est bâti devant — ou seulement un toit : il ne cache le mur qu'en
 * partie (au-dessus d'un chemin de ronde, d'un pan de toit adossé), alors
 * qu'un mur ou une arche le masquent entièrement.
 */
function isFacedAt(lookup: CellLookup, x: number, y: number, z: number, face: CellFace): boolean {
  const [fx, fz] = FACE_NORMAL[face];
  const front = getCell(lookup, x + fx, y, z + fz);
  return !front?.isOccupied || front.type === BlockType.Roof;
}

/** Faces d'une cellule de mur qui reçoivent un parement de pierre (voir `isFacedAt`). */
export function masonryFacesOf(lookup: CellLookup, cell: GridCell): CellFace[] {
  return (['front', 'back', 'left', 'right'] as const).filter((face) =>
    isFacedAt(lookup, cell.x, cell.y, cell.z, face),
  );
}

/** Le mur de la face `face` se prolonge-t-il, dans le même plan, dans la cellule voisine du côté `side` (±1 le long de t) ? */
function continues(lookup: CellLookup, cell: GridCell, face: CellFace, side: 1 | -1): boolean {
  const alongX = face === 'front' || face === 'back';
  const nx = cell.x + (alongX ? side : 0);
  const nz = cell.z + (alongX ? 0 : side);
  const neighbour = getCell(lookup, nx, cell.y, nz);
  if (!neighbour?.isOccupied || neighbour.type === BlockType.Roof) return false;
  return isFacedAt(lookup, nx, cell.y, nz, face);
}

interface MasonryContext {
  cell: GridCell;
  lookup: CellLookup;
  radii: CornerRadii;
}

/**
 * Pierres des faces `faces` d'une cellule. `color` : teinte du mur ;
 * `roughness` : celle des pierres.
 */
export function masonryParts(
  { cell, lookup, radii }: MasonryContext,
  faces: MasonryFace[],
  color: string,
  roughness: number,
): Part[] {
  const parts: Part[] = [];
  const palette = stonePalette(color);
  const mat = { roughness };

  for (const { face, holes = [], floorAt, yRange, extent } of faces) {
    const half = extent ?? 0.5;
    const [yLow, yHigh] = yRange ?? [-0.5, 0.5];
    const alongX = face === 'front' || face === 'back';
    const axis = alongX ? 0 : 1;
    /** Abscisse grille de t = 0 : les joints montants ne dépendent que d'elle. */
    const origin = (alongX ? cell.x : cell.z) + 0.5;

    // Étendue de la face en abscisse déroulée : jusqu'au bord de la cellule,
    // ou jusqu'à la diagonale du coin arrondi (l'autre moitié de l'arc
    // revient à la face voisine).
    const [radiusNeg, radiusPos] = getFaceCorners(face, radii, 'numeric');
    const rounded = (r: number) => r > 0.001;
    const flatNeg = -(half - (rounded(radiusNeg) ? radiusNeg : 0));
    const flatPos = half - (rounded(radiusPos) ? radiusPos : 0);
    const tMin = flatNeg - (rounded(radiusNeg) ? (radiusNeg * Math.PI) / 4 : 0);
    const tMax = flatPos + (rounded(radiusPos) ? (radiusPos * Math.PI) / 4 : 0);
    // Au bord de la cellule, la pierre n'a de joint que si le mur s'arrête là.
    const edgeNeg = extent !== undefined || rounded(radiusNeg) || !continues(lookup, cell, face, -1);
    const edgePos = extent !== undefined || rounded(radiusPos) || !continues(lookup, cell, face, 1);

    // Coupes : limite plat / arc, puis tronçons courts le long de l'arc.
    const cuts: number[] = [];
    for (const [flat, end, radius] of [
      [flatNeg, tMin, radiusNeg],
      [flatPos, tMax, radiusPos],
    ] as const) {
      if (!rounded(radius)) continue;
      const count = Math.max(1, Math.ceil(Math.abs(end - flat) / (radius * ARC_CHUNK)));
      for (let i = 0; i < count; i += 1) cuts.push(flat + ((end - flat) * i) / count);
    }

    // Assises qui croisent la bande de hauteur, rognées à ses bornes.
    const bedAt = (row: number) => courseBed(row) - cell.y - 0.5;
    let firstRow = Math.floor((cell.y + 0.5 + yLow) * MASONRY_COURSES) - 1;
    while (bedAt(firstRow + 1) <= yLow + 1e-9) firstRow += 1;
    for (let row = firstRow; bedAt(row) < yHigh - 1e-9; row += 1) {
      const y0 = Math.max(bedAt(row), yLow);
      const y1 = Math.min(bedAt(row + 1), yHigh);
      if (y1 - y0 < MIN_PIECE) continue;

      const lastColumn = columnAt(origin + tMax - 1e-6, row, axis);
      for (let column = columnAt(origin + tMin, row, axis); column <= lastColumn; column += 1) {
        const stone0 = stoneHead(column, row, axis) - origin;
        const stone1 = stoneHead(column + 1, row, axis) - origin;
        const seed = hash3(column, row, axis + 7);

        let pieces: Piece[] = [
          {
            t0: Math.max(stone0, tMin),
            t1: Math.min(stone1, tMax),
            y0,
            y1,
            left: stone0 >= tMin ? true : edgeNeg,
            right: stone1 <= tMax ? true : edgePos,
            top: true,
            bottom: true,
          },
        ];
        pieces = pieces.flatMap((piece) => splitAt(piece, cuts));
        for (const hole of holes) pieces = pieces.flatMap((piece) => subtract(piece, hole));
        if (floorAt) {
          pieces = pieces.flatMap((piece) => {
            if (Math.max(floorAt(piece.t0), floorAt(piece.t1), floorAt((piece.t0 + piece.t1) / 2)) <= piece.y0) {
              return [piece];
            }
            // Au-dessus de l'arche : tranches étroites, relevées jusqu'à l'extrados.
            const count = Math.ceil((piece.t1 - piece.t0) / FLOOR_SLICE);
            const slices = splitAt(
              piece,
              Array.from({ length: count - 1 }, (_, i) => piece.t0 + ((piece.t1 - piece.t0) * (i + 1)) / count),
            );
            return slices.map((slice) => {
              const floor = Math.max(floorAt(slice.t0), floorAt(slice.t1));
              return floor > slice.y0 ? { ...slice, y0: floor, bottom: true } : slice;
            });
          });
        }

        // Saillie et teinte : celles de la pierre entière, donc identiques
        // pour ses morceaux — y compris ceux que dessine la cellule voisine.
        const depth = DEPTH_MIN + (DEPTH_MAX - DEPTH_MIN) * hash3(column, row, axis + 9);
        const stoneColor = palette[Math.floor(seed * PALETTE_SIZE) % PALETTE_SIZE];

        for (const piece of pieces) {
          const inset = JOINT / 2;
          const t0 = piece.t0 + (piece.left ? inset : 0);
          const t1 = piece.t1 - (piece.right ? inset : 0);
          const bottom = piece.y0 + (piece.bottom ? inset : 0);
          const top = piece.y1 - (piece.top ? inset : 0);
          let width = t1 - t0;
          const height = top - bottom;
          if (width < MIN_PIECE || height < MIN_PIECE) continue;

          // Projection sur la surface réelle : à plat, ou le long de l'arc du coin.
          const t = (t0 + t1) / 2;
          let lateral = t;
          let surface = half;
          let turn = 0;
          if (t > flatPos && rounded(radiusPos)) {
            turn = (t - flatPos) / radiusPos;
            lateral = flatPos + radiusPos * Math.sin(turn);
            surface = half - radiusPos + radiusPos * Math.cos(turn);
          } else if (t < flatNeg && rounded(radiusNeg)) {
            turn = (t - flatNeg) / radiusNeg;
            lateral = flatNeg + radiusNeg * Math.sin(turn);
            surface = half - radiusNeg + radiusNeg * Math.cos(turn);
          }
          // Centre du bloc, décalé le long de la normale locale : encastré de EMBED, saillant de `depth`.
          const thickness = depth + EMBED;
          // Sur un arc, deux tronçons voisins sont tournés l'un par rapport à
          // l'autre : leurs faces avant s'écartent en coin et laissaient voir
          // le mur. Chaque coupe interne est élargie de ce qu'il faut pour
          // qu'elles se rejoignent au nu extérieur (elles se recoupent dans le mur).
          if (turn !== 0) {
            const radius = turn > 0 ? radiusPos : radiusNeg;
            const widen = thickness * Math.tan(width / (2 * radius));
            width += (piece.left ? 0 : widen) + (piece.right ? 0 : widen);
            // Recentrage si un seul côté est élargi.
            const drift = ((piece.right ? 0 : widen) - (piece.left ? 0 : widen)) / 2;
            lateral += Math.cos(turn) * drift;
            surface -= Math.sin(turn) * drift;
          }
          const out = (depth - EMBED) / 2;
          const lx = lateral + Math.sin(turn) * out;
          const lz = surface + Math.cos(turn) * out;

          // Repère de la face → cellule. La rotation oriente la face avant du
          // bloc (+z local) sur la normale sortante ; pour `back` et `right`
          // elle retourne aussi son axe x : gauche et droite s'échangent.
          let position: [number, number, number];
          let rotation: number;
          let mirrored = false;
          switch (face) {
            case 'front':
              position = [lx, (bottom + top) / 2, lz];
              rotation = turn;
              break;
            case 'back':
              position = [lx, (bottom + top) / 2, -lz];
              rotation = Math.PI - turn;
              mirrored = true;
              break;
            case 'left':
              position = [-lz, (bottom + top) / 2, lx];
              rotation = turn - Math.PI / 2;
              break;
            case 'right':
              position = [lz, (bottom + top) / 2, lx];
              rotation = Math.PI / 2 - turn;
              mirrored = true;
              break;
          }
          const mask =
            ((mirrored ? piece.right : piece.left) ? STONE_EDGE.left : 0) |
            ((mirrored ? piece.left : piece.right) ? STONE_EDGE.right : 0) |
            (piece.top ? STONE_EDGE.top : 0) |
            (piece.bottom ? STONE_EDGE.bottom : 0);
          parts.push({
            ...part(
              stoneBlockGeo(mask),
              stoneColor,
              mat,
              xform(position, [0, rotation, 0], [width, height, thickness]),
            ),
            rigidNormals: true,
          });
        }
      }
    }
  }

  return parts;
}

/** Hauteur visée d'une assise d'un petit ouvrage, et longueur visée de ses pierres. */
const WORK_COURSE = 0.095;
const WORK_STONE = 0.19;
/** Débord des pierres sur le noyau de l'ouvrage, de chaque côté. */
const WORK_PROUD = 0.008;

/**
 * Petit ouvrage maçonné (parapet, merlon, souche de cheminée) monté en vraies
 * pierres : le volume `w` × `h` × `d` centré sur `matrix` (w le long de son x
 * local) est rempli d'assises de blocs aux arêtes arrondies, joints décalés
 * d'une assise à l'autre, chaque pierre débordant un peu du noyau — que
 * l'appelant garde, teinté en mortier (`masonry`) : il se voit dans les
 * joints. Les blocs traversent l'ouvrage : ses deux faces et son dessus ont
 * donc le même relief. `seed` : graine entière (coordonnées de la cellule…).
 */
export function stoneCourseParts(
  matrix: THREE.Matrix4,
  w: number,
  h: number,
  d: number,
  color: string,
  roughness: number,
  seed: number,
): Part[] {
  const palette = stonePalette(color);
  const mat = { roughness };
  const size = (value: number) => +value.toFixed(3);
  const rows = Math.max(1, Math.round(h / WORK_COURSE));
  const rowHeight = h / rows;
  const count = Math.max(1, Math.round(w / WORK_STONE));
  const parts: Part[] = [];

  for (let row = 0; row < rows; row += 1) {
    // Joints montants : réguliers, décalés d'une demi-pierre une assise sur deux, un peu bousculés.
    const bounds = [-w / 2];
    for (let i = 1; i < count; i += 1) {
      const stagger = (row % 2 === 0 ? -0.22 : 0.22) + (hash3(seed + i, row, 5) - 0.5) * 0.18;
      bounds.push(-w / 2 + ((i + stagger) * w) / count);
    }
    bounds.push(w / 2);

    for (let i = 0; i < count; i += 1) {
      // Une pierre seule dans son assise (merlon, souche) déborde aussi en largeur.
      const width = count === 1 ? w + 2 * WORK_PROUD : bounds[i + 1] - bounds[i] - JOINT;
      const height = rowHeight - JOINT;
      if (width < MIN_PIECE || height < MIN_PIECE) continue;
      const tone = palette[Math.floor(hash3(seed + i, row, 9) * PALETTE_SIZE) % PALETTE_SIZE];
      parts.push(
        part(
          roundedBoxGeo(size(width), size(height), size(d + 2 * WORK_PROUD), 0.012, 2),
          tone,
          mat,
          mul(matrix, xform([(bounds[i] + bounds[i + 1]) / 2, -h / 2 + rowHeight * (row + 0.5), 0])),
        ),
      );
    }
  }
  return parts;
}
