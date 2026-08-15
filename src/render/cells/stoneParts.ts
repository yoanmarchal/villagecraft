/**
 * Pierres apparentes — ex-stonePatches.tsx, porté en builder de parts.
 *
 * Centralise UNIQUEMENT la géométrie/le placement. La logique de zone
 * protégée reste fournie par l'appelant via `isInProtectedZone`, afin de ne
 * jamais affaiblir la sécurité de l'un en la fusionnant avec l'autre
 * (voir AGENTS.md). Types `CellFace`/`CornerRadii` désormais uniques,
 * importés de cellUtils (ils étaient dupliqués ici).
 */

import type { CellFace, CornerRadii } from '../../utils/cellUtils';
import { getFaceCorners, projectOnFace } from '../../utils/cellUtils';
import { roundedBoxGeo } from '../geometryCache';
import { part, xform, type Part } from '../parts';

export interface StoneSeedSalt {
  x: number;
  y: number;
  z: number;
  face: number;
  stone: number;
}

export interface StoneSize {
  width: number;
  height: number;
}

export interface StoneDistanceRange {
  xBase: number;
  /** Modulo (entier) appliqué au hash pour la distance latérale, pas x 0.01 */
  xModRange: number;
  yBase: number;
  /** Modulo (entier) appliqué au hash pour la distance verticale, pas x 0.01 */
  yModRange: number;
}

export interface StoneVisual {
  thickness: number;
  cornerRadius: number;
  smoothness?: number;
  color: string;
  roughness?: number;
  /** Metalness utilisé sur un mur plat */
  metalness?: number;
  /** Metalness spécifique à la tour isolée (sinon retombe sur `metalness`) */
  metalnessIsolated?: number;
}

export interface StonePatchesConfig {
  /** Seules x/y/z sont utilisées pour le hash déterministe */
  cell: { x: number; y: number; z: number };
  exposedFaces: CellFace[];
  /** Tour cylindrique isolée vs mur plat */
  isIsolated: boolean;
  radii: CornerRadii;
  /**
   * 'numeric' (par défaut) transmet le radius réel à projectOnFace.
   * 'boolean' le convertit en simple flag "coin arrondi ?".
   */
  cornerMode?: 'numeric' | 'boolean';
  /** Décalage fixe ajouté à la profondeur de surface sur un mur plat */
  wallSurfaceOffset: number;

  /** 🔢 Nombre de pierres par face exposée. */
  stonesPerFace?: number | ((cell: { x: number; y: number; z: number }, faceIdx: number) => number);

  /** Sels de hash déterministe */
  seedSalt?: StoneSeedSalt;

  /** Taille de base des pierres avant variation */
  baseSize: StoneSize;
  /** Calcule la variation de taille pierre par pierre à partir du hash */
  computeSize?: (h1: number, h2: number, h3: number, base: StoneSize) => StoneSize;

  /** Plage de distance par rapport au centre de la face (évite le centre) */
  distance?: StoneDistanceRange;

  visual: StoneVisual;

  /**
   * 🔒 Sécurité : zone(s) protégée(s) — fenêtres, portes, quoins, bandes...
   * Chaque appelant fournit SA propre logique métier. Ne JAMAIS mutualiser
   * cette fonction entre composants.
   */
  isInProtectedZone: (face: CellFace, x: number, y: number, stoneWidth: number, stoneHeight: number) => boolean;
}

const DEFAULT_SEED_SALT: StoneSeedSalt = { x: 17, y: 31, z: 47, face: 23, stone: 59 };
const DEFAULT_DISTANCE: StoneDistanceRange = { xBase: 0.2, xModRange: 20, yBase: 0.18, yModRange: 18 };

function defaultComputeSize(_h1: number, h2: number, h3: number, base: StoneSize): StoneSize {
  return {
    width: base.width + (h2 % 5) * 0.018,
    height: base.height + (h3 % 4) * 0.012,
  };
}

function defaultStonesPerFace(cell: { x: number; z: number }): number {
  return 3 + (Math.abs(cell.x * 3 + cell.z * 7) % 3);
}

/**
 * Génère les parts des pierres apparentes communes à StandardCell et
 * WallWithWindowCell, pour une tour cylindrique isolée ou un mur plat.
 */
