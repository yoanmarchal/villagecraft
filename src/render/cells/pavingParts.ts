/**
 * Sol pavé : les cases vides au sol qui touchent un bâtiment (ruelles, rues,
 * passages sous les arches) reçoivent des pavés ; plus loin, l'herbe du
 * socle reste visible. Calculé à chaque reconstruction, comme le reste.
 */

import { hasOccupiedCell, type CellLookup } from '../../utils/cellUtils';
import { boxGeo, COBBLE_TILE_VARIANTS, cobbleTileGeo } from '../geometryCache';
import { part, xform, type Part } from '../parts';

const BEDDING_COLOR = '#857c6f'; // lit de sable/mortier visible entre les pavés
const COBBLE_COLOR = '#a19b90';
const BEDDING_H = 0.02;

export function pavingParts(
  lookup: CellLookup,
  { width, depth }: { width: number; depth: number },
): Array<{ x: number; z: number; parts: Part[] }> {
  const builtAt = (x: number, z: number) => hasOccupiedCell(lookup, x, 0, z);
  const result: Array<{ x: number; z: number; parts: Part[] }> = [];

  for (let x = 0; x < width; x += 1) {
    for (let z = 0; z < depth; z += 1) {
      if (builtAt(x, z)) continue;

      // Sous une arche (rue large : la case du milieu ne touche aucun bâtiment).
      let nearBuilding = hasOccupiedCell(lookup, x, 1, z);
      for (let dx = -1; dx <= 1 && !nearBuilding; dx += 1) {
        for (let dz = -1; dz <= 1 && !nearBuilding; dz += 1) {
          nearBuilding = builtAt(x + dx, z + dz);
        }
      }
      if (!nearBuilding) continue;

      // Variante et quart de tour tirés de la position : pas de motif répété à l'identique.
      const hash = (Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0;
      const variant = hash % COBBLE_TILE_VARIANTS;
      const turn = ((hash >>> 8) % 4) * (Math.PI / 2);

      result.push({
        x,
        z,
        parts: [
          part(boxGeo(1, BEDDING_H, 1), BEDDING_COLOR, { roughness: 1 }, xform([0, BEDDING_H / 2, 0])),
          part(cobbleTileGeo(variant), COBBLE_COLOR, { roughness: 0.95 }, xform([0, BEDDING_H, 0], [0, turn, 0])),
        ],
      });
    }
  }

  return result;
}
