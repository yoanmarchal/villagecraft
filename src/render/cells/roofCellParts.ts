/**
 * Toit — ex-RoofCell, porté en builder de parts.
 * Cas 1 : tour isolée → toiture en ardoise à coyau épousant le contour du mur
 *         (ou, pour ~1 tour sur 3, couronnement crénelé sans toit).
 * Cas 1 bis : courtine entre deux tours → parapet crénelé + chemin de ronde.
 * Cas 2 : toit pentu à deux pans, faîtage le long de l'axe des voisins.
 */

import {
  getRoofConfig,
  getRoundedRectContourPoints,
  hasOccupiedCell,
  sampleContourPerimeter,
  scaleCornerRadii,
} from '../../utils/cellUtils';
import type { GridCell } from '../../types';
import { shades, varyColorBrightness } from '../../colorPalettes';
import {
  boxGeo,
  cylinderGeo,
  gableGeo,
  shapedBoxGeo,
  sphereGeo,
  spireBandGeo,
  towerSoffitGeo,
} from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';
import type { RenderSettings } from '../renderSettings';
import type { CellContext } from './context';
import {
  crenellatedWalkwayParts,
  MERLON_DEPTH,
  MERLON_WIDTH_FACTOR,
  PARAPET_H,
  stoneColors,
} from './walkwayParts';

// ── Constantes géométriques (espace local cellule : Y=0 centre, ±0.5 bords) ──
const RUN = 0.5;                                      // course horizontale = demi-cellule
const PANEL_LEN = 1.08;                               // longueur de pan le long du faîtage
const PANEL_T = 0.055;                                // épaisseur de pan

// Décalages Z des liteaux (4 rangées de tuiles le long du faîtage)
const RIB_OFFSETS = [-0.40, -0.13, 0.13, 0.40];

export function roofCellParts(ctx: CellContext): Part[] {
  const { cell, lookup, isIsolated, settings } = ctx;

  // CAS 1 — Tour isolée : toiture en ardoise (voir towerRoofParts).
  if (isIsolated) {
    return isCrenellatedTower(cell) ? crenellatedTowerParts(ctx) : towerRoofParts(ctx);
  }

  // CAS 1 bis — Courtine entre deux tours : parapet crénelé et chemin de ronde.
  if (ctx.isRampart) {
    return rampartParts(ctx);
  }

  // CAS 2 — Toit pentu à deux pans, faîtage le long de l'axe des voisins.
  const roofConfig = getRoofConfig(lookup, cell);
  return gableRoofParts(settings, {
    axis: roofConfig.axis,
    gablePos: roofConfig.axis === 'z' ? !roofConfig.hasFront : !roofConfig.hasRight,
    gableNeg: roofConfig.axis === 'z' ? !roofConfig.hasBack : !roofConfig.hasLeft,
    // Cheminée déterministe : ~33 % des cellules.
    chimney: (cell.x + cell.z) % 3 === 0 ? (cell.x % 2 === 0 ? 0.14 : -0.14) : null,
  });
}

/**
 * Toit pentu à deux pans sur une cellule, faîtage selon `axis` (monde),
 * pignons aux extrémités ±axe demandées (`gablePos` = côté +axe). `baseY`
 * décale le toit verticalement (0 : égout au plancher de la cellule).
 * Partagé par les toits de maison et le dessus des arches.
 */
export function gableRoofParts(
  settings: RenderSettings,
  { axis, gablePos, gableNeg, chimney = null, baseY = 0 }: {
    axis: 'x' | 'z';
    gablePos: boolean;
    gableNeg: boolean;
    /** Décalage X local de la cheminée, ou null pour aucune. */
    chimney?: number | null;
    baseY?: number;
  },
): Part[] {
  const { ridgeY: RIDGE_Y } = settings;
  // Toujours collé au plancher de la cellule de toit (= haut du bloc du
  // dessous), pas réglable : un toit ne doit jamais flotter au-dessus de son
  // mur ni s'enfoncer dedans. Seule sa taille (RIDGE_Y) reste modifiable.
  const EAVE_Y = -0.5;
  const RISE = RIDGE_Y - EAVE_Y;
  const SLOPE_LEN = Math.sqrt(RISE * RISE + RUN * RUN);
  const SLOPE_ANG = Math.atan2(RISE, RUN);
  const CENTER_Y = (EAVE_Y + RIDGE_Y) / 2;

  const roofColor = settings.roofBaseColor;
  const { colorDark, colorLight } = shades(roofColor, { colorDark: -0.18, colorLight: 0.07 });

  // Faîtage le long du Z local ; rotation 90° si axe X.
  const G = xform([0, baseY, 0], [0, axis === 'x' ? Math.PI / 2 : 0, 0]); // groupe racine
  const needGablePos = gablePos;
  const needGableNeg = gableNeg;

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

  // ── Cheminée ──
  if (chimney !== null) {
    const C = mul(G, xform([chimney, RIDGE_Y - 0.06, 0.06]));
    parts.push(
      part(boxGeo(0.14, 0.46, 0.14), '#a09080', { roughness: 0.93 }, C.clone()),
      part(boxGeo(0.19, 0.04, 0.19), '#7a6a5a', { roughness: 0.91 }, mul(C, xform([0, 0.25, 0]))),
      part(cylinderGeo(0.034, 0.042, 0.09, 8), '#a05a42', { roughness: 0.82 }, mul(C, xform([0, 0.31, 0]))),
    );
  }

  return parts;
}

