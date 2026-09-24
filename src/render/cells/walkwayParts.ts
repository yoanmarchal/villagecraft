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
  return shades(wallBaseColor, { stone: -0.05, cornice: -0.14, slit: -0.75 });
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
    part(boxGeo(1, thickness * 0.6, width - 0.01), varyColorBrightness(color, -0.3), { roughness: 1 },
      mul(group, xform([0, bottomY + thickness * 0.3, 0]))),
  ];
  for (let i = 0; i < slabs; i += 1) {
    const x = -0.5 + length * (i + 0.5);
    const shade = varyColorBrightness(color, i % 2 === 0 ? 0 : -0.04);
    parts.push(part(geo, shade, { roughness: 0.88 }, mul(group, xform([x, bottomY + thickness / 2, 0]))));
  }
  return parts;
}

const WALKWAY_H = 0.06;

/**
 * Tablier d'un passage sur une cellule, le long de X local : corniche
 * débordante puis dalles, sans parapet — le dessus d'une arche qui ne
 * touche aucune tour. Base du chemin de ronde crénelé.
 */
export function walkwayDeckParts(
  group: THREE.Matrix4,
  bottomY: number,
  wallBaseColor: string,
  width = 1,
): Part[] {
  const { stone, cornice } = stoneColors(wallBaseColor);
  return [
    part(boxGeo(1.0, 0.03, 1.08), cornice, { roughness: 0.9 }, mul(group, xform([0, bottomY + 0.015, 0]))),
    ...flagstoneParts(group, bottomY + 0.03, width, stone, 2, WALKWAY_H - 0.03),
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
  const { stone, slit } = stoneColors(wallBaseColor);
  const walkwayH = WALKWAY_H;
  const faceZ = 0.5 - MERLON_DEPTH / 2 + 0.02; // léger débord sur le nu du mur
  const parapetY = bottomY + walkwayH + PARAPET_H / 2;
  const merlonY = bottomY + walkwayH + PARAPET_H + merlonH / 2;

  const parts: Part[] = walkwayDeckParts(group, bottomY, wallBaseColor, 2 * faceZ - MERLON_DEPTH);

  const parapetGeo = boxGeo(1.0, PARAPET_H, MERLON_DEPTH);
  const merlonGeo = boxGeo(merlonR * MERLON_WIDTH_FACTOR, merlonH, MERLON_DEPTH);
  // Archère : fente sombre traversant le merlon (visible sur ses deux faces).
  const slitGeo = boxGeo(0.035, merlonH * 0.55, MERLON_DEPTH + 0.006);

  for (const side of [1, -1] as const) {
    const z = side * faceZ;
    parts.push(part(parapetGeo, stone, { roughness: 0.92 }, mul(group, xform([0, parapetY, z]))));
    for (const x of [-0.25, 0.25]) {
      parts.push(
        part(merlonGeo, stone, { roughness: 0.92 }, mul(group, xform([x, merlonY, z]))),
        part(slitGeo, slit, { roughness: 1 }, mul(group, xform([x, merlonY - merlonH * 0.05, z]))),
      );
    }
  }

  return parts;
}
