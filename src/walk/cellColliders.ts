/**
 * Volumes de collision d'une cellule, pour le promeneur : le « builder de
 * collisions », pendant des builders de géométrie. Appelé par buildVillage
 * (dans le worker) avec le même `CellContext` — portes, escaliers et
 * trémies tombent donc exactement là où ils sont dessinés — et mis en cache
 * avec les pièces du bâtiment.
 *
 * Des boîtes alignées sur les axes, en repère de la cellule (centre à
 * l'origine, cube [−0,5 ; 0,5]³), grossières mais du bon côté : on ne
 * traverse pas un mur, on passe les portes, on monte les escaliers marche à
 * marche (une contremarche fait 1/16 d'unité, sous `STEP_HEIGHT`).
 *
 *  - Toits, arches : pleins.
 *  - Blocs creux : plancher et plafond (percés des trémies), un mur par côté
 *    `exterior` ou `partition` (rien sur un côté `open`), piliers d'angle,
 *    coins arrondis remplis en escalier jusqu'à l'arc intérieur, passage de
 *    la porte découpé dans tout ça, perron dehors ; escaliers en L et en vis,
 *    garde-corps autour de la trémie d'arrivée. Échelles, meubles, cheminées
 *    et vantaux ne bloquent pas (pour l'instant).
 *  - La case du bas d'une colonne descend sous le terrain (soubassement).
 */

import { BlockType } from '../types';
import { CELL_CORNERS, type CellFace } from '../utils/cellUtils';
import { pointInPolygon, type Point, type Polygon } from '../utils/polygon';
import { FLOOR_T, OPENING_SIZES, WALL_T } from '../render/geometryCache';
import type { CellContext } from '../render/cells/context';
import { doorSteps, openingScale } from '../render/cells/doors';
import {
  faceFramePoint,
  L_LAYOUT,
  L_STAIR,
  lStairPoint,
  RAIL_H,
  ARRIVAL_PASSAGE,
  SPIRAL,
  STAIR_FLOOR_Y,
  STAIR_RISE,
  type LStairPlan,
  type SlabOpening,
  type SpiralStairPlan,
} from '../render/cells/stairPlan';

/** Boîte [x0, y0, z0, x1, y1, z1], min puis max. */
export type Box = [number, number, number, number, number, number];

/** Profondeur du soubassement sous le pied du bâtiment : il descend jusque sous le terrain. */
const PLINTH_DEPTH = 50;
/** Résolution du découpage d'une dalle autour d'une trémie (cases de 1/32). */
const SLAB_GRID = 32;
/** Garde-corps d'une trémie : hauteur au-dessus du plancher (~85 cm) et épaisseur. */
const RAIL_T = 0.02;
/** Le passage d'une porte est découpé jusqu'à cette profondeur dans la cellule (coins arrondis des tours compris). */
const DOOR_CUT_DEPTH = 0.2;

const FACES: CellFace[] = ['front', 'back', 'left', 'right'];

/** Boîte donnée dans le repère d'un mur : latéral l0..l1, profondeur (vers l'extérieur) d0..d1, hauteur y0..y1. */
function faceBox(face: CellFace, l0: number, l1: number, d0: number, d1: number, y0: number, y1: number): Box {
  const [ax, az] = faceFramePoint(face, l0, d0);
  const [bx, bz] = faceFramePoint(face, l1, d1);
  return [Math.min(ax, bx), y0, Math.min(az, bz), Math.max(ax, bx), y1, Math.max(az, bz)];
}

const overlap = (a: Box, b: Box) =>
  a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];

/** `box` privée de `cut` : jusqu'à six morceaux. */
export function subtractBox(box: Box, cut: Box): Box[] {
  if (!overlap(box, cut)) return [box];
  const pieces: Box[] = [];
  const rest: Box = [...box];
  for (let axis = 0; axis < 3; axis += 1) {
    if (rest[axis] < cut[axis]) {
      const piece: Box = [...rest];
      piece[axis + 3] = cut[axis];
      pieces.push(piece);
      rest[axis] = cut[axis];
    }
    if (rest[axis + 3] > cut[axis + 3]) {
      const piece: Box = [...rest];
      piece[axis] = cut[axis + 3];
      pieces.push(piece);
      rest[axis + 3] = cut[axis + 3];
    }
  }
  return pieces;
}