// ── Toiture de tour ──────────────────────────────────────────────────────────

/** Débord de l'égout au-delà du mur (échelle du contour). */
const EAVE_OVERHANG = 1.2;
/** Hauteur du coyau (partie évasée, moins pentue) au-dessus de l'égout. */
const FLARE_RISE = 0.08;
/** Nombre de rangs d'ardoise, en teintes alternées, sur le cône. */
const SLATE_COURSES = 5;

/**
 * Toiture de tour "en poivrière" façon Carcassonne : corniche de pierre,
 * égout débordant et évasé (coyau), cône d'ardoise raide qui suit le contour
 * de la tour (carré aux coins arrondis → pyramide aux arêtes arrondies,
 * rond → cône), épi métallique au sommet.
 */
function towerRoofParts({ radii, settings }: CellContext): Part[] {
  const { towerR, spireH, spireColor, wallBaseColor } = settings;
  const BASE_Y = -0.5; // pied de la toiture = haut du mur du dessous
  // Les radii sont calculés pour une cellule de demi-côté 0.5.
  const towerRadii = scaleCornerRadii(radii, towerR / 0.5);

  const { slateLight, slateUnder } = shades(spireColor, { slateLight: 0.08, slateUnder: -0.35 });
  const corniceColor = varyColorBrightness(wallBaseColor, -0.14);
  const slate = { roughness: 0.62, metalness: 0.08 };

  const parts: Part[] = [];

  // Corniche de pierre qui reçoit l'égout.
  const corniceScale = 1.06;
  parts.push(
    part(
      shapedBoxGeo(towerR * 2 * corniceScale, 0.05, towerR * 2 * corniceScale, scaleCornerRadii(towerRadii, corniceScale)),
      corniceColor,
      { roughness: 0.9 },
      xform([0, BASE_Y + 0.025, 0]),
    ),
  );

  // Profil de la toiture : anneaux (hauteur, échelle du contour) du bas vers la pointe.
  const eaveY = BASE_Y + 0.05;
  const flareTopY = eaveY + FLARE_RISE;
  const apexY = BASE_Y + spireH;
  const rings: Array<[number, number]> = [
    [eaveY, EAVE_OVERHANG],
    [flareTopY, 1],
  ];
  for (let i = 1; i <= SLATE_COURSES; i += 1) {
    const t = i / SLATE_COURSES;
    rings.push([flareTopY + (apexY - flareTopY) * t, 1 - t]);
  }

  for (let i = 0; i < rings.length - 1; i += 1) {
    const [y0, s0] = rings[i];
    const [y1, s1] = rings[i + 1];
    parts.push(part(spireBandGeo(towerR, towerRadii, y0, s0, y1, s1), i % 2 === 0 ? spireColor : slateLight, slate));
  }

  // Dessous de l'avant-toit, pour qu'il ne soit pas creux vu d'en bas.
  parts.push(part(towerSoffitGeo(towerR, towerRadii, eaveY, EAVE_OVERHANG), slateUnder, { roughness: 0.9 }));

  // Épi : tige métallique fine et petite boule.
  const metal = { roughness: 0.4, metalness: 0.6 };
  parts.push(
    part(cylinderGeo(0.012, 0.016, 0.3, 8), '#3b3f45', metal, xform([0, apexY + 0.12, 0])),
    part(sphereGeo(0.03, 10, 8), '#3b3f45', metal, xform([0, apexY + 0.07, 0])),
  );

  return parts;
}

// ── Créneaux (tours crénelées, courtines) ────────────────────────────────────


