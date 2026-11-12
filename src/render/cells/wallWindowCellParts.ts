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
import {
  boxGeo,
  frameWithHoleGeo,
  OPENING_SIZES,
  roundedBoxGeo,
  torusArcGeo,
  WALL_T,
  type OpeningKind,
  type OpeningSpec,
} from '../geometryCache';
import { asInterior, mul, part, xform, type Part } from '../parts';
import { shellParts } from './shellParts';
import { openingKindsOf } from './openings';
import { masonryFacesOf, masonryParts, type MasonryHole } from './masonryParts';
import type { CellContext } from './context';

/** Chêne des portes, et fer forgé de leurs ferrures. */
const DOOR_WOOD_COLOR = '#6b4a2f';
const DOOR_PLANKS = 5;
const IRON_COLOR = '#2a2a2e';
const IRON_MATERIAL = { metalness: 0.6, roughness: 0.5 };
/** Rideaux : lin, garance, pastel, vert, ocre. */
const CURTAINS = ['#d8cdb4', '#8a3434', '#3d5a80', '#56704a', '#b8893f'];
const CLOTH_MATERIAL = { roughness: 1 };

/** Opacité des vitres : assez faible pour voir l'intérieur depuis la rue, de jour comme de nuit. */
export const WINDOW_GLASS_OPACITY = 0.3;

