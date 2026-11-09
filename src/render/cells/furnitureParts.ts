/**
 * Mobilier procédural des pièces, vu depuis la rue par les fenêtres.
 *
 * Par cellule creuse, de façon déterministe (hash des coordonnées) :
 *  - au centre de la cellule qui porte le chandelier de la pièce : une table
 *    et ses bancs au rez-de-chaussée, un tapis à l'étage ;
 *  - contre les murs (côtés `exterior` / `partition`, jamais `open`), un
 *    emplacement par coin : coffre, buffet, tonneaux (rez-de-chaussée), lit
 *    (étage) — ou rien, pour ne pas encombrer.
 *
 * Contraintes : rien contre le mur d'une porte ; sous une fenêtre ou une
 * meurtrière, seulement des meubles plus bas que l'appui (`LOW_MAX_H`) ;
 * un meuble par coin (un lit, qui traverse la pièce, en prend deux) ; pas de
 * meuble mural dans un coin arrondi de tour (il traverserait la courbe).
 * Tout reste dans la cavité de la coque (testé dans buildVillage.test.ts).
 *
 * Échelle : la porte (0,71) fait ~2 m, donc 1 unité ≈ 2,8 m. Uniquement des
 * boîtes et des cylindres à 8 segments : ~24 sommets par boîte soudée.
 */

import type { CellFace } from '../../utils/cellUtils';
import { FACE_ROTATION_Y, getColumnTop, isGableRoofCell } from '../../utils/cellUtils';
import { varyColorBrightness } from '../../colorPalettes';
import { boxGeo, cylinderGeo, FLOOR_T, OPENING_SIZES, WALL_T, type OpeningSpec } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import type { GridCell } from '../../types';
import type { RoomLamp } from '../../utils/roomLamps';
import type { CellContext } from './context';
import { lampZones, openingKindsOf } from './openings';

const FURNITURE_WOOD = '#7a5232';
const LIGHT_WOOD = '#9c7449';
const IRON = '#2f2b28';
const LINEN = '#e6dcc6';
const BLANKETS = ['#8c2f2f', '#2f4f8c', '#3f6b3a', '#b08a3c'];
const RUGS = ['#7d2a2a', '#3a4a7a', '#6b5a2a'];
const WOOD_MAT = { roughness: 0.85 };
const CLOTH_MAT = { roughness: 1 };
const IRON_MAT = { roughness: 0.6, metalness: 0.4 };

/** Dessus du parquet (interiorParts : dalle FLOOR_T + lames 8 mm). */
const FLOOR_Y = -0.5 + FLOOR_T + 0.008;
/** Nu intérieur des murs. */
const INNER = 0.5 - WALL_T;
/** Hauteur maximale d'un meuble sous une fenêtre : appui à `y - h/2` de l'ouverture, moins une marge. */
const LOW_MAX_H = OPENING_SIZES.window.y - OPENING_SIZES.window.h / 2 - FLOOR_Y - 0.02;
/** Décalage le long du mur des deux emplacements (un par coin). */
const SLOT_OFFSET = 0.2;
/** Jeu entre le dos d'un meuble et le mur : couvre les débords (couvercle, ferrures) de ~6 mm. */
const WALL_GAP = 0.012;
/** Hotte : profondeur depuis le mur, largeur. */
const HOOD_D = 0.09;
const HOOD_W = 0.28;
/** Distance, depuis le nu intérieur du mur, à laquelle la hotte s'arrête : une poutre qui aboutit à ce mur s'arrête là. */
export const HOOD_REACH = WALL_GAP + HOOD_D;
/** Distance du centre de la cellule à l'axe de la hotte (et du conduit qui sort du toit). */
export const FLUE_OFFSET = INNER - WALL_GAP - HOOD_D / 2;
/** Sous-face du plafond enduit (interiorParts : `0.5 − FLOOR_T − CEILING_T`). */
const CEILING_BOTTOM_Y = 0.5 - FLOOR_T - 0.006;

type Corner = 'backLeft' | 'backRight' | 'frontLeft' | 'frontRight';