/** ~1 tour sur 3, choisie de façon déterministe par sa colonne (stable d'un rendu à l'autre). */
function isCrenellatedTower(cell: GridCell): boolean {
  const hash = Math.imul(cell.x, 73856093) ^ Math.imul(cell.z, 19349663);
  return ((hash >>> 0) % 3) === 0;
}


/**
 * Tour crénelée sans toit : plate-forme débordante (corniche), parapet
 * continu, puis merlons rectangulaires répartis sur le contour réel de la
 * tour et orientés selon sa tangente.
 */
function crenellatedTowerParts({ radii, settings }: CellContext): Part[] {
  const { towerR, merlonCount, merlonR, merlonH, wallBaseColor } = settings;
  const { stone, cornice } = stoneColors(wallBaseColor);
  const BASE_Y = -0.5;
  const towerRadii = scaleCornerRadii(radii, towerR / 0.5);
  const rimScale = 1.05;

  const parts: Part[] = [
    // Corniche débordante + parapet plein (le dessus forme la plate-forme).
    part(
      shapedBoxGeo(towerR * 2 * rimScale, 0.06, towerR * 2 * rimScale, scaleCornerRadii(towerRadii, rimScale)),
      cornice,
      { roughness: 0.9 },
      xform([0, BASE_Y + 0.03, 0]),
    ),
    part(
      shapedBoxGeo(towerR * 2, PARAPET_H, towerR * 2, towerRadii),
      stone,
      { roughness: 0.92 },
      xform([0, BASE_Y + 0.06 + PARAPET_H / 2, 0]),
    ),
  ];

  // Merlons sur le contour, en retrait de leur demi-profondeur. Le contour
  // est échantillonné dans le plan de la shape (z = −y, comme shapedBoxGeo).
  const inset = towerR - MERLON_DEPTH / 2;
  const contour = getRoundedRectContourPoints(inset, inset, scaleCornerRadii(towerRadii, inset / towerR));
  const merlonGeo = boxGeo(merlonR * MERLON_WIDTH_FACTOR, merlonH, MERLON_DEPTH);
  const merlonY = BASE_Y + 0.06 + PARAPET_H + merlonH / 2;

  // Répartition symétrique : autant de merlons par côté, centrés sur le
  // milieu des côtés. Répartis depuis un point quelconque du contour, ils
  // tombaient sur les coins arrondis, tournés à 45° (effet de chevrons), et
  // inégalement d'un côté à l'autre. `merlonCount` est arrondi au multiple de 4.
  const perSide = Math.max(1, Math.round(merlonCount / 4));
  const total = perSide * 4;
  // Le contour commence juste après le milieu du côté gauche (-X) et s'y
  // referme par son dernier segment, rectiligne : ce milieu sert d'origine.
  const perimeter = contour.reduce((sum, [x0, y0], i) => {
    const [x1, y1] = contour[(i + 1) % contour.length];
    return sum + Math.hypot(x1 - x0, y1 - y0);
  }, 0);
  const [lastX, lastY] = contour[contour.length - 1];
  const [firstX, firstY] = contour[0];
  const sideMidpoint = 1 - Math.hypot(firstX - lastX, firstY - lastY) / 2 / perimeter;

  for (let i = 0; i < total; i += 1) {
    const t = sideMidpoint + (i + 0.5) / total;
    const { x, z } = sampleContourPerimeter(contour, t);
    const ahead = sampleContourPerimeter(contour, t + 0.002);
    const behind = sampleContourPerimeter(contour, t - 0.002);
    // Tangente en coordonnées scène (z = −y de la shape).
    const tx = ahead.x - behind.x;
    const tz = -(ahead.z - behind.z);
    parts.push(part(merlonGeo, stone, { roughness: 0.92 }, xform([x, merlonY, -z], [0, Math.atan2(-tz, tx), 0])));
  }

  return parts;
}

/**
 * Sommet de courtine : dalle du chemin de ronde (débordant en corniche des
 * deux côtés), parapets continus sur les deux faces, et deux merlons par
 * case, percés d'une archère. Le rythme (merlons à ±0.25) se raccorde d'une
 * case à l'autre. Conçu le long de X, tourné de 90° si le mur court selon Z.
 */
function rampartParts({ cell, lookup, settings }: CellContext): Part[] {
  const alongX = hasOccupiedCell(lookup, cell.x - 1, cell.y, cell.z) || hasOccupiedCell(lookup, cell.x + 1, cell.y, cell.z);
  const G = xform([0, 0, 0], [0, alongX ? 0 : Math.PI / 2, 0]);

  return crenellatedWalkwayParts(G, -0.5, settings);
}
