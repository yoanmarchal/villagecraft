/**
 * Toit — ex-RoofCell, porté en builder de parts.
 * Cas 1 : tour isolée → coiffe (bandeau, merlons, flèche) épousant le contour du mur.
 * Cas 2 : toit pentu à deux pans, faîtage le long de l'axe des voisins.
 */

import {
  getRoofConfig,
  scaleCornerRadii,
  getRoundedRectContourPoints,
  sampleContourPerimeter,
} from '../../utils/cellUtils';
import { shades } from '../../colorPalettes';
import { boxGeo, cylinderGeo, gableGeo, shapedBoxGeo, sphereGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import type { CellContext } from './context';
import { useControlStore } from '../../store/controlStore';

// ── Constantes géométriques (espace local cellule : Y=0 centre, ±0.5 bords) ──
const RUN = 0.5;                                      // course horizontale = demi-cellule
const PANEL_LEN = 1.08;                               // longueur de pan le long du faîtage
const PANEL_T = 0.055;                                // épaisseur de pan

// Décalages Z des liteaux (4 rangées de tuiles le long du faîtage)
const RIB_OFFSETS = [-0.40, -0.13, 0.13, 0.40];

export function roofCellParts(ctx: CellContext): Part[] {
  const { cell, lookup, radii, isIsolated } = ctx;

  // ── Constantes géométriques pilotées par le store (avant-toit/faîtage/tour) ──
  const { eaveY: EAVE_Y, ridgeY: RIDGE_Y, towerR: TOWER_R } = useControlStore.getState();
  const RISE = RIDGE_Y - EAVE_Y;
  const SLOPE_LEN = Math.sqrt(RISE * RISE + RUN * RUN);
  const SLOPE_ANG = Math.atan2(RISE, RUN);
  const CENTER_Y = (EAVE_Y + RIDGE_Y) / 2;

  const roofColor = cell.color ?? '#c85a3f';
  const { colorDark, colorLight } = shades(roofColor, { colorDark: -0.18, colorLight: 0.07 });

  // ════════════════════════════════════════════════════════════════════════
  // CAS 1 — Tour isolée : coiffe posée directement sur le mur, suivant le
  // même contour que celui-ci (pas de parapet séparé — voir historique).
  // ════════════════════════════════════════════════════════════════════════
  if (isIsolated) {
    const BASE_Y = -0.50;
    const parts: Part[] = [];

    // ── Bandeau de couronnement ──
    const COPING_R = TOWER_R + 0.06;
    const CROWN_R = COPING_R + 0.02;
    const crownRadii = scaleCornerRadii(radii, CROWN_R / TOWER_R);
    parts.push(part(shapedBoxGeo(CROWN_R * 2, 0.04, CROWN_R * 2, crownRadii), colorDark,
      { roughness: 0.88 }, xform([0, BASE_Y + 0.02, 0])));

    // ── Merlons répartis sur le contour réel du mur ──
    const { merlonCount: MERLON_COUNT, merlonR: MERLON_R, merlonH: MERLON_H } = useControlStore.getState();
    const merlonY = BASE_Y + MERLON_H / 2;
    const merlonContour = getRoundedRectContourPoints(TOWER_R, TOWER_R, radii);
    const merlonGeo = cylinderGeo(MERLON_R, MERLON_R * 1.1, MERLON_H, 10);
    for (let i = 0; i < MERLON_COUNT; i++) {
      const { x: mx, z: mz } = sampleContourPerimeter(merlonContour, i / MERLON_COUNT);
      parts.push(part(merlonGeo, roofColor, { roughness: 0.87 }, xform([mx, merlonY, mz])));
    }

    // ── Bague de base de flèche ──
    const SPIRE_BASE_R = TOWER_R - 0.06;
    const { spireH: SPIRE_H } = useControlStore.getState();
    const SPIRE_RING_R = SPIRE_BASE_R + 0.08;
    const spireRingRadii = scaleCornerRadii(radii, SPIRE_RING_R / TOWER_R);
    parts.push(part(shapedBoxGeo(SPIRE_RING_R * 2, 0.10, SPIRE_RING_R * 2, spireRingRadii), colorDark,
      { roughness: 0.88 }, xform([0, BASE_Y + 0.09, 0])));

    // ── Flèche : tranches empilées qui se resserrent, même contour ──
    const SPIRE_SEGMENTS = 8;
    for (let i = 0; i < SPIRE_SEGMENTS; i++) {
      const t0 = i / SPIRE_SEGMENTS;
      const t1 = (i + 1) / SPIRE_SEGMENTS;
      const segH = SPIRE_H / SPIRE_SEGMENTS;
      const rMid = Math.max(SPIRE_BASE_R * (1 - (t0 + t1) / 2), 0.02);
      const segRadii = scaleCornerRadii(radii, rMid / TOWER_R);
      const segY = BASE_Y + 0.14 + t0 * SPIRE_H + segH / 2;
      parts.push(part(shapedBoxGeo(rMid * 2, segH, rMid * 2, segRadii), colorDark,
        { roughness: 0.82 }, xform([0, segY, 0])));
    }

    // ── Anneaux de tuiles sur la flèche ──
    for (const t of [0.18, 0.36, 0.54, 0.72]) {
      const bandR = Math.max(SPIRE_BASE_R * (1 - t), 0.02) + 0.015;
      const bandY = BASE_Y + 0.14 + t * SPIRE_H;
      const bandRadii = scaleCornerRadii(radii, bandR / TOWER_R);
      parts.push(part(shapedBoxGeo(bandR * 2, 0.03, bandR * 2, bandRadii), roofColor,
        { roughness: 0.88 }, xform([0, bandY, 0])));
    }

    // ── Épi doré ──
    parts.push(part(sphereGeo(0.06, 12, 12), '#d4a04f', { metalness: 0.75, roughness: 0.15 },
      xform([0, BASE_Y + 0.14 + SPIRE_H + 0.06, 0])));

    return parts;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CAS 2 — Toit pentu. Faîtage le long du Z local ; rotation 90° si axe X.
  // Pignons aux extrémités locales ±Z sans voisin.
  // ════════════════════════════════════════════════════════════════════════
  const roofConfig = getRoofConfig(lookup, cell);
  const yRot = roofConfig.axis === 'x' ? Math.PI / 2 : 0;
  const G = xform([0, 0, 0], [0, yRot, 0]); // groupe racine

  const needGablePos = roofConfig.axis === 'z' ? !roofConfig.hasFront : !roofConfig.hasRight;
  const needGableNeg = roofConfig.axis === 'z' ? !roofConfig.hasBack : !roofConfig.hasLeft;

  const parts: Part[] = [];
  const panelGeo = boxGeo(SLOPE_LEN, PANEL_T, PANEL_LEN);
  const ribGeo = boxGeo(SLOPE_LEN, 0.022, 0.042);

  // ── Pans droit (+X) et gauche (−X) avec liteaux ──
  for (const side of [1, -1] as const) {
    const panelM = mul(G, xform([side * RUN / 2, CENTER_Y, 0], [0, 0, -side * SLOPE_ANG]));
    parts.push(part(panelGeo, side === 1 ? roofColor : colorLight, { roughness: 0.84 }, panelM));
    for (const z of RIB_OFFSETS) {
      parts.push(part(ribGeo, colorDark, { roughness: 0.92 },
        mul(panelM, xform([0, PANEL_T / 2 + 0.012, z]))));
    }
  }

  // ── Faîtage + embouts ──
  parts.push(part(boxGeo(0.14, 0.056, PANEL_LEN + 0.02), colorDark, { roughness: 0.89 },
    mul(G, xform([0, RIDGE_Y + 0.028, 0]))));
  if (needGablePos) {
    parts.push(part(boxGeo(0.14, 0.056, 0.06), colorDark, { roughness: 0.89 },
      mul(G, xform([0, RIDGE_Y + 0.028, PANEL_LEN / 2 + 0.01]))));
  }
  if (needGableNeg) {
    parts.push(part(boxGeo(0.14, 0.056, 0.06), colorDark, { roughness: 0.89 },
      mul(G, xform([0, RIDGE_Y + 0.028, -(PANEL_LEN / 2 + 0.01)]))));
  }

  // ── Bandeaux d'égout (fascias) ──
  const eaveGeo = boxGeo(0.044, 0.064, PANEL_LEN + 0.06);
  parts.push(
    part(eaveGeo, colorDark, { roughness: 0.89 }, mul(G, xform([0.518, EAVE_Y - 0.020, 0]))),
    part(eaveGeo, colorDark, { roughness: 0.89 }, mul(G, xform([-0.518, EAVE_Y - 0.020, 0]))),
  );

  // ── Pignons ──
  const bargeGeo = boxGeo(SLOPE_LEN, 0.04, 0.05);
  const gableBottomGeo = boxGeo(1.06, 0.064, 0.044);
  const addGable = (sign: 1 | -1) => {
    const zEnd = sign * 0.502;
    parts.push(
      // Remplissage triangulaire
      part(gableGeo(EAVE_Y, RIDGE_Y), roofColor, { roughness: 0.88 },
        mul(G, xform([0, 0, sign * 0.466], [0, sign === 1 ? 0 : Math.PI, 0]))),
      // Rives (barge boards) le long des pentes
      part(bargeGeo, colorDark, { roughness: 0.91 },
        mul(G, xform([RUN / 2, CENTER_Y, zEnd], [0, 0, -SLOPE_ANG]))),
      part(bargeGeo, colorDark, { roughness: 0.91 },
        mul(G, xform([-RUN / 2, CENTER_Y, zEnd], [0, 0, SLOPE_ANG]))),
      // Bandeau bas de pignon
      part(gableBottomGeo, colorDark, { roughness: 0.89 },
        mul(G, xform([0, EAVE_Y - 0.020, zEnd]))),
    );
  };
  if (needGablePos) addGable(1);
  if (needGableNeg) addGable(-1);

  // ── Cheminée (déterministe : ~33% des cellules) ──
  if ((cell.x + cell.z) % 3 === 0) {
    const sideX = cell.x % 2 === 0 ? 0.14 : -0.14;
    const C = mul(G, xform([sideX, RIDGE_Y - 0.06, 0.06]));
    parts.push(
      part(boxGeo(0.14, 0.46, 0.14), '#a09080', { roughness: 0.93 }, C.clone()),
      part(boxGeo(0.19, 0.04, 0.19), '#7a6a5a', { roughness: 0.91 }, mul(C, xform([0, 0.25, 0]))),
      part(cylinderGeo(0.034, 0.042, 0.09, 8), '#a05a42', { roughness: 0.82 }, mul(C, xform([0, 0.31, 0]))),
    );
  }

  return parts;
}
