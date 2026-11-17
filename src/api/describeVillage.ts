/**
 * Description d'un village pour un agent (API `window.villagecraft`, serveur
 * MCP) : ce qu'il faut pour raisonner sur la grille sans la voir. Pure, sans
 * navigateur ni store.
 */

import type { VillageGrid } from '../villageGrid';
import { getCell, isTowerColumn, makeCellLookup } from '../utils/cellUtils';

export interface BuildingSummary {
  /** Colonnes occupées (x, z) du bâtiment, 4-connexes. */
  columns: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Étages habitables du plus haut point (le bloc du sommet devient le toit). */
  maxStoreys: number;
  towers: number;
}

export interface VillageDescription {
  gridSize: number;
  /** Blocs posés (hors toits et arches automatiques). */
  blocks: number;
  /** Hauteur de chaque colonne en blocs posés, `heights[z][x]` (0 = libre). */
  heights: number[][];
  buildings: BuildingSummary[];
  /** Arches automatiques au-dessus des rues (cellules). */
  arches: number;
  /** Graine du relief et nombre de cases modelées à la main. */
  terrain: { seed: number; sculpted: number };
  /** Carte lisible : hauteurs en chiffres, `^` sous une arche, `.` libre ; et un résumé. */
  text: string;
}

export function describeVillage(grid: VillageGrid): VillageDescription {
  const size = grid.width;
  const cells = grid.getOccupiedCells();
  const lookup = makeCellLookup(cells);
  const heights = Array.from({ length: size }, () => Array<number>(size).fill(0));
  const archAbove = new Set<string>();
  let blocks = 0;
  let arches = 0;
  for (const cell of cells) {
    if (cell.isAutoArch) {
      arches += 1;
      archAbove.add(`${cell.x},${cell.z}`);
      continue;
    }
    if (cell.isAutoRoof) continue;
    blocks += 1;
    heights[cell.z][cell.x] = Math.max(heights[cell.z][cell.x], cell.y + 1);
  }

  // Bâtiments : colonnes bâties 4-connexes (même découpage que le cache de rendu).
  const seen = new Set<string>();
  const buildings: BuildingSummary[] = [];
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!heights[z][x] || seen.has(`${x},${z}`)) continue;
      const summary: BuildingSummary = { columns: 0, minX: x, maxX: x, minZ: z, maxZ: z, maxStoreys: 0, towers: 0 };
      const queue: Array<[number, number]> = [[x, z]];
      seen.add(`${x},${z}`);
      while (queue.length > 0) {
        const [cx, cz] = queue.pop()!;
        summary.columns += 1;
        summary.minX = Math.min(summary.minX, cx);
        summary.maxX = Math.max(summary.maxX, cx);
        summary.minZ = Math.min(summary.minZ, cz);
        summary.maxZ = Math.max(summary.maxZ, cz);
        // Le bloc du sommet d'une colonne est son toit : un étage de moins.
        summary.maxStoreys = Math.max(summary.maxStoreys, Math.max(1, heights[cz][cx] - 1));
        const base = getCell(lookup, cx, 0, cz);
        if (base && isTowerColumn(lookup, base)) summary.towers += 1;
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          if (!heights[nz][nx] || seen.has(`${nx},${nz}`)) continue;
          seen.add(`${nx},${nz}`);
          queue.push([nx, nz]);
        }
      }
      buildings.push(summary);
    }
  }

  const map = heights
    .map((row, z) =>
      row.map((h, x) => (h > 0 ? (h > 9 ? '+' : String(h)) : archAbove.has(`${x},${z}`) ? '^' : '.')).join(' '),
    )
    .map((line, z) => `${String(z).padStart(2)} ${line}`);
  const header = `   ${Array.from({ length: size }, (_, x) => String(x % 10)).join(' ')}   (x →, z ↓)`;
  const towers = buildings.reduce((sum, b) => sum + b.towers, 0);
  const summary =
    `${size}×${size} grid, ${blocks} blocks, ${buildings.length} building(s), ${towers} tower column(s), ` +
    `${arches} arch cell(s). Digits = column height in blocks (the top block is the roof), ^ = arch over a lane.`;
  return {
    gridSize: size,
    blocks,
    heights,
    buildings,
    arches,
    terrain: { seed: grid.terrain.seed, sculpted: grid.terrain.sculpt.length },
    text: [summary, header, ...map].join('\n'),
  };
}