/** Un meuble : ses parts (repère local, dos contre le mur en +z, posé sur y = 0) et son encombrement. */
interface Piece {
  parts: Part[];
  /** Profondeur depuis le mur. */
  depth: number;
  height: number;
}

function hashOf(x: number, y: number, z: number, salt: number): number {
  return Math.abs(
    Math.imul(x + salt, 73856093) ^ Math.imul(y + 3 * salt, 19349663) ^ Math.imul(z + 7 * salt, 83492791),
  );
}

const box = (w: number, h: number, d: number, color: string, mat: Part['mat'], pos: [number, number, number]) =>
  part(boxGeo(w, h, d), color, mat, xform(pos));

// ── Meubles ───────────────────────────────────────────────────────────────

function chest(shade: number): Piece {
  const w = 0.26;
  const d = 0.13;
  const h = 0.14;
  const wood = varyColorBrightness(FURNITURE_WOOD, shade);
  return {
    depth: d,
    height: h,
    parts: [
      box(w, h - 0.025, d, wood, WOOD_MAT, [0, (h - 0.025) / 2, 0]),
      box(w + 0.01, 0.025, d + 0.01, varyColorBrightness(wood, 0.06), WOOD_MAT, [0, h - 0.0125, 0]),
      box(0.012, h - 0.01, d + 0.012, IRON, IRON_MAT, [-w / 2 + 0.04, (h - 0.01) / 2, 0]),
      box(0.012, h - 0.01, d + 0.012, IRON, IRON_MAT, [w / 2 - 0.04, (h - 0.01) / 2, 0]),
    ],
  };
}

function cupboard(shade: number): Piece {
  const w = 0.26;
  const d = 0.12;
  const h = 0.5;
  const wood = varyColorBrightness(LIGHT_WOOD, shade);
  return {
    depth: d,
    height: h,
    parts: [
      box(w, h, d, wood, WOOD_MAT, [0, h / 2, 0]),
      // Corniche : déborde vers l'avant (-z), jamais dans le mur.
      box(w + 0.02, 0.025, d + 0.015, varyColorBrightness(wood, -0.1), WOOD_MAT, [0, h + 0.0125, -0.0075]),
      // Deux portes, séparées par un montant sombre.
      box(0.01, h - 0.06, 0.006, varyColorBrightness(wood, -0.3), WOOD_MAT, [0, h / 2, -d / 2 - 0.003]),
      box(w - 0.04, 0.01, 0.006, varyColorBrightness(wood, -0.3), WOOD_MAT, [0, h * 0.35, -d / 2 - 0.003]),
    ],
  };
}

function barrels(): Piece {
  const r = 0.06;
  const h = 0.18;
  const parts: Part[] = [];
  for (const [x, z] of [
    [-0.065, 0],
    [0.065, 0],
  ] as const) {
    parts.push(part(cylinderGeo(r, r, h, 8), FURNITURE_WOOD, WOOD_MAT, xform([x, h / 2, z])));
    for (const y of [0.035, h - 0.035]) {
      parts.push(part(cylinderGeo(r + 0.004, r + 0.004, 0.012, 8), IRON, IRON_MAT, xform([x, y, z])));
    }
  }
  return { depth: 2 * r + 0.01, height: h, parts };
}

function bed(blanket: string): Piece {
  const w = 0.26;
  const length = 0.6;
  const frameH = 0.08;
  return {
    depth: length,
    height: 0.2,
    parts: [
      box(w, frameH, length, FURNITURE_WOOD, WOOD_MAT, [0, frameH / 2, 0]),
      // Tête de lit contre le mur.
      box(w + 0.02, 0.2, 0.025, varyColorBrightness(FURNITURE_WOOD, -0.1), WOOD_MAT, [0, 0.1, length / 2 - 0.0125]),
      box(w - 0.02, 0.03, 0.08, LINEN, CLOTH_MAT, [0, frameH + 0.015, length / 2 - 0.07]),
      box(w + 0.006, 0.035, length - 0.14, blanket, CLOTH_MAT, [0, frameH + 0.0175, -0.06]),
    ],
  };
}

