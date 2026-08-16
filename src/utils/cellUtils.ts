import type { GridCell } from '../types';
import { useControlStore } from '../store/controlStore';

export type CellLookup = Record<string, GridCell>;

// ── Shape inheritance system ─────────────────────────────────────────────────
//
// A cell's corners are rounded based on whether it has neighbours.
// Each corner is identified by (dx, dz) = (±1, ±1).
// A corner is "open" (rounded) when BOTH adjacent horizontal neighbours are absent.
// A corner is "closed" (sharp, radius ≈ 0) when either adjacent neighbour exists.
//
// This gives naturally rounded towers for isolated blocks and squared-off
// corners where cells join into a larger mass.

export interface CornerRadii {
  /** corner (-X, -Z) */
  backLeft: number;
  /** corner (+X, -Z) */
  backRight: number;
  /** corner (-X, +Z) */
  frontLeft: number;
  /** corner (+X, +Z) */
  frontRight: number;
  /** convenience: max of all four (use for RoundedBox fallback) */
  max: number;
  /** true when all four corners have the same radius */
  uniform: boolean;
}

/**
 * Returns per-corner radii for a cell based on its horizontal neighbours.
 * Tower columns (see `isTowerColumn`) are fully rounded on every side that
 * is open at the base — uniformly across the whole column height. A side
 * that *is* attached to a wall at the base instead inherits that wall's
 * (near right-angle) corner treatment for the whole tower, even at floors
 * above where the wall has already ended, so the corner doesn't flip
 * abruptly from angular to round partway up.
 * Non-tower cells in a group get sharp corners where they touch neighbours
 * and slightly rounded (almost right angle) corners on their exposed
 * extremities.
 */
export function getCornerRadii(lookup: CellLookup, cell: GridCell): CornerRadii {
  const { isolatedWallRadius, connectedWallExposedRadius, connectedWallInteriorRadius } = useControlStore.getState();

  if (isTowerColumn(lookup, cell)) {
    // C'est la base de la tour qui décide, une fois pour toutes, quels côtés
    // sont accolés à un mur : ce traitement "mur connecté" (presque angle
    // droit) s'applique alors à toute la hauteur de la tour — même aux étages
    // où le mur adjacent s'est arrêté plus bas — sinon le coin passerait
    // brutalement d'anguleux à rond en cours de tour. Les côtés jamais
    // accolés à la base restent pleinement arrondis sur toute la hauteur.
    const base = getColumnBase(lookup, cell);
    const hasL = hasOccupiedCell(lookup, base.x - 1, base.y, base.z);
    const hasR = hasOccupiedCell(lookup, base.x + 1, base.y, base.z);
    const hasF = hasOccupiedCell(lookup, base.x, base.y, base.z + 1);
    const hasB = hasOccupiedCell(lookup, base.x, base.y, base.z - 1);

    return buildCornerRadii(hasL, hasR, hasF, hasB, isolatedWallRadius, connectedWallInteriorRadius);
  }

  const hasL = hasOccupiedCell(lookup, cell.x - 1, cell.y, cell.z);
  const hasR = hasOccupiedCell(lookup, cell.x + 1, cell.y, cell.z);
  const hasF = hasOccupiedCell(lookup, cell.x, cell.y, cell.z + 1);
  const hasB = hasOccupiedCell(lookup, cell.x, cell.y, cell.z - 1);

  // Les murs qui ont 1 ou plusieurs murs adjacents doivent être "presque un angle droit" sur leurs parties exposées
  return buildCornerRadii(hasL, hasR, hasF, hasB, connectedWallExposedRadius, connectedWallInteriorRadius);
}

function buildCornerRadii(
  hasL: boolean,
  hasR: boolean,
  hasF: boolean,
  hasB: boolean,
  exposedRadius: number,
  interiorRadius: number
): CornerRadii {
  const backLeft = (!hasL && !hasB) ? exposedRadius : interiorRadius;
  const backRight = (!hasR && !hasB) ? exposedRadius : interiorRadius;
  const frontLeft = (!hasL && !hasF) ? exposedRadius : interiorRadius;
  const frontRight = (!hasR && !hasF) ? exposedRadius : interiorRadius;

  const max = Math.max(backLeft, backRight, frontLeft, frontRight);
  const uniform = backLeft === backRight && backRight === frontLeft && frontLeft === frontRight;

  return { backLeft, backRight, frontLeft, frontRight, max, uniform };
}

/**
 * Multiplie chaque radius de coin par un facteur, en conservant `uniform`.
 * Sert à faire épouser à un élément plus large ou plus étroit que la
 * cellule (parapet, bagues, tranches de flèche...) exactement le même
 * contour proportionnel que le corps principal (ex: `ShapedBox`).
 */
