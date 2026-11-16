/**
 * Décor du village : de quoi meubler l'herbe laissée libre entre et autour
 * des bâtiments — un puits en pierre dans chaque cour fermée, et alentour
 * charrettes, meules de foin, tas de bûches, tonneaux et caisses, buissons
 * et petits arbres.
 *
 * Purement décoratif et entièrement dérivé de la grille (hash des
 * coordonnées, jamais Math.random) : bâtir sur une case fait disparaître
 * son objet, comme les pavés. Rien n'est jamais posé sur une case bâtie ou
 * pavée (la rue reste libre), ni loin du village (l'herbe y reste nue, pour
 * laisser la place de construire sans fouillis).
 *
 * Les clics ne voient pas ces objets : ils passent par le plan invisible et
 * la grille de voxels (voxelRaycast.ts).
 */

import * as THREE from 'three';
import { varyColorBrightness } from '../../colorPalettes';
import type { CellLookup } from '../../utils/cellUtils';
import { boxGeo, cylinderGeo, roundedBoxGeo, sphereGeo, torusArcGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import type { RenderSettings } from '../renderSettings';
import { isGrassCell, pavedCells } from './pavingParts';
import { slopeAt, type HeightFn } from './drape';

/** Distance (Chebyshev, en cases) au pavage en deçà de laquelle l'herbe peut recevoir un objet. */
const PROP_REACH = 2;
/** Part des cases d'herbe éligibles qui reçoivent un objet. */
const PROP_DENSITY = 0.34;
/**
 * Terrain en pente : les objets restent d'aplomb, posés à la hauteur du sol
 * sous leur centre et enfoncés de ce que la pente fait perdre à ce rayon —
 * leur côté aval ne flotte pas.
 */
const PROP_FOOT = 0.14;

const WOOD = '#7a5a3c';
const WOOD_DARK = '#5a4230';
const WOOD_LIGHT = '#a07c52';
const IRON = '#2f2b28';
const HAY = '#c9a650';
const LEAVES = ['#5d8239', '#6a9440', '#4f7634'];
const WOOD_MAT = { roughness: 0.9 };
const IRON_MAT = { roughness: 0.55, metalness: 0.5 };
const LEAF_MAT = { roughness: 0.95 };

/** Hash entier → [0, 1), stable. */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const key = (x: number, z: number) => `${x},${z}`;

/** Cylindre couché le long de z. */
const LYING = new THREE.Matrix4().makeRotationX(Math.PI / 2);

// ── Objets (repère local : posés sur y = 0, centrés) ─────────────────────────

/**
 * Puits : margelle ronde montée en trois assises de pierres (teinte des
 * murs), eau sombre au fond, deux poteaux, un treuil, un seau au bout de sa
 * corde, et un petit toit à deux pans couvert comme les maisons.
 */
function well(settings: RenderSettings): Part[] {
  const parts: Part[] = [];
  const stone = varyColorBrightness(settings.wallBaseColor, -0.08);
  const radius = 0.19;
  const stones = 10;
  const courseH = 0.072;
  const blockGeo = roundedBoxGeo(
    +(((2 * Math.PI * radius) / stones) * 0.94).toFixed(3),
    courseH - 0.006,
    0.07,
    0.012,
    2,
  );
  for (let course = 0; course < 3; course += 1) {
    for (let i = 0; i < stones; i += 1) {
      // Joints décalés d'une assise à l'autre.
      const angle = ((i + (course % 2) * 0.5) / stones) * Math.PI * 2;
      parts.push(
        part(
          blockGeo,
          varyColorBrightness(stone, ((i * 5 + course * 3) % 5) * 0.035 - 0.07),
          { roughness: 0.9 },
          xform([Math.sin(angle) * radius, courseH * (course + 0.5), Math.cos(angle) * radius], [0, angle, 0]),
        ),
      );
    }
  }
  parts.push(
    // Cœur de maçonnerie sombre, puis l'eau.
    part(
      cylinderGeo(radius - 0.02, radius - 0.02, 0.1, 14),
      varyColorBrightness(stone, -0.45),
      { roughness: 1 },
      xform([0, 0.05, 0]),
    ),
    part(
      cylinderGeo(radius - 0.03, radius - 0.03, 0.008, 14),
      '#27404d',
      { roughness: 0.15, metalness: 0.1 },
      xform([0, 0.104, 0]),
    ),
  );
  // Poteaux, treuil et manivelle.
  for (const x of [-radius, radius]) {
    parts.push(part(boxGeo(0.034, 0.5, 0.034), WOOD_DARK, WOOD_MAT, xform([x, 0.25, 0])));
  }
  parts.push(
    part(cylinderGeo(0.02, 0.02, radius * 2 + 0.08, 8), WOOD, WOOD_MAT, xform([0, 0.4, 0], [0, 0, Math.PI / 2])),
    part(boxGeo(0.008, 0.07, 0.008), IRON, IRON_MAT, xform([radius + 0.045, 0.37, 0])),
    // Corde et seau.
    part(boxGeo(0.006, 0.13, 0.006), '#b9a37a', { roughness: 1 }, xform([0.03, 0.335, 0])),
    part(cylinderGeo(0.036, 0.028, 0.055, 8), WOOD_LIGHT, WOOD_MAT, xform([0.03, 0.245, 0])),
    part(cylinderGeo(0.037, 0.037, 0.008, 8), IRON, IRON_MAT, xform([0.03, 0.262, 0])),
  );
  // Toit : deux pans (faîtage le long de x), teinte des toits du village.
  const roof = varyColorBrightness(settings.roofBaseColor, -0.06);
  for (const side of [1, -1]) {
    parts.push(
      part(
        boxGeo(radius * 2 + 0.16, 0.018, 0.2),
        side > 0 ? roof : varyColorBrightness(roof, 0.07),
        { roughness: 0.86 },
        xform([0, 0.545, side * 0.075], [side * 0.62, 0, 0]),
      ),
    );
  }
  parts.push(
    part(
      boxGeo(radius * 2 + 0.18, 0.022, 0.03),
      varyColorBrightness(roof, -0.18),
      { roughness: 0.88 },
      xform([0, 0.602, 0]),
    ),
  );
  return parts;
}

/** Charrette à bras : plateau, ridelles, deux roues cerclées, brancards, et un chargement de foin ou de sacs. */
function cart(seed: number): Part[] {
  const bedY = 0.15;
  const parts: Part[] = [
    part(boxGeo(0.36, 0.022, 0.2), WOOD, WOOD_MAT, xform([0, bedY, 0])),
    part(boxGeo(0.36, 0.06, 0.012), WOOD_DARK, WOOD_MAT, xform([0, bedY + 0.04, 0.094])),
    part(boxGeo(0.36, 0.06, 0.012), WOOD_DARK, WOOD_MAT, xform([0, bedY + 0.04, -0.094])),
    part(boxGeo(0.012, 0.06, 0.2), WOOD_DARK, WOOD_MAT, xform([-0.174, bedY + 0.04, 0])),
    // Essieu.
    part(cylinderGeo(0.012, 0.012, 0.27, 6), IRON, IRON_MAT, mul(xform([0.02, 0.1, 0]), LYING)),
  ];
  for (const z of [0.128, -0.128]) {
    parts.push(
      part(cylinderGeo(0.1, 0.1, 0.022, 12), WOOD_DARK, WOOD_MAT, mul(xform([0.02, 0.1, z]), LYING)),
      part(cylinderGeo(0.104, 0.104, 0.012, 12), IRON, IRON_MAT, mul(xform([0.02, 0.1, z]), LYING)),
      part(cylinderGeo(0.022, 0.022, 0.03, 8), WOOD_LIGHT, WOOD_MAT, mul(xform([0.02, 0.1, z]), LYING)),
      // Brancards, qui reposent au sol devant.
      part(boxGeo(0.26, 0.016, 0.016), WOOD, WOOD_MAT, xform([0.29, 0.085, z * 0.62], [0, 0, -0.5])),
    );
  }
  if (seed % 2 === 0) {
    parts.push(part(roundedBoxGeo(0.3, 0.11, 0.16, 0.04, 2), HAY, { roughness: 1 }, xform([-0.01, bedY + 0.066, 0])));
  } else {
    for (const [x, z, tone] of [
      [-0.09, 0.03, 0],
      [0.03, -0.03, -0.06],
      [0.1, 0.04, 0.05],
    ] as const) {
      parts.push(
        part(
          roundedBoxGeo(0.1, 0.07, 0.085, 0.03, 2),
          varyColorBrightness('#b8a888', tone),
          { roughness: 1 },
          xform([x, bedY + 0.046, z]),
        ),
      );
    }
  }
  return parts;
}

/** Meule : bottes de foin rondes, deux au sol et une dessus, et une fourche plantée. */
function hay(): Part[] {
  const bale = cylinderGeo(0.085, 0.085, 0.17, 10);
  return [
    part(bale, HAY, { roughness: 1 }, mul(xform([-0.09, 0.085, 0]), LYING)),
    part(bale, varyColorBrightness(HAY, -0.07), { roughness: 1 }, mul(xform([0.09, 0.085, 0.01]), LYING)),
    part(bale, varyColorBrightness(HAY, 0.05), { roughness: 1 }, mul(xform([0, 0.232, 0]), LYING)),
    // Fourche.
    part(boxGeo(0.012, 0.36, 0.012), WOOD_LIGHT, WOOD_MAT, xform([0.2, 0.17, -0.08], [0.12, 0, -0.2])),
    part(boxGeo(0.05, 0.008, 0.008), IRON, IRON_MAT, xform([0.236, 0.345, -0.1])),
  ];
}

/** Tas de bûches (3 – 2 – 1) et billot, la hache plantée dedans. */
function logs(): Part[] {
  const log = cylinderGeo(0.036, 0.036, 0.3, 8);
  const parts: Part[] = [];
  const rows = [3, 2, 1];
  rows.forEach((count, row) => {
    for (let i = 0; i < count; i += 1) {
      parts.push(
        part(
          log,
          varyColorBrightness(WOOD, ((i + row) % 3) * 0.06 - 0.06),
          WOOD_MAT,
          mul(xform([-0.1 + (i - (count - 1) / 2) * 0.074, 0.036 + row * 0.063, 0]), LYING),
        ),
      );
    }
  });
  parts.push(
    part(cylinderGeo(0.065, 0.07, 0.1, 10), WOOD_LIGHT, WOOD_MAT, xform([0.16, 0.05, 0.03])),
    part(boxGeo(0.012, 0.2, 0.012), WOOD_DARK, WOOD_MAT, xform([0.185, 0.17, 0.03], [0, 0, -0.5])),
    part(boxGeo(0.05, 0.045, 0.012), IRON, IRON_MAT, xform([0.15, 0.115, 0.03], [0, 0, -0.5])),
  );
  return parts;
}

/** Tonneaux cerclés, caisses et un sac. */
function barrels(seed: number): Part[] {
  const parts: Part[] = [];
  const barrel = (x: number, z: number, tone: number) => {
    parts.push(
      part(cylinderGeo(0.062, 0.058, 0.18, 10), varyColorBrightness(WOOD, tone), WOOD_MAT, xform([x, 0.09, z])),
    );
    for (const y of [0.04, 0.14]) {
      parts.push(part(cylinderGeo(0.066, 0.066, 0.012, 10), IRON, IRON_MAT, xform([x, y, z])));
    }
  };
  barrel(-0.11, -0.05, 0);
  barrel(0.03, -0.1, -0.08);
  const crate = (x: number, y: number, z: number, turn: number) => {
    const m = xform([x, y, z], [0, turn, 0]);
    parts.push(
      part(boxGeo(0.13, 0.11, 0.13), WOOD_LIGHT, WOOD_MAT, m),
      part(boxGeo(0.136, 0.02, 0.136), WOOD, WOOD_MAT, mul(m, xform([0, 0.045, 0]))),
      part(boxGeo(0.136, 0.02, 0.136), WOOD, WOOD_MAT, mul(m, xform([0, -0.045, 0]))),
    );
  };
  crate(0.1, 0.055, 0.09, 0.3);
  if (seed % 2 === 0) crate(0.09, 0.165, 0.085, -0.2);
  parts.push(
    part(
      roundedBoxGeo(0.11, 0.075, 0.09, 0.03, 2),
      '#b8a888',
      { roughness: 1 },
      xform([-0.08, 0.036, 0.11], [0, 0.5, 0]),
    ),
  );
  return parts;
}

/** Massif de buissons : trois masses de feuillage, aplaties. */
function bushes(seed: number): Part[] {
  const blob = sphereGeo(0.1, 8, 6);
  return [
    [-0.09, 0.02, 1.15],
    [0.07, -0.05, 0.9],
    [0.02, 0.1, 0.75],
  ].map(([x, z, scale], i) =>
    part(
      blob,
      LEAVES[(seed + i) % LEAVES.length],
      LEAF_MAT,
      xform([x, 0.065 * scale, z], [0, 0, 0], [scale, scale * 0.8, scale]),
    ),
  );
}

/** Petit arbre fruitier : tronc et houppier en trois masses. */
function tree(seed: number): Part[] {
  const blob = sphereGeo(0.16, 8, 6);
  const parts: Part[] = [part(cylinderGeo(0.028, 0.045, 0.42, 7), WOOD_DARK, WOOD_MAT, xform([0, 0.21, 0]))];
  for (const [i, [x, y, z, scale]] of [
    [0, 0.56, 0, 1.15],
    [0.12, 0.47, 0.05, 0.8],
    [-0.1, 0.5, -0.07, 0.85],
  ].entries()) {
    parts.push(
      part(
        blob,
        LEAVES[(seed + i) % LEAVES.length],
        LEAF_MAT,
        xform([x, y, z], [0, 0, 0], [scale, scale * 0.9, scale]),
      ),
    );
  }
  return parts;
}

/** Banc de pierre et son anneau d'attache (pour les abords des rues). */
function trough(settings: RenderSettings): Part[] {
  const stone = varyColorBrightness(settings.wallBaseColor, -0.14);
  return [
    // Abreuvoir : auge de pierre, eau à fleur.
    part(roundedBoxGeo(0.36, 0.12, 0.17, 0.02, 2), stone, { roughness: 0.92 }, xform([0, 0.06, 0])),
    part(boxGeo(0.31, 0.01, 0.12), '#27404d', { roughness: 0.15, metalness: 0.1 }, xform([0, 0.122, 0])),
    // Poteau d'attache et son anneau.
    part(boxGeo(0.03, 0.26, 0.03), WOOD_DARK, WOOD_MAT, xform([0.25, 0.13, 0])),
    part(torusArcGeo(0.022, 0.005, 5, 10, Math.PI * 2), IRON, IRON_MAT, xform([0.25, 0.2, 0.02])),
  ];
}

// ── Placement ────────────────────────────────────────────────────────────────

/**
 * Cases qui reçoivent un puits : la case la plus centrale de chaque cour
 * fermée (zone d'herbe qui ne touche pas le bord de la grille) ; à défaut de
 * cour, la case d'herbe éligible la plus proche du centre du village.
 */
function wellCells(
  grass: Set<string>,
  eligible: Set<string>,
  paved: Set<string>,
  width: number,
  depth: number,
): Set<string> {
  const wells = new Set<string>();
  const seen = new Set<string>();
  for (const start of grass) {
    if (seen.has(start)) continue;
    // Zone d'herbe d'un seul tenant (4-connexe).
    const region: Array<[number, number]> = [];
    const queue = [start];
    seen.add(start);
    let enclosed = true;
    while (queue.length > 0) {
      const [x, z] = queue.pop()!.split(',').map(Number);
      region.push([x, z]);
      if (x === 0 || z === 0 || x === width - 1 || z === depth - 1) enclosed = false;
      for (const [nx, nz] of [
        [x - 1, z],
        [x + 1, z],
        [x, z - 1],
        [x, z + 1],
      ]) {
        const k = key(nx, nz);
        if (grass.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    if (!enclosed) continue;
    const cx = region.reduce((sum, [x]) => sum + x, 0) / region.length;
    const cz = region.reduce((sum, [, z]) => sum + z, 0) / region.length;
    const [bx, bz] = region.reduce((best, cell) =>
      Math.hypot(cell[0] - cx, cell[1] - cz) < Math.hypot(best[0] - cx, best[1] - cz) ? cell : best,
    );
    wells.add(key(bx, bz));
  }
  if (wells.size > 0 || paved.size === 0) return wells;

  // Pas de cour fermée : un puits quand même, au plus près du cœur du village.
  let cx = 0;
  let cz = 0;
  for (const k of paved) {
    const [x, z] = k.split(',').map(Number);
    cx += x / paved.size;
    cz += z / paved.size;
  }
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const k of eligible) {
    const [x, z] = k.split(',').map(Number);
    const distance = Math.hypot(x - cx, z - cz) + hash3(x, z, 3) * 0.01; // départage stable
    if (distance < bestDistance) {
      bestDistance = distance;
      best = k;
    }
  }
  if (best) wells.add(best);
  return wells;
}

export function propsParts(
  lookup: CellLookup,
  ground: { width: number; depth: number },
  settings: RenderSettings,
  /** Terrain en pente : hauteur du sol autour de chaque case (absent : sol plat à y = 0). */
  groundOf?: (x: number, z: number) => HeightFn,
): Array<{ x: number; z: number; parts: Part[] }> {
  const { width, depth } = ground;
  const paved = pavedCells(lookup, ground);
  if (paved.size === 0) return [];

  // Herbe libre de la grille, et sa part proche du village.
  const grass = new Set<string>();
  const eligible = new Set<string>();
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      if (!isGrassCell(lookup, paved, x, z)) continue;
      grass.add(key(x, z));
      let near = false;
      for (let dx = -PROP_REACH; dx <= PROP_REACH && !near; dx += 1) {
        for (let dz = -PROP_REACH; dz <= PROP_REACH && !near; dz += 1) near = paved.has(key(x + dx, z + dz));
      }
      if (near) eligible.add(key(x, z));
    }
  }

  const wells = wellCells(grass, eligible, paved, width, depth);
  const result: Array<{ x: number; z: number; parts: Part[] }> = [];
  const place = (x: number, z: number, parts: Part[], matrix: THREE.Matrix4) => {
    const heightAt = groundOf?.(x, z);
    if (heightAt) {
      const px = matrix.elements[12];
      const pz = matrix.elements[14];
      const [sx, sz] = slopeAt(heightAt, px, pz);
      matrix.premultiply(xform([0, heightAt(px, pz) - Math.hypot(sx, sz) * PROP_FOOT, 0]));
    }
    for (const p of parts) p.matrix.premultiply(matrix);
    result.push({ x, z, parts });
  };

  for (const k of wells) {
    const [x, z] = k.split(',').map(Number);
    place(x, z, well(settings), xform([0, 0, 0], [0, hash3(x, z, 5) < 0.5 ? 0 : Math.PI / 2, 0]));
  }

  for (const k of eligible) {
    if (wells.has(k)) continue;
    const [x, z] = k.split(',').map(Number);
    if (hash3(x, z, 7) >= PROP_DENSITY) continue;
    // Le puits garde ses abords dégagés.
    let besideWell = false;
    for (let dx = -1; dx <= 1; dx += 1)
      for (let dz = -1; dz <= 1; dz += 1) besideWell ||= wells.has(key(x + dx, z + dz));
    if (besideWell) continue;

    const seed = Math.floor(hash3(x, z, 11) * 1000);
    const pick = hash3(x, z, 13);
    const parts =
      pick < 0.24
        ? bushes(seed)
        : pick < 0.4
          ? tree(seed)
          : pick < 0.54
            ? hay()
            : pick < 0.68
              ? logs()
              : pick < 0.82
                ? barrels(seed)
                : pick < 0.92
                  ? cart(seed)
                  : trough(settings);
    // Légèrement décalé et tourné : jamais au cordeau, mais toujours dans sa case.
    place(
      x,
      z,
      parts,
      xform([(hash3(x, z, 17) - 0.5) * 0.12, 0, (hash3(x, z, 19) - 0.5) * 0.12], [0, hash3(x, z, 23) * Math.PI * 2, 0]),
    );
  }

  return result;
}