const BOOK_COLORS = ['#7d2a2a', '#2a4a6b', '#3f5a2a', '#6b4a1f', '#4a2a5a', '#b08a3c'];
const POTTERY = '#a8643a';

/** Étagère garnie : trois planches, quelques livres et un pot (choisis par `seed`). */
function shelves(seed: number): Piece {
  const w = 0.26;
  const d = 0.08;
  const h = 0.46;
  const parts: Part[] = [
    box(0.015, h, d, FURNITURE_WOOD, WOOD_MAT, [-w / 2 + 0.0075, h / 2, 0]),
    box(0.015, h, d, FURNITURE_WOOD, WOOD_MAT, [w / 2 - 0.0075, h / 2, 0]),
  ];
  const boards = [0.02, 0.17, 0.32, h - 0.006];
  for (const y of boards) parts.push(box(w - 0.03, 0.012, d, LIGHT_WOOD, WOOD_MAT, [0, y, 0]));
  // Garniture des trois rayons du bas : livres serrés à gauche ou à droite, un pot parfois.
  for (let shelf = 0; shelf < 3; shelf += 1) {
    const s = (seed >> (shelf * 3)) & 7;
    if (s === 0) continue;
    const baseY = boards[shelf] + 0.006;
    const dir = s & 1 ? 1 : -1;
    const books = 2 + (s % 3);
    for (let b = 0; b < books; b += 1) {
      const bh = 0.08 + ((s + b) % 3) * 0.015;
      parts.push(
        box(0.022, bh, d - 0.02, BOOK_COLORS[(s + b * 2) % BOOK_COLORS.length], CLOTH_MAT, [
          dir * (w / 2 - 0.04 - b * 0.025),
          baseY + bh / 2,
          0,
        ]),
      );
    }
    if (s > 4) {
      parts.push(
        part(
          cylinderGeo(0.022, 0.018, 0.06, 8),
          POTTERY,
          { roughness: 0.9 },
          xform([-dir * (w / 2 - 0.06), baseY + 0.03, 0]),
        ),
      );
    }
  }
  return { depth: d, height: h, parts };
}

/** Établi : plateau épais, tablette basse, un outil et un pot posés dessus. */
function workbench(seed: number): Piece {
  const w = 0.3;
  const d = 0.13;
  const top = 0.3;
  const parts: Part[] = [box(w, 0.025, d, LIGHT_WOOD, WOOD_MAT, [0, top - 0.0125, 0])];
  for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) {
    for (const z of [-d / 2 + 0.02, d / 2 - 0.02])
      parts.push(box(0.025, top - 0.025, 0.025, FURNITURE_WOOD, WOOD_MAT, [x, (top - 0.025) / 2, z]));
  }
  parts.push(box(w - 0.04, 0.012, d - 0.03, FURNITURE_WOOD, WOOD_MAT, [0, 0.07, 0]));
  const side = seed & 1 ? 1 : -1;
  // Maillet (manche + tête) et pot.
  parts.push(box(0.09, 0.012, 0.012, FURNITURE_WOOD, WOOD_MAT, [side * 0.06, top + 0.006, -0.02]));
  parts.push(box(0.03, 0.03, 0.035, IRON, IRON_MAT, [side * 0.1, top + 0.015, -0.02]));
  parts.push(
    part(cylinderGeo(0.02, 0.02, 0.05, 8), POTTERY, { roughness: 0.9 }, xform([-side * 0.09, top + 0.025, 0.02])),
  );
  return { depth: d, height: top + 0.03, parts };
}

/**
 * Cheminée centrée sur son mur : jambages et manteau de pierre, foyer sombre,
 * bûches et braises (groupe "glow" : elles rougeoient le soir), âtre en
 * avant, hotte jusqu'au plafond (`ceilingTop`, hauteur locale).
 */
