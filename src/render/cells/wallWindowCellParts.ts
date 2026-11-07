/**
 * Mur avec fenêtre / porte / meurtrière — ex-WallWithWindowCell.
 *
 * Le cadre de fenêtre "creusé" n'utilise plus de CSG runtime : c'est une
 * extrusion de shape percée d'un trou (frameWithHoleGeo), visuellement
 * équivalente et bien moins coûteuse.
 */

import type { CellFace } from '../../utils/cellUtils';
import { FACE_ROTATION_Y, getFaceCorners } from '../../utils/cellUtils';
import { varyColorBrightness, shades } from '../../colorPalettes';
import { WINDOW_PROTECTED_AREAS, isInProtectedArea } from '../../config/protectedAreasConfig';
import {
  boxGeo,
  cylinderGeo,
  frameWithHoleGeo,
  OPENING_SIZES,
  roundedBoxGeo,
  WALL_T,
  type OpeningSpec,
} from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import { shellParts } from './shellParts';
import { stoneParts } from './stoneParts';
import { isQuoinProtected } from './decorations';
import type { CellContext } from './context';

/** Opacité de jour des vitres : assez faible pour voir l'intérieur depuis la rue. */
export const WINDOW_GLASS_OPACITY = 0.3;
/** Opacité des vitres à `windowGlow` = 1 : la lueur du soir reste franche (bloom). */
export const WINDOW_GLASS_LIT_OPACITY = 0.85;

