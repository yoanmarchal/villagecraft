/**
 * Chandeliers des pièces. Une pièce = cellules creuses d'un même étage
 * reliées par leurs côtés `open` (voir getHollowShape : deux cellules
 * creuses voisines ne gardent pas de mur entre elles). Un chandelier par
 * cellule faisait une forêt de chandeliers dans une grande salle ; un seul
 * laissait ses bouts dans le noir.
 *
 * Règle : le premier chandelier va dans la cellule la plus centrale ; on en
 * ajoute un, dans l'ordre de centralité, pour toute cellule à plus de
 * `LAMP_REACH` cases (Chebyshev) de tous les autres — jusqu'à 5 × 5 une pièce
 * n'en a qu'un. Chaque cellule est ensuite éclairée par le plus proche (voir
 * growMaterial.ts). Ne dépend que de la forme du village, pas de l'ordre des
 * cellules.
 */

import type { GridCell } from '../types';
import { getCell, isHollowType, type CellLookup } from './cellUtils';

/** Portée (en cases, distance de Chebyshev) d'un chandelier avant d'en ajouter un autre. */
export const LAMP_REACH = 2;

/** Décalage (en cases) de la cellule vers celle qui porte le chandelier qui l'éclaire. */
export interface RoomLamp {
  dx: number;
  dz: number;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const isHollow = (cell: GridCell | null): cell is GridCell => !!cell?.isOccupied && isHollowType(cell.type);

export function assignRoomLamps(cells: GridCell[], lookup: CellLookup): Map<GridCell, RoomLamp> {
  const lamps = new Map<GridCell, RoomLamp>();
  const visited = new Set<GridCell>();

  for (const start of cells) {
    if (visited.has(start) || !isHollow(start)) continue;

    // Pièce : remplissage par diffusion à l'étage de `start`.
    const room: GridCell[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cell = queue.pop()!;
      room.push(cell);
      for (const [dx, dz] of NEIGHBOURS) {
        const next = getCell(lookup, cell.x + dx, cell.y, cell.z + dz);
        if (isHollow(next) && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    const cx = room.reduce((sum, c) => sum + c.x, 0) / room.length;
    const cz = room.reduce((sum, c) => sum + c.z, 0) / room.length;
    const byCentrality = [...room].sort(
      (a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - ((b.x - cx) ** 2 + (b.z - cz) ** 2) || a.x - b.x || a.z - b.z,
    );

    const holders: GridCell[] = [];
    for (const cell of byCentrality) {
      if (holders.every((h) => Math.max(Math.abs(h.x - cell.x), Math.abs(h.z - cell.z)) > LAMP_REACH)) {
        holders.push(cell);
      }
    }

    for (const cell of room) {
      let best = holders[0];
      let bestDistance = Infinity;
      for (const holder of holders) {
        const distance = (holder.x - cell.x) ** 2 + (holder.z - cell.z) ** 2;
        if (distance < bestDistance) {
          best = holder;
          bestDistance = distance;
        }
      }
      lamps.set(cell, { dx: best.x - cell.x, dz: best.z - cell.z });
    }
  }

  return lamps;
}