function fireplace(stone: string, ceilingTop: number): Piece {
  const bodyD = 0.12;
  const hearthD = 0.06;
  const depth = bodyD + hearthD;
  const bodyZ = depth / 2 - bodyD / 2; // corps contre le mur (+z)
  const openingH = 0.2;
  const mantelY = openingH + 0.015;
  const dark = varyColorBrightness(stone, -0.35);
  const parts: Part[] = [
    // Jambages, fond du foyer, manteau.
    box(0.06, openingH, bodyD, stone, WOOD_MAT, [-0.13, openingH / 2, bodyZ]),
    box(0.06, openingH, bodyD, stone, WOOD_MAT, [0.13, openingH / 2, bodyZ]),
    box(0.2, openingH, 0.02, '#1c1714', CLOTH_MAT, [0, openingH / 2, depth / 2 - 0.01]),
    box(0.36, 0.03, bodyD + 0.02, dark, WOOD_MAT, [0, mantelY, bodyZ - 0.01]),
    // Hotte jusqu'au plafond.
    box(HOOD_W, ceilingTop - mantelY - 0.015, HOOD_D, stone, WOOD_MAT, [
      0,
      (ceilingTop + mantelY + 0.015) / 2,
      depth / 2 - HOOD_D / 2,
    ]),
    // Âtre devant le foyer.
    box(0.36, 0.012, hearthD, dark, WOOD_MAT, [0, 0.006, -depth / 2 + hearthD / 2]),
    // Braises (s'allument le soir avec les fenêtres), bûches croisées.
    box(0.13, 0.02, 0.06, '#3a1f12', { roughness: 1, glow: true }, [0, 0.01, bodyZ - 0.005]),
  ];
  for (const angle of [0.35, -0.35]) {
    parts.push(
      part(
        cylinderGeo(0.013, 0.013, 0.15, 8),
        '#4a3220',
        WOOD_MAT,
        xform([0, 0.033, bodyZ - 0.005], [0, angle, Math.PI / 2]),
      ),
    );
  }
  return { depth, height: ceilingTop, parts };
}

/** Table et deux bancs, centrés sur la cellule, long côté selon X. */
function diningSet(): Part[] {
  const top = 0.27;
  const parts: Part[] = [box(0.38, 0.025, 0.22, LIGHT_WOOD, WOOD_MAT, [0, top - 0.0125, 0])];
  for (const x of [-0.16, 0.16]) {
    for (const z of [-0.08, 0.08])
      parts.push(box(0.025, top - 0.025, 0.025, FURNITURE_WOOD, WOOD_MAT, [x, (top - 0.025) / 2, z]));
  }
  const seat = 0.15;
  for (const z of [-0.18, 0.18]) {
    parts.push(box(0.32, 0.02, 0.06, LIGHT_WOOD, WOOD_MAT, [0, seat - 0.01, z]));
    for (const x of [-0.13, 0.13])
      parts.push(box(0.02, seat - 0.02, 0.05, FURNITURE_WOOD, WOOD_MAT, [x, (seat - 0.02) / 2, z]));
  }
  return parts;
}

function rug(color: string): Part[] {
  return [
    box(0.44, 0.004, 0.3, color, CLOTH_MAT, [0, 0.002, 0]),
    box(0.36, 0.0045, 0.22, varyColorBrightness(color, 0.15), CLOTH_MAT, [0, 0.00225, 0]),
  ];
}

// ── Placement ─────────────────────────────────────────────────────────────

/** Coin (repère de la cellule) atteint en partant de la face `face` vers le côté `side` (±1, repère de la face). */
function cornerOf(face: CellFace, side: number, towardsWall: boolean): Corner {
  const angle = FACE_ROTATION_Y[face];
  const lx = side;
  const lz = towardsWall ? 1 : -1;
  const x = lx * Math.cos(angle) + lz * Math.sin(angle);
  const z = -lx * Math.sin(angle) + lz * Math.cos(angle);
  return `${z > 0 ? 'front' : 'back'}${x > 0 ? 'Right' : 'Left'}` as Corner;
}