export function scaleCornerRadii(radii: CornerRadii, factor: number): CornerRadii {
  return {
    backLeft: radii.backLeft * factor,
    backRight: radii.backRight * factor,
    frontLeft: radii.frontLeft * factor,
    frontRight: radii.frontRight * factor,
    max: radii.max * factor,
    uniform: radii.uniform,
  };
}

export function cellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

export function makeCellLookup(cells: GridCell[]): CellLookup {
  return cells.reduce<CellLookup>((lookup, cell) => {
    lookup[cellKey(cell.x, cell.y, cell.z)] = cell;
    return lookup;
  }, {});
}

export function getCell(lookup: CellLookup, x: number, y: number, z: number): GridCell | null {
  return lookup[cellKey(x, y, z)] ?? null;
}

export function hasOccupiedCell(lookup: CellLookup, x: number, y: number, z: number): boolean {
  return getCell(lookup, x, y, z)?.isOccupied ?? false;
}

// Détecte la configuration du toit et son orientation
export function getRoofConfig(lookup: CellLookup, cell: GridCell): {
  axis: 'x' | 'z';
  hasLeft: boolean;
  hasRight: boolean;
  hasFront: boolean;
  hasBack: boolean;
  isCorner: boolean;
  isEnd: boolean;
} {
  const hasLeft = hasOccupiedCell(lookup, cell.x - 1, cell.y, cell.z);
  const hasRight = hasOccupiedCell(lookup, cell.x + 1, cell.y, cell.z);
  const hasFront = hasOccupiedCell(lookup, cell.x, cell.y, cell.z + 1);
  const hasBack = hasOccupiedCell(lookup, cell.x, cell.y, cell.z - 1);

  const eastWest = Number(hasLeft) + Number(hasRight);
  const northSouth = Number(hasFront) + Number(hasBack);

  // Détecte si c'est un coin (voisins perpendiculaires)
  const isCorner = (eastWest === 1 && northSouth === 1);

  // Détecte si c'est une extrémité (voisin sur un seul côté)
  const isEnd = (eastWest + northSouth === 1);

  const axis = eastWest > northSouth ? 'x' : 'z';

  return { axis, hasLeft, hasRight, hasFront, hasBack, isCorner, isEnd };
}

export function getArchAxis(lookup: CellLookup, cell: GridCell): 'x' | 'z' {
  const eastWest = Number(hasOccupiedCell(lookup, cell.x - 1, cell.y, cell.z)) + Number(hasOccupiedCell(lookup, cell.x + 1, cell.y, cell.z));
  const northSouth = Number(hasOccupiedCell(lookup, cell.x, cell.y, cell.z - 1)) + Number(hasOccupiedCell(lookup, cell.x, cell.y, cell.z + 1));

  // Si plus de voisins sur l'axe X, l'arche doit être orientée selon Z (pour enjambée l'axe X)
  // Si plus de voisins sur l'axe Z, l'arche doit être orientée selon X (pour enjambée l'axe Z)
  if (eastWest > northSouth) {
    return 'z';
  }
  if (northSouth > eastWest) {
    return 'x';
  }

  // Si égal, choisir en fonction de la position pour une cohérence visuelle
  return 'z';
}

export type CellFace = 'front' | 'back' | 'left' | 'right';

/**
 * Rotation Y (radians) à appliquer à un groupe dont le design local fait
 * face à +Z, pour qu'il pointe vers l'extérieur de la face donnée.
 * Mapping partagé par tous les cell components qui placent des éléments
 * (fenêtres, portes, plinthes...) par face.
 */
export const FACE_ROTATION_Y: Record<CellFace, number> = {
  front: 0,
  back: Math.PI,
  left: -Math.PI / 2,
  right: Math.PI / 2,
};

// Détecte les faces exposées d'un bloc (sans voisin adjacent)
export function getExposedFaces(lookup: CellLookup, cell: GridCell): Array<CellFace> {
  const faces: Array<CellFace> = [];

  if (!hasOccupiedCell(lookup, cell.x, cell.y, cell.z + 1)) faces.push('front');  // Z+
  if (!hasOccupiedCell(lookup, cell.x, cell.y, cell.z - 1)) faces.push('back');   // Z-
  if (!hasOccupiedCell(lookup, cell.x - 1, cell.y, cell.z)) faces.push('left');   // X-
  if (!hasOccupiedCell(lookup, cell.x + 1, cell.y, cell.z)) faces.push('right');  // X+

  return faces;
}

