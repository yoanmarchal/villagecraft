/**
 * Mur avec fenêtre / porte / meurtrière — ex-WallWithWindowCell.
 *
 * Le cadre de fenêtre "creusé" n'utilise plus de CSG runtime : c'est une
 * extrusion de shape percée d'un trou (frameWithHoleGeo), visuellement
 * équivalente et bien moins coûteuse.
 */

import type { CellFace } from '../../utils/cellUtils';
import { FACE_ROTATION_Y } from '../../utils/cellUtils';
import { varyColorBrightness, shades } from '../../colorPalettes';
import { WINDOW_PROTECTED_AREAS, isInProtectedArea } from '../../config/protectedAreasConfig';
import { boxGeo, cylinderGeo, frameWithHoleGeo, roundedBoxGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import { shellParts } from './shellParts';
import { stoneParts } from './stoneParts';
import { isQuoinProtected } from './decorations';
import type { CellContext } from './context';
import { useControlStore } from '../../store/controlStore';

export function wallWindowCellParts(ctx: CellContext): Part[] {
  const { cell, lookup, exposedFaces, radii, isIsolated } = ctx;
  const { windowStonesPerFace, windowStoneRoughness } = useControlStore.getState();

  const baseColor = cell.color ?? '#e0c996';
  const windowGlassColor = '#2a3a4a';
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
  const doorFace = isGroundFloor && exposedFaces.length > 0 ? exposedFaces[doorFaceHash] : null;

  const hasBands = exposedFaces.length > 0;

  const parts: Part[] = shellParts(ctx, baseColor);

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
          } else if (isIsolated) {
            area = WINDOW_PROTECTED_AREAS.arrowSlit;
          }

          if (isInProtectedArea(area, x, y, w, h)) return true;

          if (hasBands) {
            if (isInProtectedArea(WINDOW_PROTECTED_AREAS.bandTop, x, y, w, h)) return true;
            if (isInProtectedArea(WINDOW_PROTECTED_AREAS.bandBottom, x, y, w, h)) return true;
          }

          if (isQuoinProtected(cell, lookup, isIsolated, face, x, w)) return true;

          return false;
        },
      }),
    );
  }

  // ── Fenêtre ────────────────────────────────────────────────────────────
  const windowParts = (rotation: number): Part[] => {
    const faceRot = xform([0, 0, 0], [0, rotation, 0]);
    return [
      // Cadre percé (ex-CSG Base − Subtraction)
      part(frameWithHoleGeo(0.6, 0.5, windowRadius, 0.54, 0.44, glassRadius, 0.02),
        windowFrameColor, { roughness: 0.85 }, mul(faceRot, xform([0, 0, 0.50]))),
      // Vitre transparente
      part(roundedBoxGeo(0.54, 0.44, 0.03, glassRadius, 4), windowGlassColor,
        { roughness: 0.1, metalness: 0.15, transparent: true, opacity: 0.85 },
        mul(faceRot, xform([0, 0, 0.51]))),
      // Séparateurs horizontal et vertical
      part(boxGeo(0.54, 0.05, 0.019), separatorColor, { roughness: 1 }, mul(faceRot, xform([0, 0, 0.52]))),
      part(boxGeo(0.03, 0.44, 0.019), separatorColor, { roughness: 1 }, mul(faceRot, xform([0, 0, 0.52]))),
    ];
  };

  // ── Porte ──────────────────────────────────────────────────────────────
  const doorParts = (rotation: number): Part[] => {
    const doorFrameRadius = Math.min(0.015, avgRadius * 0.8);
    const doorPanelRadius = Math.min(0.012, avgRadius * 0.7);
    const thresholdRadius = Math.min(0.01, avgRadius * 0.6);
    const faceRot = xform([0, 0, 0], [0, rotation, 0]);
    return [
      part(roundedBoxGeo(0.48, 0.8, 0.03, doorFrameRadius, 4), doorFrameColor, { roughness: 0.88 },
        mul(faceRot, xform([0, -0.06, 0.502]))),
      part(roundedBoxGeo(0.4, 0.7, 0.04, doorPanelRadius, 6), doorColor, { roughness: 0.92 },
        mul(faceRot, xform([0, -0.10, 0.5]))),
      part(cylinderGeo(0.01, 0.01, 0.04, 8), '#8a6a3a', { metalness: 0.55, roughness: 0.35 },
        mul(faceRot, xform([0.16, -0.14, 0.502], [Math.PI / 2, 0, 0]))),
      part(roundedBoxGeo(0.5, 0.04, 0.03, thresholdRadius, 4), varyColorBrightness(baseColor, -0.18),
        { roughness: 0.94 }, mul(faceRot, xform([0, -0.49, 0.501]))),
    ];
  };

  // ── Meurtrière (tours) ─────────────────────────────────────────────────
  const arrowSlitParts = (rotation: number): Part[] => {
    const arrowSlitRadius = Math.min(0.02, avgRadius * 0.9);
    const arrowSlitInnerRadius = Math.min(0.015, avgRadius * 0.7);
    const faceRot = xform([0, 0, 0], [0, rotation, 0]);
    return [
      part(roundedBoxGeo(0.14, 0.4, 0.02, arrowSlitRadius, 4), '#3a2a1a', { roughness: 0.95 },
        mul(faceRot, xform([0, 0, 0.505]))),
      part(roundedBoxGeo(0.08, 0.32, 0.04, arrowSlitInnerRadius, 4), '#0a0a0a', { roughness: 0.98 },
        mul(faceRot, xform([0, 0, 0.49]))),
    ];
  };

  // ── Rendu par face exposée ─────────────────────────────────────────────
  const faceParts = (face: CellFace): Part[] => {
    const rot = FACE_ROTATION_Y[face];
    if (face === doorFace) return doorParts(rot);
    if (isIsolated) return arrowSlitParts(rot);
    return windowParts(rot);
  };

  for (const face of exposedFaces) parts.push(...faceParts(face));

  return parts;
}