/** Part de pièces (zone d'un chandelier) qui reçoivent une cheminée. */
const FIREPLACE_CHANCE = { ground: 90, upper: 50 };

/**
 * Cheminées : une au plus par zone de chandelier (voir assignRoomLamps),
 * décidée avant la construction des murs, car elle peut prendre la place
 * d'une fenêtre. Au rez-de-chaussée, toute face extérieure a une porte ou
 * une fenêtre : en n'acceptant que des murs déjà aveugles, aucune pièce du
 * rez-de-chaussée n'avait de cheminée.
 *
 * Mur retenu, dans la cellule la plus proche du chandelier : jamais un côté
 * ouvert, une porte, une meurtrière ni un coin arrondi ; aveugle de
 * préférence, sinon une fenêtre qu'on supprime — à condition que la pièce en
 * garde une autre, pour la voir depuis la rue (une cellule du pourtour d'un
 * bloc n'a souvent qu'une face extérieure). La colonne doit finir par un toit
 * à deux pans : le conduit y sort, à l'aplomb de la hotte (`FLUE_OFFSET`,
 * voir roofCellParts). Si la poutre aboutit à ce mur, elle s'arrête contre la
 * hotte (interiorParts, `HOOD_REACH`). Les premières versions n'acceptaient
 * que les murs parallèles à la poutre : une rangée d'une case de large n'avait
 * alors que ses deux murs pignons, presque toujours percés.
 */
export function planFireplaces(contexts: CellContext[], lamps: Map<GridCell, RoomLamp>): Map<GridCell, CellFace> {
  const plan = new Map<GridCell, CellFace>();
  for (const zone of lampZones(contexts, lamps).values()) {
    // Une tour (pièce d'une case) garde son pourtour dégagé.
    if (zone[0].isIsolated) continue;
    const { cell: first } = zone[0];
    const lamp = lamps.get(first)!;
    const hx = first.x + lamp.dx;
    const hz = first.z + lamp.dz;
    const chance = first.y === 0 ? FIREPLACE_CHANCE.ground : FIREPLACE_CHANCE.upper;
    if (hashOf(hx, first.y, hz, 40) % 100 >= chance) continue;

    const byDistance = [...zone].sort(
      (a, b) =>
        Math.hypot(a.cell.x - hx, a.cell.z - hz) - Math.hypot(b.cell.x - hx, b.cell.z - hz) ||
        a.cell.x - b.cell.x ||
        a.cell.z - b.cell.z,
    );

    // Fenêtres de toute la pièce : on peut en sacrifier une s'il en reste une autre.
    const kindsOf = new Map(zone.map((ctx) => [ctx, openingKindsOf(ctx)]));
    const windows = [...kindsOf.values()].reduce(
      (sum, kinds) => sum + [...kinds.values()].filter((kind) => kind === 'window').length,
      0,
    );

    let best: { ctx: CellContext; face: CellFace; rank: number } | null = null;
    for (const [order, ctx] of byDistance.entries()) {
      const { hollow, radii, cell, lookup } = ctx;
      if (!isGableRoofCell(lookup, getColumnTop(lookup, cell))) continue;
      const kinds = kindsOf.get(ctx)!;
      const faces: CellFace[] = ['front', 'back', 'left', 'right'];
      if (hashOf(cell.x, cell.y, cell.z, 41) % 2) faces.reverse();
      for (const face of faces) {
        if (hollow!.sides[face] === 'open') continue;
        if ([1, -1].some((side) => radii[cornerOf(face, side, true)] > WALL_T + 0.02)) continue;
        const kind = kinds.get(face);
        if (kind === 'door' || kind === 'slit' || (kind === 'window' && windows < 2)) continue;
        // Mur aveugle d'abord (rang 0), fenêtre ensuite ; puis la cellule la plus proche du chandelier.
        const rank = (kind ? 1000 : 0) + order;
        if (!best || rank < best.rank) best = { ctx, face, rank };
      }
    }
    if (best) plan.set(best.ctx.cell, best.face);
  }
  return plan;
}