/**
 * Un coin (dx, dz) ∈ {±1}² est "exposé" si l'un des deux voisins adjacents
 * ou le voisin diagonal est absent. Logique partagée entre le rendu des
 * quoins et la protection des stone patches (elle était dupliquée avant).
 */
export function isCornerExposed(lookup: CellLookup, cell: GridCell, dx: number, dz: number): boolean {
  const adj1 = hasOccupiedCell(lookup, cell.x + dx, cell.y, cell.z);
  const adj2 = hasOccupiedCell(lookup, cell.x, cell.y, cell.z + dz);
  const diag = hasOccupiedCell(lookup, cell.x + dx, cell.y, cell.z + dz);
  return !(adj1 && adj2 && diag);
}

/**
 * Retourne les deux rayons de coin qui bordent `face` (côté négatif puis
 * positif de son axe latéral). Mutualisé entre les pierres apparentes et le
 * dimensionnement des fenêtres/portes (elles étaient dupliquées avant).
 */
export function getFaceCorners(face: CellFace, radii: CornerRadii, cornerMode: 'numeric' | 'boolean'): [number, number] {
  // En mode 'boolean', on écrase le radius en 0/EDGE-like flag numérique
  const toVal = (r: number) => (cornerMode === 'boolean' ? (r > 0.01 ? r : 0) : r);
  switch (face) {
    case 'front':
      return [toVal(radii.frontLeft), toVal(radii.frontRight)];
    case 'back':
      return [toVal(radii.backLeft), toVal(radii.backRight)];
    case 'left':
      return [toVal(radii.backLeft), toVal(radii.frontLeft)];
    case 'right':
      return [toVal(radii.backRight), toVal(radii.frontRight)];
  }
}

/** Les 4 coins d'une cellule, avec leur nom canonique. */
export const CELL_CORNERS: ReadonlyArray<{ dx: -1 | 1; dz: -1 | 1; corner: 'backLeft' | 'backRight' | 'frontLeft' | 'frontRight' }> = [
  { dx: -1, dz: -1, corner: 'backLeft' },
  { dx: 1, dz: -1, corner: 'backRight' },
  { dx: -1, dz: 1, corner: 'frontLeft' },
  { dx: 1, dz: 1, corner: 'frontRight' },
];

// Détecte si un bloc est isolé (aucun voisin horizontal)
export function isIsolatedBlock(lookup: CellLookup, cell: GridCell): boolean {
  return !hasOccupiedCell(lookup, cell.x - 1, cell.y, cell.z) &&
    !hasOccupiedCell(lookup, cell.x + 1, cell.y, cell.z) &&
    !hasOccupiedCell(lookup, cell.x, cell.y, cell.z - 1) &&
    !hasOccupiedCell(lookup, cell.x, cell.y, cell.z + 1);
}

/**
 * Retourne true si cette cellule fait partie d'une colonne de tour ronde.
 *
 * Une colonne est "tour ronde" si n'importe quel étage de la colonne
 * (depuis la cellule courante jusqu'au sommet) est isolé horizontalement.
 * Cela propage la forme cylindrique vers le bas : si le sommet est une tour,
 * tous les blocs en dessous dans la même colonne (x, z) le sont aussi.
 */
export function isTowerColumn(lookup: CellLookup, cell: GridCell): boolean {
  // On remonte la colonne depuis y courant vers le haut
  let y = cell.y;
  while (true) {
    const current = getCell(lookup, cell.x, y, cell.z);
    if (!current?.isOccupied) break;          // fin de la colonne
    if (isIsolatedBlock(lookup, current)) return true;  // un étage isolé trouvé
    y += 1;
  }
  return false;
}

/**
 * Retourne la cellule la plus basse de la colonne (x, z) contenant `cell`,
 * en descendant tant que la colonne reste occupée.
 */
export function getColumnBase(lookup: CellLookup, cell: GridCell): GridCell {
  let base = cell;
  let y = cell.y - 1;
  while (true) {
    const below = getCell(lookup, cell.x, y, cell.z);
    if (!below?.isOccupied) break;
    base = below;
    y -= 1;
  }
  return base;
}

// =============================================================================
// Utilitaires de géométrie pour la projection sur les faces arrondies
// =============================================================================

/**
 * Projette un point latéral t sur la surface réelle d'une face,
 * en tenant compte des coins arrondis.
 * 
 * @param t - Position latérale sur la face (-0.5 à 0.5)
 * @param cornerRoundedNeg - True si le coin côté t < 0 est arrondi
 * @param cornerRoundedPos - True si le coin côté t > 0 est arrondi
 * @returns { surfaceZ, rotY } - Profondeur réelle sur la face et rotation tangente
 * 
 * Dans le repère local de la face :
 * - t : position latérale (-0.5 à 0.5)
 * - surfaceZ : profondeur de sortie (0 = centre, 0.5 = surface plate)
 * - rotY : rotation tangente pour aligner avec la surface
 */
