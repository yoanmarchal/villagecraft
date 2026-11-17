/**
 * Coût de construction du village selon la taille de la grille (CPU seulement :
 * le dessin GPU se mesure dans le navigateur, panneau Debug › perf).
 *
 * Pour chaque taille : sommets, mémoire des géométries fusionnées, reconstruction
 * complète (`buildVillage`, cache de géométries chaud) et clic (`VillageChunkCache` :
 * un bloc ajouté, seuls les chunks touchés sont refusionnés).
 */
import { it } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../src/villageGrid';
import { buildVillage, VillageChunkCache } from '../src/render/buildVillage';
import { pickRenderSettings } from '../src/render/renderSettings';
import { useControlStore } from '../src/store/controlStore';
import { GRID_HEIGHT } from '../src/config/gridConfig';

const SIZES = (process.env.PERF_SIZES ?? '12,16,20,24').split(',').map(Number);
const SEEDS = [1, 2, 3];
const RUNS = 3;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bytesOf = (geometry: THREE.BufferGeometry) =>
  Object.values(geometry.attributes).reduce((sum, a) => sum + (a as THREE.BufferAttribute).array.byteLength, 0) +
  (geometry.index?.array.byteLength ?? 0);

it('village build cost by grid size', () => {
  const settings = pickRenderSettings(useControlStore.getState());
  const rows: Record<string, string | number>[] = [];
  for (const size of SIZES) {
    const full: number[] = [];
    const click: number[] = [];
    let vertices = 0;
    let bytes = 0;
    let meshes = 0;
    let remerged = 0;
    for (const seed of SEEDS) {
      const grid = new VillageGrid(size, GRID_HEIGHT, size);
      grid.generateTerrain(size, seed);
      const toWorld = (x: number, y: number, z: number) => grid.toWorldPosition(x, y, z);
      const ground = { width: size, depth: size, relief: 1 };
      // Chauffe le cache de géométries (CSG des coques, etc.).
      buildVillage(grid.getOccupiedCells(), toWorld, settings, ground);

      for (let run = 0; run < RUNS; run += 1) {
        const t0 = performance.now();
        const groups = buildVillage(grid.getOccupiedCells(), toWorld, settings, ground);
        full.push(performance.now() - t0);
        if (run === 0) {
          vertices += groups.reduce((s, g) => s + g.geometry.getAttribute('position').count, 0);
          bytes += groups.reduce((s, g) => s + bytesOf(g.geometry), 0);
        }
      }

      // Clic : un bloc posé sur une colonne existante, au milieu de la grille.
      const cache = new VillageChunkCache();
      const before = new Map(
        cache.build(grid.getOccupiedCells(), toWorld, settings, ground).map((g) => [g.key, g.geometry]),
      );
      const column = grid.getOccupiedCells().find((c) => c.y === 0 && Math.abs(c.x - size / 2) < 2)!;
      grid.addBlockInColumn(column.x, column.z);
      const t0 = performance.now();
      const after = cache.build(grid.getOccupiedCells(), toWorld, settings, ground);
      click.push(performance.now() - t0);
      meshes += after.length;
      remerged += after.filter((g) => before.get(g.key) !== g.geometry).length;
    }
    rows.push({
      grid: `${size}×${size}`,
      'k sommets': Math.round(vertices / SEEDS.length / 1000),
      'Mo GPU': +(bytes / SEEDS.length / 2 ** 20).toFixed(1),
      meshes: Math.round(meshes / SEEDS.length),
      'reconstruction ms': Math.round(median(full)),
      'clic ms': Math.round(median(click)),
      'meshes refusionnés': Math.round(remerged / SEEDS.length),
    });
  }
  // Vitest masque la console des tests réussis : on écrit le tableau directement.
  const headers = Object.keys(rows[0]);
  const lines = [headers, ...rows.map((r) => headers.map((h) => String(r[h])))];
  const widths = headers.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  const table = lines.map((l) => l.map((c, i) => c.padStart(widths[i])).join('  ')).join('\n');
  process.stdout.write(`\n${table}\n\n`);
});