export function wallWindowCellParts(ctx: CellContext): Part[] {
  const { cell, radii, settings } = ctx;
  const { windowStoneRoughness } = settings;

  const baseColor = settings.wallBaseColor;
  // Verre clair, à peine teinté : l'intérieur (et demain son mobilier) doit
  // se voir depuis la rue. Le soir, la lumière vient de la pièce elle-même
  // (growMaterial.ts) ; la vitre n'ajoute qu'un voile chaud.
  const windowGlassColor = '#c4dbe6';
  const { windowFrameColor } = shades(baseColor, { windowFrameColor: -0.15 });
  const doorFrameColor = windowFrameColor; // même teinte que le cadre de fenêtre
  // Menuiseries en chêne sombre : petits-bois des fenêtres et vantaux des portes.
  const separatorColor = '#4a3626';
  // Teinte du vantail propre à chaque maison (hash des coordonnées, jamais Math.random).
  const doorWood = varyColorBrightness(DOOR_WOOD_COLOR, (((cell.x * 7 + cell.z * 13) % 5) - 2) * 0.03);

  // Radius moyen du bloc, réutilisé par tous les éléments
  const avgRadius = (radii.backLeft + radii.backRight + radii.frontLeft + radii.frontRight) / 4;
  const windowRadius = Math.min(0.025, avgRadius * 0.9);
  const glassRadius = Math.min(0.02, avgRadius * 0.8);

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
  // (le mur d'une cheminée, `ctx.fireplaceFace`, reste plein).
  const NOMINAL_WIDTH: Record<OpeningKind, number> = { door: 0.48, slit: 0.14, window: 0.6 };
  const openings: OpeningSpec[] = [...openingKindsOf(ctx, ctx.fireplaceFace)].map(([face, kind]) => ({
    face,
    kind,
    scale: openingScale(face, NOMINAL_WIDTH[kind]),
  }));

  // Coque creuse percée de ses ouvertures : fenêtres, porte et meurtrières
  // traversent réellement le mur ; vitres et vantaux se logent dans l'épaisseur.
  const parts: Part[] = shellParts(ctx, baseColor, openings);
  /** Profondeur (z local de face) du milieu de l'épaisseur du mur. */
  const revealZ = 0.5 - WALL_T / 2;

  // ── Parement de pierre ─────────────────────────────────────────────────
  // De vraies pierres en saillie (masonryParts.ts), découpées au ras des
  // cadres : fenêtre, porte et son seuil, meurtrière.
  const openingHoles = (kind: OpeningKind, scale: number): MasonryHole[] => {
    if (kind === 'window') return [{ t0: -0.3 * scale, t1: 0.3 * scale, y0: -0.25, y1: 0.25 }];
    if (kind === 'slit') return [{ t0: -0.07 * scale, t1: 0.07 * scale, y0: -0.2, y1: 0.2 }];
    const door = OPENING_SIZES.door;
    return [
      { t0: -0.24 * scale, t1: 0.24 * scale, y0: -0.5, y1: door.y + (door.h + 0.08) / 2 },
      { t0: -0.25 * scale, t1: 0.25 * scale, y0: -0.5, y1: -0.47 },
    ];
  };
  parts.push(
    ...masonryParts(
      ctx,
      masonryFacesOf(ctx.lookup, cell).map((face) => {
        const opening = openings.find((o) => o.face === face);
        return { face, holes: opening ? openingHoles(opening.kind, opening.scale) : [] };
      }),
      baseColor,
      windowStoneRoughness,
    ),
  );

  // ── Rideaux ────────────────────────────────────────────────────────────
  // Côté pièce, tirés de part et d'autre de la fenêtre, sous une tringle :
  // le premier pli mord de 4 cm sur le jour (sans lui, le mur les cache
  // entièrement depuis la rue), le reste de la baie reste dégagé. Deux plis
  // par pan ; une teinte par maison. Éclairés par la pièce (`room`).
  const curtainColor = CURTAINS[Math.abs(cell.x * 3 + cell.z * 5 + cell.y) % CURTAINS.length];
  const curtainParts = (faceRot: ReturnType<typeof xform>, scale: number): Part[] => {
    const win = OPENING_SIZES.window;
    const edge = (win.w * scale) / 2;
    const z = 0.5 - WALL_T - 0.008;
    const dropH = win.h + 0.05;
    const dropY = win.y + 0.015;
    const out: Part[] = [
      part(
        boxGeo(edge * 2 + 0.12, 0.01, 0.01),
        IRON_COLOR,
        IRON_MATERIAL,
        mul(faceRot, xform([0, win.y + win.h / 2 + 0.035, z])),
      ),
    ];
    for (const side of [-1, 1]) {
      out.push(
        part(
          boxGeo(0.045, dropH, 0.01),
          curtainColor,
          CLOTH_MATERIAL,
          mul(faceRot, xform([side * (edge - 0.018), dropY, z])),
        ),
        part(
          boxGeo(0.04, dropH, 0.006),
          varyColorBrightness(curtainColor, -0.12),
          CLOTH_MATERIAL,
          mul(faceRot, xform([side * (edge + 0.024), dropY, z + 0.002])),
        ),
      );
    }
    return asInterior('room', out);
  };

  // ── Fenêtre ────────────────────────────────────────────────────────────
  const windowParts = (rotation: number, scale: number): Part[] => {
    const faceRot = xform([0, 0, 0], [0, rotation, 0]);
    return [
      ...(ctx.hollow ? curtainParts(faceRot, scale) : []),
      // Cadre percé sur la face extérieure, son jour aligné sur l'ouverture de la coque
      part(
        frameWithHoleGeo(0.6 * scale, 0.5, windowRadius, 0.54 * scale, 0.44, glassRadius, 0.02),
        windowFrameColor,
        { roughness: 0.85 },
        mul(faceRot, xform([0, 0, 0.5])),
      ),
      // Vitre transparente, en retrait dans l'épaisseur du mur (tableau visible)
      part(
        roundedBoxGeo(0.54 * scale, 0.44, 0.02, glassRadius, 4),
        windowGlassColor,
        { roughness: 0.1, metalness: 0, transparent: true, opacity: WINDOW_GLASS_OPACITY, glow: true },
        mul(faceRot, xform([0, 0, revealZ])),
      ),
      // Séparateurs horizontal et vertical, juste devant la vitre
      part(
        boxGeo(0.54 * scale, 0.05, 0.019),
        separatorColor,
        { roughness: 1 },
        mul(faceRot, xform([0, 0, revealZ + 0.015])),
      ),
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
      part(
        frameWithHoleGeo(0.48 * scale, door.h + 0.08, doorFrameRadius, door.w * scale, door.h, doorPanelRadius, 0.03),
        doorFrameColor,
        { roughness: 0.88 },
        mul(faceRot, xform([0, door.y, 0.502])),
      ),
      // Vantail logé dans l'épaisseur du mur : un fond sombre (il se voit dans
      // les joints) et des planches verticales, de teintes légèrement inégales.
      part(
        boxGeo(door.w * scale, door.h, 0.03),
        varyColorBrightness(doorWood, -0.12),
        { roughness: 0.95 },
        mul(faceRot, xform([0, door.y, panelZ])),
      ),
      ...Array.from({ length: DOOR_PLANKS }, (_, i) => {
        const plankW = (door.w * scale) / DOOR_PLANKS;
        return part(
          boxGeo(plankW - 0.008, door.h - 0.01, 0.014),
          varyColorBrightness(doorWood, ((i * 3 + cell.x + cell.z) % 3) * 0.035 - 0.035),
          { roughness: 0.9 },
          mul(faceRot, xform([(i - (DOOR_PLANKS - 1) / 2) * plankW, door.y, panelZ + 0.02])),
        );
      }),
      // Pentures en fer forgé, côté gonds, et anneau de tirage.
      ...[-0.22, 0.22].map((dy) =>
        part(
          boxGeo(door.w * scale * 0.78, 0.032, 0.008),
          IRON_COLOR,
          IRON_MATERIAL,
          mul(faceRot, xform([-door.w * scale * 0.09, door.y + dy, panelZ + 0.03])),
        ),
      ),
      part(
        torusArcGeo(0.022, 0.005, 5, 10, Math.PI * 2),
        IRON_COLOR,
        IRON_MATERIAL,
        mul(faceRot, xform([0.13 * scale, door.y - 0.03, panelZ + 0.034])),
      ),
      part(
        roundedBoxGeo(0.5 * scale, 0.04, 0.03, thresholdRadius, 4),
        varyColorBrightness(baseColor, -0.18),
        { roughness: 0.94 },
        mul(faceRot, xform([0, -0.49, 0.501])),
      ),
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
      part(
        frameWithHoleGeo(0.14 * scale, 0.4, arrowSlitRadius, slit.w * scale, slit.h, arrowSlitInnerRadius, 0.02),
        '#3a2a1a',
        { roughness: 0.95 },
        mul(faceRot, xform([0, 0, 0.505])),
      ),
      // Fond lumineux au revers du mur : la fente traverse toute l'épaisseur
      part(
        roundedBoxGeo(slit.w * scale, slit.h, 0.02, arrowSlitInnerRadius, 4),
        '#0a0a0a',
        { roughness: 0.98, glow: true },
        mul(faceRot, xform([0, 0, 0.5 - WALL_T + 0.012])),
      ),
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