export function stoneParts(config: StonePatchesConfig): Part[] {
  const {
    cell,
    exposedFaces,
    isIsolated,
    radii,
    cornerMode = 'numeric',
    wallSurfaceOffset,
    stonesPerFace,
    seedSalt = DEFAULT_SEED_SALT,
    baseSize,
    computeSize,
    distance = DEFAULT_DISTANCE,
    visual,
    isInProtectedZone,
  } = config;

  if (exposedFaces.length === 0) return [];

  const metalness = isIsolated ? visual.metalnessIsolated ?? visual.metalness ?? 0 : visual.metalness ?? 0;
  const mat = { roughness: visual.roughness ?? 0.9, metalness };

  const parts: Part[] = [];

  exposedFaces.forEach((face, faceIdx) => {
    const count =
      typeof stonesPerFace === 'function'
        ? stonesPerFace(cell, faceIdx)
        : stonesPerFace ?? defaultStonesPerFace(cell);

    const placedStones: { x: number; y: number; w: number; h: number }[] = [];

    for (let i = 0; i < count; i++) {
      const seed = Math.abs(
        cell.x * seedSalt.x +
          cell.y * seedSalt.y +
          cell.z * seedSalt.z +
          faceIdx * seedSalt.face +
          i * seedSalt.stone,
      );
      const h1 = seed % 100;
      const h2 = (seed * 7 + 13) % 100;
      const h3 = (seed * 3 + 41) % 100;

      const { width: w, height: h } = computeSize
        ? computeSize(h1, h2, h3, baseSize)
        : defaultComputeSize(h1, h2, h3, baseSize);

      // Position dans les quadrants pour les 4 premières, puis basé sur le hash
      const quadrant = i % 4;
      const signX = i < 4 ? (quadrant === 0 || quadrant === 2 ? -1 : 1) : h1 % 2 === 0 ? -1 : 1;
      const signY = i < 4 ? (quadrant === 0 || quadrant === 1 ? -1 : 1) : h2 % 2 === 0 ? -1 : 1;
      const rawOffsetX = signX * (distance.xBase + (h1 % distance.xModRange) * 0.01);
      const rawOffsetY = signY * (distance.yBase + (h2 % distance.yModRange) * 0.01);

      // Alignement sur une grille (appareillage en quinconce)
      const rowHeight = baseSize.height * 1.25;
      const colWidth = baseSize.width * 1.15;

      const rowIndex = Math.round(rawOffsetY / rowHeight);
      const offsetY = rowIndex * rowHeight;

      const isEvenRow = Math.abs(rowIndex) % 2 === 0;
      const rowOffsetX = isEvenRow ? 0 : colWidth / 2;

      const colIndex = Math.round((rawOffsetX - rowOffsetX) / colWidth);
      const offsetX = colIndex * colWidth + rowOffsetX;

      // Anti-superposition avec les autres pierres de la même face
      const isOverlapping = placedStones.some(
        (stone) =>
          Math.abs(offsetX - stone.x) < (w + stone.w) / 2 + 0.01 &&
          Math.abs(offsetY - stone.y) < (h + stone.h) / 2 + 0.01,
      );
      if (isOverlapping) continue;

      // 🔒 Sécurité : ne jamais placer une pierre dans une zone protégée
      if (isInProtectedZone(face, offsetX, offsetY, w, h)) continue;

      placedStones.push({ x: offsetX, y: offsetY, w, h });

      // ── Projection sur la surface réelle (mur plat ou arrondi) ────────
      const [crNeg, crPos] = getFaceCorners(face, radii, cornerMode);
      const { surfaceZ, rotY } = projectOnFace(offsetX, crNeg, crPos);

      let pos: [number, number, number];
      let rot: [number, number, number];
      switch (face) {
        case 'front':
          pos = [offsetX, offsetY, surfaceZ + wallSurfaceOffset];
          rot = [0, rotY, 0];
          break;
        case 'back':
          pos = [offsetX, offsetY, -(surfaceZ + wallSurfaceOffset)];
          rot = [0, Math.PI - rotY, 0];
          break;
        case 'left':
          pos = [-(surfaceZ + wallSurfaceOffset), offsetY, offsetX];
          rot = [0, Math.PI / 2 + rotY, 0];
          break;
        case 'right':
          pos = [surfaceZ + wallSurfaceOffset, offsetY, offsetX];
          rot = [0, -(Math.PI / 2 + rotY), 0];
          break;
      }

      parts.push(
        part(
          roundedBoxGeo(w, h, visual.thickness, visual.cornerRadius, visual.smoothness ?? 2),
          visual.color,
          mat,
          xform(pos, rot),
        ),
      );
    }
  });

  return parts;
}
