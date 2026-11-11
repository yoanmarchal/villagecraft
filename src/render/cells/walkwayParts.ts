/**
 * Chemin de ronde dallé : grandes dalles de pierre séparées par des joints,
 * comme sur les courtines et les ponts d'une enceinte. Partagé par les
 * courtines (roofCellParts) et le dessus des arches (archCellParts).
 */

import * as THREE from 'three';
import { shades, varyColorBrightness } from '../../colorPalettes';
import { boxGeo } from '../geometryCache';
import { mul, part, xform, type Part } from '../parts';

const JOINT = 0.014;

/** Profondeur (épaisseur) d'un merlon, perpendiculairement au mur. */
export const MERLON_DEPTH = 0.12;
/** Largeur d'un merlon rapportée au réglage `merlonR` (demi-largeur de référence). */
export const MERLON_WIDTH_FACTOR = 2.5;
/** Hauteur du parapet continu sous les merlons. */
export const PARAPET_H = 0.14;

/** Couleurs de pierre des éléments défensifs, dérivées de la couleur des murs. */
export function stoneColors(wallBaseColor: string) {
  return shades(wallBaseColor, { stone: -0.05, cornice: -0.14 });
}

/**
 * Dalles posées sur y = `bottomY`, le long de X (une cellule, x ∈ [−0.5, 0.5])
 * et larges de `width` selon Z. `group` oriente l'ensemble dans la cellule.
 * Les teintes alternent très légèrement d'une dalle à l'autre.
 */
export function flagstoneParts(
  group: THREE.Matrix4,
  bottomY: number,
  width: number,
  color: string,
  slabs = 2,
  thickness = 0.05,
): Part[] {
  const length = 1 / slabs;
  const geo = boxGeo(length - JOINT, thickness, width);
  const parts: Part[] = [
    // Lit de mortier sombre visible dans les joints.
    part(
      boxGeo(1, thickness * 0.6, width - 0.01),
      varyColorBrightness(color, -0.3),
      { roughness: 1 },
      mul(group, xform([0, bottomY + thickness * 0.3, 0])),
    ),
  ];
  for (let i = 0; i < slabs; i += 1) {
    const x = -0.5 + length * (i + 0.5);
    const shade = varyColorBrightness(color, i % 2 === 0 ? 0 : -0.04);
    parts.push(part(geo, shade, { roughness: 0.88 }, mul(group, xform([x, bottomY + thickness / 2, 0]))));
  }
  return parts;
}

export const WALKWAY_H = 0.06;
/** Épaisseur de la corniche débordante, sous les dalles. */
const CORNICE_H = 0.03;

/**
 * Tablier d'un passage sur une cellule, le long de X local : corniche
 * débordante puis dalles, sans parapet — le dessus d'une arche qui ne
 * touche aucune tour. Base du chemin de ronde crénelé.
 */
export function walkwayDeckParts(group: THREE.Matrix4, bottomY: number, wallBaseColor: string, width = 1): Part[] {
  const { stone, cornice } = stoneColors(wallBaseColor);
  return [
    part(boxGeo(1.0, CORNICE_H, 1.08), cornice, { roughness: 0.9 }, mul(group, xform([0, bottomY + CORNICE_H / 2, 0]))),
    ...flagstoneParts(group, bottomY + CORNICE_H, width, stone, 2, WALKWAY_H - CORNICE_H),
  ];
}

/**
 * Chemin de ronde crénelé sur une cellule, le long de X local : corniche
 * débordante, dalles, parapets continus sur les deux faces et deux merlons
 * par face, percés d'une archère. Le rythme (merlons à ±0.25) se raccorde
 * d'une cellule à l'autre. Partagé par les courtines (posé au pied de la
 * cellule de toit, y = −0.5) et le dessus des arches (y = +0.5).
 */
export function crenellatedWalkwayParts(
  group: THREE.Matrix4,
  bottomY: number,
  { merlonR, merlonH, wallBaseColor }: { merlonR: number; merlonH: number; wallBaseColor: string },
): Part[] {
  const { stone } = stoneColors(wallBaseColor);
  const walkwayH = WALKWAY_H;
  const faceZ = 0.5 - MERLON_DEPTH / 2 + 0.02; // léger débord sur le nu du mur
  const merlonY = bottomY + walkwayH + PARAPET_H + merlonH / 2;

  const parts: Part[] = walkwayDeckParts(group, bottomY, wallBaseColor, 2 * faceZ - MERLON_DEPTH);

  // Le parapet repose sur la corniche, pas sur les dalles : celles-ci
  // s'arrêtent à son nu intérieur, et un parapet posé à hauteur des dalles
  // laissait sous lui une rainure ouverte de la hauteur du dallage.
  // Côté chemin de ronde, il dépasse toujours de PARAPET_H.
  const parapetH = PARAPET_H + walkwayH - CORNICE_H;
  const parapetY = bottomY + CORNICE_H + parapetH / 2;
  const parapetGeo = boxGeo(1.0, +parapetH.toFixed(4), MERLON_DEPTH);

  for (const side of [1, -1] as const) {
    const z = side * faceZ;
    parts.push(part(parapetGeo, stone, { roughness: 0.92, masonry: true }, mul(group, xform([0, parapetY, z]))));
    for (const x of [-0.25, 0.25]) {
      parts.push(
        ...piercedMerlonParts(mul(group, xform([x, merlonY, z])), merlonR * MERLON_WIDTH_FACTOR, merlonH, stone),
      );
    }
  }

  return parts;
}

/** Largeur de l'archère percée dans un merlon. */
export const MERLON_SLIT_W = 0.035;

/**
 * Merlon (centré sur `matrix`, largeur `w` selon X, hauteur `h`) percé d'une
 * archère qui le traverse de part en part : quatre blocs autour d'une vraie
 * fente — on voit et la lumière passe au travers, au lieu d'un pavé sombre
 * collé dans un merlon plein.
 */
function piercedMerlonParts(matrix: THREE.Matrix4, w: number, h: number, stone: string): Part[] {
  const slitH = h * 0.55;
  const slitY = -h * 0.05; // centre de la fente, un peu sous le milieu
  const sideW = (w - MERLON_SLIT_W) / 2;
  const bottomH = slitY - slitH / 2 + h / 2;
  const topH = h / 2 - slitY - slitH / 2;
  const mat = { roughness: 0.92, masonry: true };
  const sideX = MERLON_SLIT_W / 2 + sideW / 2;
  return [
    part(boxGeo(+sideW.toFixed(4), h, MERLON_DEPTH), stone, mat, mul(matrix, xform([-sideX, 0, 0]))),
    part(boxGeo(+sideW.toFixed(4), h, MERLON_DEPTH), stone, mat, mul(matrix, xform([sideX, 0, 0]))),
    part(
      boxGeo(MERLON_SLIT_W, +bottomH.toFixed(4), MERLON_DEPTH),
      stone,
      mat,
      mul(matrix, xform([0, -h / 2 + bottomH / 2, 0])),
    ),
    part(
      boxGeo(MERLON_SLIT_W, +topH.toFixed(4), MERLON_DEPTH),
      stone,
      mat,
      mul(matrix, xform([0, h / 2 - topH / 2, 0])),
    ),
  ];
}