/**
 * Dalle pleine de y0 à y1 sur toute la cellule, percée de `hole` : découpée
 * en bandes (une rangée de 1/32 à la fois, cases contiguës fusionnées). Une
 * case n'est pleine que tout entière hors de la trémie : son bord passe du
 * côté vide. La tête qui monte ne bute pas sur 3 cm de dalle, les épaules
 * passent la couronne de plancher (1,5 cm) entre la trémie d'une vis et le
 * mur ; côté plancher, les bords libres ont leur garde-corps.
 */
/** Bandes pleines (x0, z0, x1, z1) d'une dalle percée, par forme de trémie : peu de formes dans tout un village. */
const slabStrips = new Map<string, Array<[number, number, number, number]>>();

function slab(y0: number, y1: number, hole: Polygon | null): Box[] {
  if (!hole) return [[-0.5, y0, -0.5, 0.5, y1, 0.5]];
  const key = hole.map(([x, z]) => `${x},${z}`).join(';');
  let strips = slabStrips.get(key);
  if (!strips) {
    strips = holedSlab(hole);
    if (slabStrips.size > 500) slabStrips.clear();
    slabStrips.set(key, strips);
  }
  return strips.map(([x0, z0, x1, z1]) => [x0, y0, z0, x1, y1, z1]);
}

function holedSlab(hole: Polygon): Array<[number, number, number, number]> {
  const size = 1 / SLAB_GRID;
  // Seules les cases dans l'emprise de la trémie sont à tester.
  const xs = hole.map(([x]) => x);
  const zs = hole.map(([, z]) => z);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) + 0.5) / size));
  const i1 = Math.min(SLAB_GRID - 1, Math.floor((Math.max(...xs) + 0.5) / size));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) + 0.5) / size));
  const j1 = Math.min(SLAB_GRID - 1, Math.floor((Math.max(...zs) + 0.5) / size));
  const solidCell = (i: number, j: number) => {
    if (i < i0 || i > i1) return true;
    const x0 = -0.5 + i * size;
    const z0 = -0.5 + j * size;
    const probes: Point[] = [
      [x0 + size / 2, z0 + size / 2],
      [x0 + 0.001, z0 + 0.001],
      [x0 + size - 0.001, z0 + 0.001],
      [x0 + 0.001, z0 + size - 0.001],
      [x0 + size - 0.001, z0 + size - 0.001],
    ];
    return probes.every((probe) => !pointInPolygon(probe, hole));
  };
  const strips: Array<[number, number, number, number]> = [];
  // Hors de l'emprise, une dalle pleine de chaque côté.
  if (j0 > 0) strips.push([-0.5, -0.5, 0.5, -0.5 + j0 * size]);
  if (j1 < SLAB_GRID - 1) strips.push([-0.5, -0.5 + (j1 + 1) * size, 0.5, 0.5]);
  // Dans l'emprise, rangée par rangée ; une bande identique à celle de la rangée précédente la prolonge.
  let open = new Map<string, [number, number, number, number]>();
  for (let j = j0; j <= j1; j += 1) {
    const z0 = -0.5 + j * size;
    const next = new Map<string, [number, number, number, number]>();
    let start = -1;
    for (let i = 0; i <= SLAB_GRID; i += 1) {
      const solid = i < SLAB_GRID && solidCell(i, j);
      if (solid && start < 0) start = i;
      if (!solid && start >= 0) {
        const id = `${start},${i}`;
        let strip = open.get(id);
        if (strip) strip[3] = z0 + size;
        else {
          strip = [-0.5 + start * size, z0, -0.5 + i * size, z0 + size];
          strips.push(strip);
        }
        next.set(id, strip);
        start = -1;
      }
    }
    open = next;
  }
  return strips;
}

/**
 * Coin arrondi (rayon `r` au nu extérieur) : le mur suit un arc de rayon
 * r − WALL_T à l'intérieur. On remplit le carré du coin hors de cet arc, en
 * tranches dans les deux sens (l'arc est raide aux deux bouts).
 */
