/**
 * Décorations d'angle communes (quoins) + protection associée.
 * Ex-cornerDecorations.tsx, porté en builders de parts. La détection de
 * coin exposé est mutualisée via `isCornerExposed` (cellUtils).
 */

import type { GridCell } from '../../types';
import type { CellLookup } from '../../utils/cellUtils';
import { CELL_CORNERS, isCornerExposed } from '../../utils/cellUtils';
import { varyColorBrightness } from '../../colorPalettes';
import { roundedBoxGeo } from '../geometryCache';
import { part, xform, type Part } from '../parts';
import type { CellContext } from './context';
import { useControlStore } from '../../store/controlStore';

/**
 * True si une pierre placée en (x ± w/2) sur `face` empiéterait sur un quoin.
 * Utilisé par les zones protégées des stone patches.
 */
export function isQuoinProtected(
  cell: GridCell,
  lookup: CellLookup,
  isIsolated: boolean,
  face: string,
  x: number,
  w: number,
): boolean {
  if (isIsolated) return false;

  const { quoinMargin: margin } = useControlStore.getState();
  const isNearLeft = x - w / 2 < -0.5 + margin;
  const isNearRight = x + w / 2 > 0.5 - margin;
  if (!isNearLeft && !isNearRight) return false;

  const checkEdge = (isLeftEdge: boolean): boolean => {
    let dx = 0;
    let dz = 0;

    if (face === 'front') { dz = 1; dx = isLeftEdge ? -1 : 1; }
    else if (face === 'back') { dz = -1; dx = isLeftEdge ? -1 : 1; }
    else if (face === 'left') { dx = -1; dz = isLeftEdge ? -1 : 1; }
    else if (face === 'right') { dx = 1; dz = isLeftEdge ? -1 : 1; }

    return isCornerExposed(lookup, cell, dx, dz);
  };

  if (isNearLeft && checkEdge(true)) return true;
  if (isNearRight && checkEdge(false)) return true;
  return false;
}

// En dessous de ce rayon, le coin est considéré "carré" : motif de
// maçonnerie chaînée d'origine (2 blocs alternés le long de X/Z).
const SHARP_CORNER_RADIUS = 0.2;

/**
 * Pierres d'angle sur chaque coin exposé non supprimé.
 *
 * Coin carré (rayon < SHARP_CORNER_RADIUS) : motif de maçonnerie chaînée —
 * deux blocs plats alternés par niveau, plantés au coin.
 *
 * Coin arrondi (rayon ≥ SHARP_CORNER_RADIUS) : les blocs plats ne
 * correspondent plus à rien (le mur n'a plus d'arête à habiller) — on pose
 * à la place plusieurs petites pierres échantillonnées le long de l'arc
 * réel du coin, chacune tournée sur la tangente locale pour épouser la
 * courbure, exactement comme les fenêtres/pierres apparentes se projettent
 * sur un mur arrondi via `projectOnFace`.
 */