export function wallWindowCellParts(ctx: CellContext): Part[] {
  const { cell, lookup, exposedFaces, radii, isIsolated, isRampart, settings } = ctx;
  // Tours et courtines sont défensives : meurtrières plutôt que fenêtres.
  const hasArrowSlits = isIsolated || isRampart;
  const { windowStonesPerFace, windowStoneRoughness, quoinMargin } = settings;

  const baseColor = settings.wallBaseColor;
  // Verre clair, à peine teinté : l'intérieur (et demain son mobilier) doit
  // se voir depuis la rue. Le soir, VillageMeshes remonte son opacité avec
  // `windowGlow` pour que la lueur reste franche.
  const windowGlassColor = '#c4dbe6';
  const { windowFrameColor, doorColor } = shades(baseColor, { windowFrameColor: -0.15, doorColor: -0.20 });
  const doorFrameColor = windowFrameColor; // même teinte que le cadre de fenêtre
  const separatorColor = varyColorBrightness(windowFrameColor, -0.05);

  // Radius moyen du bloc, réutilisé par tous les éléments
  const avgRadius = (radii.backLeft + radii.backRight + radii.frontLeft + radii.frontRight) / 4;
  const windowRadius = Math.min(0.025, avgRadius * 0.9);
  const glassRadius = Math.min(0.02, avgRadius * 0.8);

  // ── Porte au rez-de-chaussée uniquement ────────────────────────────────
  const isGroundFloor = cell.y === 0;
  const doorFaceHash = Math.abs(cell.x * 31 + cell.z * 17) % Math.max(exposedFaces.length, 1);
  // Pas de porte au pied des courtines : un mur défensif ne s'ouvre pas à chaque case.
  const doorFace = isGroundFloor && !isRampart && exposedFaces.length > 0 ? exposedFaces[doorFaceHash] : null;

  const hasBands = exposedFaces.length > 0;

  // La face d'un mur n'est plate à z=0.5 que sur la portion non couverte par
  // l'arrondi des coins (largeur `1 - 2*radius`). Le cadre et l'ouverture
  // percée dans la coque doivent tenir dans cette portion plate (au-delà, le
  // cadre flotterait devant le mur qui recule) : on les rétrécit.
  // `MIN_OPENING_SCALE` évite qu'ils deviennent minuscules à rayon extrême,
  // au prix d'un léger débord résiduel dans ce cas limite.
  const MIN_OPENING_SCALE = 0.75;
  const openingScale = (face: CellFace, nominalWidth: number): number => {
    const [crNeg, crPos] = getFaceCorners(face, radii, 'numeric');
    const flatWidth = 1 - 2 * Math.max(crNeg, crPos);
    return Math.min(1, Math.max(MIN_OPENING_SCALE, flatWidth / nominalWidth));
  };

  // ── Ouverture de chaque face exposée : porte, meurtrière ou fenêtre ──────
  const openingOf = (face: CellFace): OpeningSpec => {
    if (face === doorFace) return { face, kind: 'door', scale: openingScale(face, 0.48) };
    if (hasArrowSlits) return { face, kind: 'slit', scale: openingScale(face, 0.14) };
    return { face, kind: 'window', scale: openingScale(face, 0.6) };
  };
  const openings = exposedFaces.map(openingOf);

  // Coque creuse percée de ses ouvertures : fenêtres, porte et meurtrières
  // traversent réellement le mur ; vitres et vantaux se logent dans l'épaisseur.
  const parts: Part[] = shellParts(ctx, baseColor, openings);
  /** Profondeur (z local de face) du milieu de l'épaisseur du mur. */
  const revealZ = 0.5 - WALL_T / 2;

  // ── Pierres apparentes ─────────────────────────────────────────────────
  if (exposedFaces.length > 0) {
    const stoneColor = varyColorBrightness(baseColor, -0.25);
    const baseStoneW = 0.12 + (Math.abs(cell.x) % 4) * 0.02;
    const baseStoneH = baseStoneW * 0.75;

    parts.push(
      ...stoneParts({
        cell,
        exposedFaces,
        isIsolated,
        radii,
        cornerMode: 'numeric',
        wallSurfaceOffset: 0.015,
        stonesPerFace: windowStonesPerFace,
        seedSalt: { x: 7, y: 11, z: 13, face: 23, stone: 17 },
        baseSize: { width: baseStoneW, height: baseStoneH },
        computeSize: (h1, h2, _h3, base) => ({
          width: base.width * (0.85 + (h1 % 20) / 100),
          height: base.height * (0.8 + (h2 % 15) / 100),
        }),
        distance: { xBase: 0, xModRange: 45, yBase: 0, yModRange: 45 },
        visual: {
          thickness: 0.025,
          cornerRadius: 0.012,
          smoothness: 4,
          color: stoneColor,
          roughness: windowStoneRoughness,
          metalness: 0.1,
          metalnessIsolated: 0.05,
        },
        // 🔒 Zone protégée propre à WallWithWindowCell
        isInProtectedZone: (face, x, y, w, h) => {
          let area = WINDOW_PROTECTED_AREAS.window;
          if (face === doorFace) {
            area = WINDOW_PROTECTED_AREAS.door;
          } else if (hasArrowSlits) {
            area = WINDOW_PROTECTED_AREAS.arrowSlit;
          }

          if (isInProtectedArea(area, x, y, w, h)) return true;

          if (hasBands) {
            if (isInProtectedArea(WINDOW_PROTECTED_AREAS.bandTop, x, y, w, h)) return true;
            if (isInProtectedArea(WINDOW_PROTECTED_AREAS.bandBottom, x, y, w, h)) return true;
          }

          if (isQuoinProtected(cell, lookup, isIsolated, face, x, w, quoinMargin)) return true;

          return false;
        },
      }),
    );
  }

  // ── Fenêtre ────────────────────────────────────────────────────────────
  const windowParts = (rotation: number, scale: number): Part[] => {
    const faceRot = xform([0, 0, 0], [0, rotation, 0]);
    return [
      // Cadre percé sur la face extérieure, son jour aligné sur l'ouverture de la coque
      part(frameWithHoleGeo(0.6 * scale, 0.5, windowRadius, 0.54 * scale, 0.44, glassRadius, 0.02),
        windowFrameColor, { roughness: 0.85 }, mul(faceRot, xform([0, 0, 0.50]))),
      // Vitre transparente, en retrait dans l'épaisseur du mur (tableau visible)
      part(roundedBoxGeo(0.54 * scale, 0.44, 0.02, glassRadius, 4), windowGlassColor,
        { roughness: 0.1, metalness: 0, transparent: true, opacity: WINDOW_GLASS_OPACITY, glow: true },
        mul(faceRot, xform([0, 0, revealZ]))),
      // Séparateurs horizontal et vertical, juste devant la vitre
      part(boxGeo(0.54 * scale, 0.05, 0.019), separatorColor, { roughness: 1 }, mul(faceRot, xform([0, 0, revealZ + 0.015]))),
      part(boxGeo(0.03, 0.44, 0.019), separatorColor, { roughness: 1 }, mul(faceRot, xform([0, 0, revealZ + 0.015]))),
    ];
  };

  // ── Porte ──────────────────────────────────────────────────────────────
  const doorParts = (rotation: number, scale: number): Part[] => {
    const doorFrameRadius = Math.min(0.015, avgRadius * 0.8);
    const doorPanelRadius = Math.min(0.012, avgRadius * 0.7);
    const thresholdRadius = Math.min(0.01, avgRadius * 0.6);
    const faceRot = xform([0, 0, 0], [0, rotation, 0]);
    const door = OPENING_SIZES.door;
    const panelZ = revealZ;
    return [
      // Chambranle percé : entoure l'ouverture sans la boucher
      part(frameWithHoleGeo(0.48 * scale, door.h + 0.08, doorFrameRadius, door.w * scale, door.h, doorPanelRadius, 0.03),
        doorFrameColor, { roughness: 0.88 }, mul(faceRot, xform([0, door.y, 0.502]))),
      // Vantail logé dans l'épaisseur du mur
      part(roundedBoxGeo(door.w * scale, door.h, 0.04, doorPanelRadius, 6), doorColor, { roughness: 0.92 },
        mul(faceRot, xform([0, door.y, panelZ]))),
      part(cylinderGeo(0.01, 0.01, 0.04, 8), '#8a6a3a', { metalness: 0.55, roughness: 0.35 },
        mul(faceRot, xform([0.14 * scale, -0.14, panelZ + 0.03], [Math.PI / 2, 0, 0]))),
      part(roundedBoxGeo(0.5 * scale, 0.04, 0.03, thresholdRadius, 4), varyColorBrightness(baseColor, -0.18),
        { roughness: 0.94 }, mul(faceRot, xform([0, -0.49, 0.501]))),
    ];
  };

  // ── Meurtrière (tours) ─────────────────────────────────────────────────
  const arrowSlitParts = (rotation: number, scale: number): Part[] => {
    const arrowSlitRadius = Math.min(0.02, avgRadius * 0.9);
    const arrowSlitInnerRadius = Math.min(0.015, avgRadius * 0.7);
    const faceRot = xform([0, 0, 0], [0, rotation, 0]);
    const slit = OPENING_SIZES.slit;
    return [
      // Encadrement percé de la fente
      part(frameWithHoleGeo(0.14 * scale, 0.4, arrowSlitRadius, slit.w * scale, slit.h, arrowSlitInnerRadius, 0.02),
        '#3a2a1a', { roughness: 0.95 }, mul(faceRot, xform([0, 0, 0.505]))),
      // Fond lumineux au revers du mur : la fente traverse toute l'épaisseur
      part(roundedBoxGeo(slit.w * scale, slit.h, 0.02, arrowSlitInnerRadius, 4), '#0a0a0a', { roughness: 0.98, glow: true },
        mul(faceRot, xform([0, 0, 0.5 - WALL_T + 0.012]))),
    ];
  };

  // ── Rendu par face exposée ─────────────────────────────────────────────
  for (const { face, kind, scale } of openings) {
    const rot = FACE_ROTATION_Y[face];
    if (kind === 'door') parts.push(...doorParts(rot, scale));
    else if (kind === 'slit') parts.push(...arrowSlitParts(rot, scale));
    else parts.push(...windowParts(rot, scale));
  }

  return parts;
}