function roundedCorner(dx: -1 | 1, dz: -1 | 1, r: number): Box[] {
  const inner = r - WALL_T;
  const slices = Math.max(3, Math.ceil(r / 0.05));
  const boxes: Box[] = [];
  const reach = (u: number) => (u < inner ? Math.sqrt(inner * inner - u * u) : 0);
  const base = 0.5 - r;
  for (let k = 0; k < slices; k += 1) {
    const u0 = (k * r) / slices;
    const u1 = ((k + 1) * r) / slices;
    const v = reach((u0 + u1) / 2);
    // Tranche le long de x (de u0 à u1), pleine de l'arc jusqu'au bord en z ; puis la même en z.
    for (const [a0, a1, b0, b1] of [
      [base + u0, base + u1, base + v, 0.5],
      [base + v, 0.5, base + u0, base + u1],
    ]) {
      const xs = [dx * a0, dx * a1];
      const zs = [dz * b0, dz * b1];
      boxes.push([Math.min(...xs), -0.5, Math.min(...zs), Math.max(...xs), 0.5, Math.max(...zs)]);
    }
  }
  return boxes;
}

/** Escalier en L : volée du bas en marches pleines, quart tournant, volée du haut (pleine dessous). */
function lStairBoxes(plan: LStairPlan): Box[] {
  const { inner, outer, start } = L_LAYOUT;
  const { tread, flightTreads, winders } = L_STAIR;
  const y0 = STAIR_FLOOR_Y;
  const r = STAIR_RISE;
  const canonical = (a0: number, a1: number, b0: number, b1: number, top: number): Box => {
    const [x0, z0] = lStairPoint(plan, a0, b0);
    const [x1, z1] = lStairPoint(plan, a1, b1);
    return [Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), top, Math.max(z0, z1)];
  };
  const boxes: Box[] = [];
  for (let k = 1; k <= flightTreads; k += 1) {
    const b0 = start + (k - 1) * tread;
    boxes.push(canonical(inner, outer, b0, b0 + tread, y0 + k * r));
  }
  // Quart tournant : le carré du coin en 6 × 6, chaque case à la marche dansante de son secteur.
  const grid = 6;
  const span = (outer - inner) / grid;
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const phi = Math.atan2((j + 0.5) * span, (i + 0.5) * span);
      const w = Math.min(winders, Math.floor(phi / (Math.PI / 2 / winders)) + 1);
      const a = inner + i * span;
      const b = inner + j * span;
      boxes.push(canonical(a, a + span, b, b + span, y0 + (flightTreads + w) * r));
    }
  }
  const turnTop = y0 + (flightTreads + winders) * r;
  for (let j = 1; j <= flightTreads; j += 1) {
    const a1 = inner - (j - 1) * tread;
    boxes.push(canonical(a1 - tread, a1, inner, outer, turnTop + j * r));
  }
  return boxes;
}

/** Vis : noyau, et le disque des marches en cases de ~6 cm, chacune à la hauteur et de l'épaisseur de sa marche. */
function spiralBoxes(plan: SpiralStairPlan): Box[] {
  const { newelR, outerR, steps, stepAngle } = SPIRAL;
  const y0 = STAIR_FLOOR_Y;
  const boxes: Box[] = [[-newelR, y0, -newelR, newelR, y0 + 1, newelR]];
  const grid = 14;
  const size = (2 * outerR) / grid;
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const x = -outerR + (i + 0.5) * size;
      const z = -outerR + (j + 0.5) * size;
      const radius = Math.hypot(x, z);
      if (radius > outerR || radius < newelR) continue;
      const turn = Math.PI * 2;
      const relative = (((Math.atan2(x, z) - plan.angle) % turn) + turn) % turn;
      const k = Math.floor(relative / stepAngle) + 1;
      if (k > steps) continue; // palier : le plancher
      // Marche de l'épaisseur dessinée (stairParts) : on passe dessous à l'étage d'en dessous.
      const top = y0 + k * STAIR_RISE;
      const thickness = Math.min(STAIR_RISE + 0.03, k * STAIR_RISE);
      boxes.push([x - size / 2, top - thickness, z - size / 2, x + size / 2, top, z + size / 2]);
    }
  }
  return boxes;
}