export function projectOnFace(
  t: number,
  radiusNeg: number,
  radiusPos: number,
): { surfaceZ: number; rotY: number } {
  if (t > 0 && radiusPos > 0.001) {
    const flatLimit = 0.5 - radiusPos;
    if (t > flatLimit) {
      // ⚠️ Clamp : t peut légèrement dépasser le bord de la face (alignement
      // en grille des pierres) → sans clamp, asin(>1) = NaN qui corrompait
      // toute la géométrie fusionnée.
      const dx = Math.min(t - flatLimit, radiusPos); // 0 to radiusPos
      const dz = Math.sqrt(Math.max(0, radiusPos * radiusPos - dx * dx));
      const theta = Math.asin(dx / radiusPos);
      return {
        surfaceZ: flatLimit + dz,
        rotY: theta,
      };
    }
  } else if (t < 0 && radiusNeg > 0.001) {
    const flatLimit = -0.5 + radiusNeg;
    if (t < flatLimit) {
      const dx = Math.min(flatLimit - t, radiusNeg); // positive, 0 to radiusNeg
      const dz = Math.sqrt(Math.max(0, radiusNeg * radiusNeg - dx * dx));
      const theta = Math.asin(dx / radiusNeg);
      return {
        surfaceZ: 0.5 - radiusNeg + dz,
        rotY: -theta,
      };
    }
  }
  return { surfaceZ: 0.5, rotY: 0 };
}

/**
 * Génère les points 2D (plan XZ, X→X / Z→Y) du contour "carré aux coins
 * arrondis" utilisé par `ShapedBox`. Mutualisé ici pour que d'autres
 * éléments (parapets de tour, flèches...) puissent épouser exactement le
 * même contour proportionnel que le corps de la cellule en dessous, au
 * lieu de recourir à un cercle parfait.
 */
export function getRoundedRectContourPoints(
  hw: number,
  hd: number,
  radii: CornerRadii,
  arcSegs: number = 10,
): Array<[number, number]> {
  const corners: Array<{
    cx: number; cy: number; r: number; startAngle: number; cornerX: number; cornerY: number;
  }> = [
    { cx: -hw + radii.frontLeft, cy: -hd + radii.frontLeft, r: radii.frontLeft, startAngle: Math.PI, cornerX: -hw, cornerY: -hd },
    { cx:  hw - radii.frontRight, cy: -hd + radii.frontRight, r: radii.frontRight, startAngle: Math.PI * 1.5, cornerX: hw, cornerY: -hd },
    { cx:  hw - radii.backRight, cy:  hd - radii.backRight, r: radii.backRight, startAngle: 0, cornerX: hw, cornerY: hd },
    { cx: -hw + radii.backLeft, cy:  hd - radii.backLeft, r: radii.backLeft, startAngle: Math.PI * 0.5, cornerX: -hw, cornerY: hd },
  ];

  const points: Array<[number, number]> = [];
  for (const c of corners) {
    if (c.r > 0.001) {
      for (let i = 0; i <= arcSegs; i++) {
        const a = c.startAngle + (Math.PI / 2) * (i / arcSegs);
        points.push([c.cx + Math.cos(a) * c.r, c.cy + Math.sin(a) * c.r]);
      }
    } else {
      points.push([c.cornerX, c.cornerY]);
    }
  }
  return points;
}

/**
 * Échantillonne un point sur le périmètre d'un contour fermé (issu de
 * `getRoundedRectContourPoints`) à une fraction `t` (0..1, cyclique) de la
 * longueur totale. Retourne aussi l'angle radial (utile pour orienter un
 * élément vers l'extérieur, ex: un merlon).
 */
export function sampleContourPerimeter(
  points: Array<[number, number]>,
  t: number,
): { x: number; z: number; angle: number } {
  const n = points.length;
  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const len = Math.hypot(x1 - x0, y1 - y0);
    segLengths.push(len);
    total += len;
  }

  let target = (((t % 1) + 1) % 1) * total;
  for (let i = 0; i < n; i++) {
    if (target <= segLengths[i] || i === n - 1) {
      const ratio = segLengths[i] > 0 ? target / segLengths[i] : 0;
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % n];
      const x = x0 + (x1 - x0) * ratio;
      const z = y0 + (y1 - y0) * ratio;
      return { x, z, angle: Math.atan2(z, x) };
    }
    target -= segLengths[i];
  }
  const [x, y] = points[0];
  return { x, z: y, angle: Math.atan2(y, x) };
}
