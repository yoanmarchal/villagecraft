import { it, vi } from 'vitest';
import { VillageGrid } from '../src/villageGrid';
import { VillageChunkCache } from '../src/render/buildVillage';
import { pickRenderSettings } from '../src/render/renderSettings';
import { useControlStore } from '../src/store/controlStore';
import { GRID_HEIGHT } from '../src/config/gridConfig';

const { time, wrap } = vi.hoisted(() => {
  const time: Record<string, number> = {};
  const wrap = <T extends (...a: never[]) => unknown>(name: string, fn: T) =>
    ((...a: Parameters<T>) => {
      const t = performance.now();
      const r = fn(...a);
      time[name] = (time[name] ?? 0) + performance.now() - t;
      return r;
    }) as T;
  return { time, wrap };
});
vi.mock('../src/render/cells/roofCellParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, roofCellParts: wrap('roofCellParts', m.roofCellParts) };
});
vi.mock('../src/render/cells/archCellParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, archCellParts: wrap('archCellParts', m.archCellParts) };
});
vi.mock('../src/render/cells/wallWindowCellParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, wallWindowCellParts: wrap('wallWindowCellParts', m.wallWindowCellParts) };
});
vi.mock('../src/render/cells/standardCellParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, standardCellParts: wrap('standardCellParts', m.standardCellParts) };
});
vi.mock('../src/render/cells/pavingParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, pavingParts: wrap('pavingParts', m.pavingParts) };
});
vi.mock('../src/render/cells/propsParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, propsParts: wrap('propsParts', m.propsParts) };
});
vi.mock('../src/render/cells/plinthParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, plinthParts: wrap('plinthParts', m.plinthParts) };
});
vi.mock('../src/render/cells/stairPlan', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, planStairs: wrap('planStairs', m.planStairs) };
});
vi.mock('../src/render/cells/openings', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, planDoors: wrap('planDoors', m.planDoors) };
});
vi.mock('../src/render/cells/furnitureParts', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, planFireplaces: wrap('planFireplaces', m.planFireplaces) };
});
vi.mock('../src/utils/roomLamps', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, assignRoomLamps: wrap('assignRoomLamps', m.assignRoomLamps) };
});
vi.mock('../src/render/ground', async (o) => {
  const m = await o<Record<string, (...a: never[]) => unknown>>();
  return { ...m, createGround: wrap('createGround', m.createGround) };
});

it('profile', () => {
  const settings = pickRenderSettings(useControlStore.getState());
  const size = 12;
  const out: string[] = [];
  for (const seed of [1, 2, 3]) {
    const grid = new VillageGrid(size, GRID_HEIGHT, size);
    grid.generateTerrain(size, seed);
    const toWorld = (x: number, y: number, z: number) => grid.toWorldPosition(x, y, z);
    const ground = { width: size, depth: size, relief: 1 };
    const cache = new VillageChunkCache();
    cache.build(grid.getOccupiedCells(), toWorld, settings, ground);
    cache.build(grid.getOccupiedCells(), toWorld, settings, ground);
    for (const k of Object.keys(time)) delete time[k];
    const column = grid.getOccupiedCells().find((c) => c.y === 0 && Math.abs(c.x - size / 2) < 2)!;
    grid.addBlockInColumn(column.x, column.z);
    const t0 = performance.now();
    cache.build(grid.getOccupiedCells(), toWorld, settings, ground);
    const total = performance.now() - t0;
    const parts = Object.values(time).reduce((a, b) => a + b, 0);
    out.push(
      `seed ${seed}: total ${total.toFixed(0)} ms | ` +
        Object.entries(time)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${v.toFixed(0)}`)
          .join(', ') +
        ` | reste ${(total - parts).toFixed(0)}`,
    );
  }
  process.stdout.write('\n' + out.join('\n') + '\n\n');
});
