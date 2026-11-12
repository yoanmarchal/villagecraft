/**
 * Sol pavé : les cases vides au sol qui touchent un bâtiment (ruelles, rues,
 * passages sous les arches) reçoivent des pavés ; plus loin, l'herbe du
 * terrain reste visible. Calculé à chaque reconstruction, comme le reste.
 *
 * Chaque pavé est un vrai bloc aux arêtes arrondies (`stoneBlockGeo`, 12
 * sommets), posé à plat, bien d'aplomb : rangs réguliers en travers de la
 * rue, pavés de longueurs variables, joints décalés d'un rang à l'autre,
 * hauteurs et teintes légèrement inégales. Comme pour les murs
 * (masonryParts.ts), l'appareil est calculé dans le repère de la GRILLE : un
 * pavé à cheval sur deux cases est dessiné pour moitié par chacune, et une
 * rue ne montre aucune limite de case.
 *
 * En lisière d'herbe, le pavage se défait : le lit de pose s'arrête en
 * retrait et une partie des pavés du bord manque, l'herbe poussant entre
 * les autres — plus de bord tiré au cordeau.
 */

import * as THREE from 'three';
import { hasOccupiedCell, type CellLookup } from '../../utils/cellUtils';
import { boxGeo, STONE_EDGE, stoneBlockGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';

/** Lit de terre et de sable, visible entre les pavés. */
const BEDDING_COLOR = '#5f574c';
const BEDDING_H = 0.014;
/** Teintes des pavés : grès gris, plus ou moins chaud, plus ou moins clair. */
const COBBLE_TONES = ['#a39c90', '#958f86', '#aea597', '#8c877f', '#9f9585', '#b3ab9e', '#857f76'];
/** Rangs par case, en travers (selon z) ; ils tombent juste sur les limites de case. */
const ROWS = 7;
/** Joint entre deux pavés. */
const JOINT = 0.014;
/** Hauteur d'un pavé au-dessus du sol : chacun la sienne. */
const HEIGHT_MIN = 0.03;
const HEIGHT_MAX = 0.044;
/** Enfoncement dans le sol (évite un jour sous le pavé). */
const SUNK = 0.006;
/** Largeur de la lisière, côté herbe, où le pavage se défait ; part des pavés qui y manquent. */
const FRINGE = 0.17;
const FRINGE_MISSING = 0.42;
/** Retrait du lit de pose côté herbe : toute la lisière, pour que l'herbe (et non la terre) se voie là où un pavé manque. */
const BEDDING_INSET = FRINGE;
/** En deçà, un bout de pavé (reste d'une coupe en limite de case) n'est pas posé. */
const MIN_PIECE = 0.03;

/** Hash entier → [0, 1), stable (jamais Math.random : même village → mêmes pavés). */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Abscisse (repère grille) du joint n° c du rang `row` : module et décalage propres à chaque rang. */
function cobbleHead(c: number, row: number): number {
  const width = 0.13 + 0.05 * hash3(row, 1, 5);
  return (c + hash3(row, 2, 5) + (hash3(c, row, 7) - 0.5) * 0.4) * width;
}

function columnAt(u: number, row: number): number {
  const width = 0.13 + 0.05 * hash3(row, 1, 5);
  let c = Math.floor(u / width - hash3(row, 2, 5));
  while (cobbleHead(c, row) > u) c -= 1;
  while (cobbleHead(c + 1, row) <= u) c += 1;
  return c;
}

/** Bloc posé à plat : son épaisseur (z local) devient la verticale. */
const FLAT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

export function pavingParts(
  lookup: CellLookup,
  { width, depth }: { width: number; depth: number },
): Array<{ x: number; z: number; parts: Part[] }> {
  const builtAt = (x: number, z: number) => hasOccupiedCell(lookup, x, 0, z);

  // Cases pavées d'abord : la lisière dépend des voisines.
  const paved = new Set<string>();
  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      if (builtAt(x, z)) continue;
      // Sous une arche (rue large : la case du milieu ne touche aucun bâtiment).
      let nearBuilding = hasOccupiedCell(lookup, x, 1, z);
      for (let dx = -1; dx <= 1 && !nearBuilding; dx += 1) {
        for (let dz = -1; dz <= 1 && !nearBuilding; dz += 1) {
          nearBuilding = builtAt(x + dx, z + dz);
        }
      }
      if (nearBuilding) paved.add(`${x},${z}`);
    }
  }
  /** La case voisine est de l'herbe : ni pavée, ni bâtie. */
  const grassAt = (x: number, z: number) => !paved.has(`${x},${z}`) && !builtAt(x, z);
  const mat = { roughness: 0.92 };
  const result: Array<{ x: number; z: number; parts: Part[] }> = [];

  for (const key of paved) {
    const [x, z] = key.split(',').map(Number);
    const grass = {
      left: grassAt(x - 1, z),
      right: grassAt(x + 1, z),
      back: grassAt(x, z - 1),
      front: grassAt(x, z + 1),
    };

    // Lit de pose, en retrait côté herbe.
    const x0 = -0.5 + (grass.left ? BEDDING_INSET : 0);
    const x1 = 0.5 - (grass.right ? BEDDING_INSET : 0);
    const z0 = -0.5 + (grass.back ? BEDDING_INSET : 0);
    const z1 = 0.5 - (grass.front ? BEDDING_INSET : 0);
    const parts: Part[] = [
      part(
        boxGeo(+(x1 - x0).toFixed(3), BEDDING_H, +(z1 - z0).toFixed(3)),
        BEDDING_COLOR,
        { roughness: 1 },
        xform([(x0 + x1) / 2, BEDDING_H / 2, (z0 + z1) / 2]),
      ),
    ];

    for (let r = 0; r < ROWS; r += 1) {
      const row = z * ROWS + r;
      const rowZ0 = -0.5 + r / ROWS;
      const rowZ1 = -0.5 + (r + 1) / ROWS;
      const last = columnAt(x + 1 - 1e-6, row);
      for (let column = columnAt(x, row); column <= last; column += 1) {
        // Pavé entier (repère de la case), puis rogné aux limites de la case.
        const full0 = cobbleHead(column, row) - x - 0.5;
        const full1 = cobbleHead(column + 1, row) - x - 0.5;
        const cut0 = full0 < -0.5;
        const cut1 = full1 > 0.5;
        // Une coupe n'est interne (ni joint ni arrondi) que si la rue continue de l'autre côté.
        const joined0 = cut0 && paved.has(`${x - 1},${z}`);
        const joined1 = cut1 && paved.has(`${x + 1},${z}`);
        const px0 = Math.max(full0, -0.5) + (joined0 ? 0 : JOINT / 2);
        const px1 = Math.min(full1, 0.5) - (joined1 ? 0 : JOINT / 2);
        if (px1 - px0 < MIN_PIECE) continue;

        // Lisière : jugée sur le pavé entier, pour que ses deux moitiés aient le même sort.
        const centreX = (full0 + full1) / 2;
        const centreZ = (rowZ0 + rowZ1) / 2;
        const inFringe =
          (grass.left && centreX < -0.5 + FRINGE) ||
          (grass.right && centreX > 0.5 - FRINGE) ||
          (grass.back && centreZ < -0.5 + FRINGE) ||
          (grass.front && centreZ > 0.5 - FRINGE);
        if (inFringe && hash3(column, row, 11) < FRINGE_MISSING) continue;

        const height = HEIGHT_MIN + (HEIGHT_MAX - HEIGHT_MIN) * hash3(column, row, 13);
        const tone = COBBLE_TONES[Math.floor(hash3(column, row, 17) * COBBLE_TONES.length) % COBBLE_TONES.length];
        // Bloc à plat : son « haut » (y local) regarde vers −z, son « bas » vers +z.
        const mask =
          (joined0 ? 0 : STONE_EDGE.left) | (joined1 ? 0 : STONE_EDGE.right) | STONE_EDGE.top | STONE_EDGE.bottom;
        parts.push({
          ...part(
            stoneBlockGeo(mask),
            tone,
            mat,
            mul(
              xform([(px0 + px1) / 2, (height - SUNK) / 2, centreZ]),
              FLAT,
              xform([0, 0, 0], [0, 0, 0], [px1 - px0, rowZ1 - rowZ0 - JOINT, height + SUNK]),
            ),
          ),
          rigidNormals: true,
        });
      }
    }

    result.push({ x, z, parts });
  }

  return result;
}
