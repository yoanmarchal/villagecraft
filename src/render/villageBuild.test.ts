import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../villageGrid';
import { pickRenderSettings } from './renderSettings';
import { useControlStore } from '../store/controlStore';
import { reliefFor } from './relief';
import { VillageChunkCache, type MergedGroup } from './buildVillage';
import { mappingFunction, retimeSpawns, sampleMapping, VillageBuildClient, type BuildRequest } from './villageBuild';

const SIZE = 6;
const settings = pickRenderSettings(useControlStore.getState());
const relief = reliefFor(SIZE, 1);

function village(): VillageGrid {
  const grid = new VillageGrid(SIZE, 10, SIZE);
  grid.generateTerrain(SIZE, 4);
  return grid;
}

const requestOf = (grid: VillageGrid): BuildRequest => ({
  cells: grid.getOccupiedCells(),
  settings,
  width: SIZE,
  depth: SIZE,
  relief,
  mapping: sampleMapping((x, y, z) => grid.toWorldPosition(x, y, z)),
});

/** Client sans Worker (Node) : réponses collectées, attendues une à une. */
function client() {
  const results: MergedGroup[][] = [];
  const delivered: BuildRequest[] = [];
  const waiters: Array<() => void> = [];
  const build = new VillageBuildClient((groups, { request }) => {
    results.push(groups);
    delivered.push(request);
    waiters.shift()?.();
  });
  const next = () => new Promise<MergedGroup[]>((resolve) => waiters.push(() => resolve(results[results.length - 1])));
  return { build, results, delivered, next };
}

const content = (groups: MergedGroup[]) =>
  new Map(
    groups.map(({ key, geometry }) => [
      key,
      ['position', 'normal', 'color', 'aCell', 'aSpawn']
        .map((name) => (geometry.getAttribute(name) as THREE.BufferAttribute).array.length)
        .join(',') + `:${geometry.index!.count}`,
    ]),
  );

describe('VillageBuildClient', () => {
  it('maps the grid exactly through the sampled affine mapping', () => {
    const grid = village();
    const mapped = mappingFunction(sampleMapping((x, y, z) => grid.toWorldPosition(x, y, z)));
    for (const [x, y, z] of [
      [0, 0, 0],
      [5, 3, 2],
      [2, 7, 5],
    ])
      expect(mapped(x, y, z)).toEqual(grid.toWorldPosition(x, y, z));
  });

  it('gives the same chunks as a direct build, and keeps the geometry of unchanged chunks', async () => {
    const grid = village();
    const { build, next } = client();
    build.request(requestOf(grid));
    const first = await next();
    const direct = new VillageChunkCache().build(
      grid.getOccupiedCells(),
      (x, y, z) => grid.toWorldPosition(x, y, z),
      settings,
      { width: SIZE, depth: SIZE, relief },
    );
    expect(content(first)).toEqual(content(direct));

    const column = grid.getOccupiedCells().find((c) => c.y === 0)!;
    grid.addBlockInColumn(column.x, column.z);
    build.request(requestOf(grid));
    const second = await next();
    const before = new Map(first.map(({ key, geometry }) => [key, geometry]));
    const kept = second.filter(({ key, geometry }) => before.get(key) === geometry).length;
    // La plupart des chunks sont repris tels quels, au moins un est refusionné.
    expect(kept).toBeGreaterThan(second.length / 2);
    expect(kept).toBeLessThan(second.length);
  });

  it('builds only the latest request while one is running', async () => {
    const grid = village();
    const { build, results, next } = client();
    build.request(requestOf(grid));
    // Trois demandes pendant la première construction : seule la dernière part ensuite.
    for (let i = 0; i < 3; i += 1) {
      grid.addBlockInColumn(i, 0);
      build.request(requestOf(grid));
    }
    await next();
    await next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(results).toHaveLength(2);
  });

  it('delivers each result with the request it builds (the scene aligns the ground on it)', async () => {
    const grid = village();
    const { build, delivered, next } = client();
    const first = requestOf(grid);
    build.request(first);
    grid.addBlockInColumn(0, 0);
    const last = requestOf(grid);
    build.request(last);
    await next();
    await next();
    expect(delivered).toEqual([first, last]);
  });

  it('starts the pop-in of blocks still appearing at delivery, not while the build ran', () => {
    const sentAt = 100;
    const spawns = new Float32Array([10, 98.5, 99.6, 100.2]);
    // Blocs posés moins d'une seconde avant l'envoi (ou après) : décalés du retard ; les anciens restent.
    expect([...retimeSpawns(spawns, sentAt, 2)]).toEqual([10, 98.5, 101.6, 102.2].map(Math.fround));
    // Le tableau reçu n'est jamais modifié (sans worker, c'est celui du cache).
    expect([...spawns]).toEqual([10, 98.5, 99.6, 100.2].map(Math.fround));
    const settled = new Float32Array([1, 2]);
    expect(retimeSpawns(settled, sentAt, 2)).toBe(settled);
  });
});