export function furnitureParts(ctx: CellContext, openings: OpeningSpec[]): Part[] {
  const { cell, hollow, radii, isIsolated } = ctx;
  if (!hollow) return [];

  const parts: Part[] = [];
  const ground = cell.y === 0;
  const h = hashOf(cell.x, cell.y, cell.z, 0);
  const place = (pieceParts: Part[], matrix: ReturnType<typeof xform>) => {
    for (const p of pieceParts) parts.push({ ...p, matrix: mul(matrix, p.matrix) });
  };

  // Centre : sous le chandelier de la pièce.
  if (ctx.chandelier) {
    const centre = xform([0, FLOOR_Y, 0], [0, h % 2 === 0 ? 0 : Math.PI / 2, 0]);
    place(ground ? diningSet() : rug(RUGS[h % RUGS.length]), centre);
  }

  // Murs : une tour garde son pourtour dégagé (coins arrondis, meurtrières).
  if (isIsolated) return parts;

  const used = new Set<Corner>();
  const isRounded = (corner: Corner) => radii[corner] > WALL_T + 0.02;

  // Cheminée de la pièce, si planFireplaces l'a placée dans cette cellule.
  if (ctx.fireplaceFace) {
    const face = ctx.fireplaceFace;
    const stone = varyColorBrightness(ctx.settings.wallBaseColor, -0.18);
    const piece = fireplace(stone, CEILING_BOTTOM_Y - FLOOR_Y - 0.002);
    const faceRot = xform([0, 0, 0], [0, FACE_ROTATION_Y[face], 0]);
    place(piece.parts, mul(faceRot, xform([0, FLOOR_Y, INNER - piece.depth / 2 - WALL_GAP])));
    used.add(cornerOf(face, 1, true));
    used.add(cornerOf(face, -1, true));
  }

  let hasBed = false;
  const faces: CellFace[] = ['front', 'right', 'back', 'left'];
  const start = h % 4;
  for (let i = 0; i < 4; i += 1) {
    const face = faces[(start + i) % 4];
    if (hollow.sides[face] === 'open') continue;
    const opening = openings.find((o) => o.face === face);
    if (opening?.kind === 'door') continue;

    for (const side of h & (1 << i) ? [1, -1] : [-1, 1]) {
      const near = cornerOf(face, side, true);
      if (used.has(near) || isRounded(near)) continue;

      const slotSeed = hashOf(cell.x, cell.y, cell.z, 1 + i * 2 + (side > 0 ? 1 : 0));
      const roll = slotSeed % 10;
      const shade = ((roll % 5) - 2) * 0.03;
      const variant = slotSeed >> 4;
      let piece: Piece | null = null;
      if (opening) {
        // Sous une fenêtre : meubles bas seulement.
        if (roll < 4) piece = ground && roll < 2 ? barrels() : chest(shade);
      } else if (ground) {
        if (roll < 2) piece = cupboard(shade);
        else if (roll < 3) piece = barrels();
        else if (roll < 4) piece = chest(shade);
        else if (roll < 5) piece = shelves(variant);
        else if (roll < 7) piece = workbench(variant);
      } else if (!hasBed && roll < 5) {
        piece = bed(BLANKETS[roll % BLANKETS.length]);
      } else if (roll < 8) {
        piece = roll % 3 === 0 ? cupboard(shade) : roll % 3 === 1 ? chest(shade) : shelves(variant);
      }
      if (!piece || (opening && piece.height > LOW_MAX_H)) continue;

      // Un lit traverse la pièce : il prend aussi le coin opposé de ce côté.
      const far = cornerOf(face, side, false);
      if (piece.depth > 0.3) {
        if (used.has(far) || radii[far] > WALL_T + 0.02) continue;
        used.add(far);
        hasBed = true;
      }
      used.add(near);

      const faceRot = xform([0, 0, 0], [0, FACE_ROTATION_Y[face], 0]);
      place(piece.parts, mul(faceRot, xform([side * SLOT_OFFSET, FLOOR_Y, INNER - piece.depth / 2 - WALL_GAP])));
    }
  }

  return parts;
}