/** Garde-corps le long des bords libres de la trémie d'arrivée, posé sur le plancher. */
function railingBoxes({ points, edges }: SlabOpening, floor: number): Box[] {
  const boxes: Box[] = [];
  const count = edges.length;
  edges.forEach((edge, i) => {
    if (edge !== 'free') return;
    let a: Point = points[i];
    let b: Point = points[(i + 1) % points.length];
    const full = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const toward = (from: Point, to: Point, d: number): Point => [
      from[0] + ((to[0] - from[0]) * d) / full,
      from[1] + ((to[1] - from[1]) * d) / full,
    ];
    // Comme le garde-corps dessiné (stairwellRailingParts) : il s'arrête court côté arrivée.
    const trimStart = edges[(i + count - 1) % count] === 'arrival' ? ARRIVAL_PASSAGE : 0;
    const trimEnd = edges[(i + 1) % count] === 'arrival' ? ARRIVAL_PASSAGE : 0;
    if (full <= trimStart + trimEnd) return;
    [a, b] = [toward(a, b, trimStart), toward(b, a, trimEnd)];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const pieces = Math.max(1, Math.ceil(length / 0.04));
    // Bord droit : une seule boîte ; en biais : une file de petites.
    const straight = Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6;
    for (let k = 0; k < (straight ? 1 : pieces); k += 1) {
      const t0 = straight ? 0 : k / pieces;
      const t1 = straight ? 1 : (k + 1) / pieces;
      const xs = [a[0] + (b[0] - a[0]) * t0, a[0] + (b[0] - a[0]) * t1];
      const zs = [a[1] + (b[1] - a[1]) * t0, a[1] + (b[1] - a[1]) * t1];
      boxes.push([
        Math.min(...xs) - RAIL_T / 2,
        floor,
        Math.min(...zs) - RAIL_T / 2,
        Math.max(...xs) + RAIL_T / 2,
        floor + RAIL_H,
        Math.max(...zs) + RAIL_T / 2,
      ]);
    }
  });
  return boxes;
}

export function cellColliders(ctx: CellContext): Box[] {
  const { cell, hollow } = ctx;
  const boxes: Box[] = [];
  if (cell.y === 0) boxes.push([-0.5, -0.5 - PLINTH_DEPTH, -0.5, 0.5, -0.5, 0.5]);
  if (!hollow) {
    boxes.push([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
    return boxes;
  }

  // Planchers : le dessus des lames (STAIR_FLOOR_Y), percés des trémies d'escalier (pas des trappes d'échelle).
  const holeOf = (plan: CellContext['stair']) => (plan && plan.kind !== 'ladder' ? plan.opening.points : null);
  boxes.push(...slab(-0.5, STAIR_FLOOR_Y, holeOf(ctx.stairBelow)));
  boxes.push(...slab(0.5 - FLOOR_T, 0.5, holeOf(ctx.stair)));

  // Murs, piliers, coins arrondis.
  let walls: Box[] = [];
  for (const face of FACES) {
    if (hollow.sides[face] !== 'open') walls.push(faceBox(face, -0.5, 0.5, 0.5 - WALL_T, 0.5, -0.5, 0.5));
  }
  for (const { dx, dz, corner } of CELL_CORNERS) {
    if (hollow.pillars[corner]) {
      walls.push(faceBox('front', dx * (0.5 - WALL_T), dx * 0.5, dz * (0.5 - WALL_T), dz * 0.5, -0.5, 0.5));
    }
    const r = ctx.radii[corner];
    if (r > WALL_T + 0.01) walls.push(...roundedCorner(dx, dz, r));
  }
  // Porte : son passage, du plancher au linteau, à travers le mur et le remplissage des coins.
  if (ctx.doorFace && cell.type === BlockType.WallWithWindow) {
    const face = ctx.doorFace;
    const scale = openingScale(ctx.radii, face, 'door');
    const door = OPENING_SIZES.door;
    const half = (door.w * scale) / 2;
    const cut = faceBox(face, -half, half, DOOR_CUT_DEPTH, 0.5 + 1e-3, STAIR_FLOOR_Y, door.y + door.h / 2);
    walls = walls.flatMap((box) => subtractBox(box, cut));
    for (const { top, height, near, run, width } of doorSteps(ctx, face, scale)) {
      boxes.push(faceBox(face, -width / 2, width / 2, near, near + run, top - height, top));
    }
  }
  boxes.push(...walls);

  if (ctx.stair?.kind === 'L') boxes.push(...lStairBoxes(ctx.stair));
  else if (ctx.stair?.kind === 'spiral') boxes.push(...spiralBoxes(ctx.stair));
  if (ctx.stairBelow && ctx.stairBelow.kind !== 'ladder') {
    boxes.push(...railingBoxes(ctx.stairBelow.opening, STAIR_FLOOR_Y));
  }
  return boxes;
}