export function quoinParts(ctx: CellContext, baseColor: string): Part[] {
  const { cell, lookup, isIsolated, radii } = ctx;

  // Les tours n'ont pas de quoins
  if (isIsolated) return [];

  const { quoinRoughness, quoinMargin } = useControlStore.getState();
  const quoinColor = varyColorBrightness(baseColor, -0.12);
  const mat = { roughness: quoinRoughness };
  const parts: Part[] = [];
  const protrusion = 0.01;
  const levels = [-0.32, 0, 0.32];

  // Niveaux 0 et 2 : longs le long de X ; niveau 1 : long le long de Z
  const w1x = 0.16;
  const w1z = 0.08;
  const w2x = 0.08;
  const w2z = 0.16;
  const geoSquareA = roundedBoxGeo(w1x, 0.18, w1z, 0.01, 2);
  const geoSquareB = roundedBoxGeo(w2x, 0.18, w2z, 0.01, 2);

  // Petite pierre utilisée pour habiller un coin arrondi.
  const arcStoneW = 0.09;
  const arcStoneD = 0.06;
  const geoArcStone = roundedBoxGeo(arcStoneW, 0.18, arcStoneD, 0.01, 2);

  // Budget latéral (retrait max depuis le bord de face) que le centre d'une
  // pierre d'arc peut occuper sans que son propre encombrement (± moitié de
  // sa largeur) ne déborde de la zone protégée déclarée par `isQuoinProtected`
  // (qui exclut tout ce qui est à moins de `quoinMargin` du bord). Sans ce
  // plafond, un rayon élevé étale les pierres bien au-delà de cette zone et
  // elles finissent par chevaucher fenêtres/bandes/autres pierres.
  const arcMarginBudget = Math.max(0, quoinMargin - arcStoneW / 2);

  for (const { dx, dz, corner } of CELL_CORNERS) {
    if (!isCornerExposed(lookup, cell, dx, dz)) continue;

    const r = radii[corner];

    if (r < SHARP_CORNER_RADIUS) {
      const posX1 = dx * (0.5 + protrusion - w1x / 2);
      const posZ1 = dz * (0.5 + protrusion - w1z / 2);
      const posX2 = dx * (0.5 + protrusion - w2x / 2);
      const posZ2 = dz * (0.5 + protrusion - w2z / 2);

      parts.push(
        part(geoSquareA, quoinColor, mat, xform([posX1, levels[0], posZ1])),
        part(geoSquareB, quoinColor, mat, xform([posX2, levels[1], posZ2])),
        part(geoSquareA, quoinColor, mat, xform([posX1, levels[2], posZ1])),
      );
      continue;
    }

    // Centre de l'arc du coin (même calcul que shapedBoxGeo/getCornerRadii) :
    // le coin est un quart de cercle de rayon r centré à (0.5-r, 0.5-r)
    // (signé par dx/dz), reliant le bord plat de la face `dx` à celui de `dz`.
    const centerX = dx * (0.5 - r);
    const centerZ = dz * (0.5 - r);

    // Le retrait d'un point de l'arc dépend de phi sur DEUX faces à la fois :
    // - vers la face `dz` (ex. "front") : r - (r+protrusion)*cos(phi), qui
    //   grandit avec phi → il faut plafonner phi PAR LE HAUT.
    // - vers la face `dx` (ex. "left"/"right") : r - (r+protrusion)*sin(phi),
    //   qui grandit quand phi diminue → il faut plafonner phi PAR LE BAS.
    // Négliger l'un des deux (comme la première version le faisait pour la
    // borne basse) laisse les pierres plonger loin dans la face adjacente à
    // rayon élevé, exactement la zone qui chevauchait les fenêtres/pierres.
    const phiMinFracDefault = 0.18;
    const phiMaxFracDefault = 0.82;
    let phiMinFrac = phiMinFracDefault;
    let phiMaxFrac = phiMaxFracDefault;
    if (r > arcMarginBudget) {
      const v = Math.min(1, Math.max(-1, (r - arcMarginBudget) / (r + protrusion)));
      const phiHiCapFrac = Math.acos(v) / (Math.PI / 2);
      const phiLoCapFrac = Math.asin(v) / (Math.PI / 2);
      phiMaxFrac = Math.min(phiMaxFracDefault, phiHiCapFrac);
      phiMinFrac = Math.max(phiMinFracDefault, phiLoCapFrac);
    }

    // Une seule pierre par niveau (3 au total, comme le motif "coin carré"),
    // positionnée au milieu de la plage sûre de l'arc — symétrique entre les
    // deux faces adjacentes. Sa position (donc l'angle qu'elle fait avec le
    // coin) suit le rayon, c'est cette dérive qui donne l'effet "épouse la
    // courbe" ; on n'a plus besoin d'en empiler plusieurs le long de l'arc.
    const phi = ((phiMinFrac + phiMaxFrac) / 2) * (Math.PI / 2);
    const nx = dx * Math.cos(phi);
    const nz = dz * Math.sin(phi);
    const posX = centerX + (r + protrusion) * nx;
    const posZ = centerZ + (r + protrusion) * nz;
    // Même convention que FACE_ROTATION_Y : aligne l'axe local +Z de la
    // pierre (sa face avant) sur la normale sortante (nx, nz).
    const rotY = Math.atan2(nx, nz);

    for (const y of levels) {
      parts.push(part(geoArcStone, quoinColor, mat, xform([posX, y, posZ], [0, rotY, 0])));
    }
  }

  return parts;
}
