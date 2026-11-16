import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../../villageGrid';
import { buildVillage } from '../buildVillage';
import { pickRenderSettings } from '../renderSettings';
import { useControlStore } from '../../store/controlStore';
import { BlockType } from '../../types';
import { FACE_ROTATION_Y, getCell } from '../../utils/cellUtils';
import { findRooms } from '../../utils/roomLamps';
import { offsetPolygon, pointInPolygon } from '../../utils/polygon';
import { innerContourXZ, OPENING_SIZES, WALL_T } from '../geometryCache';
import type { Part } from '../parts';
import type { CellContext } from './context';
import { DOOR_PASSAGE_DEPTH, STAIR_FLOOR_Y, stairObstacles } from './stairPlan';

// Intercepte, pendant une vraie construction, chaque escalier produit et le
// mobilier de chaque cellule (repère de la cellule).
const stairs: Array<{ ctx: CellContext; parts: Part[] }> = [];
vi.mock('./stairParts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./stairParts')>();
  return {
    ...original,
    stairParts: (ctx: CellContext) => {
      const parts = original.stairParts(ctx);
      stairs.push({ ctx, parts: parts.map((p) => ({ ...p, matrix: p.matrix.clone() })) });
      return parts;
    },
  };
});
const furniture: Array<{ ctx: CellContext; parts: Part[] }> = [];
vi.mock('./furnitureParts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./furnitureParts')>();
  return {
    ...original,
    furnitureParts: (...args: Parameters<typeof original.furnitureParts>) => {
      const parts = original.furnitureParts(...args);
      furniture.push({ ctx: args[0], parts: parts.map((p) => ({ ...p, matrix: p.matrix.clone() })) });
      return parts;
    },
  };
});

const INNER = 0.5 - WALL_T;
const settings = () => pickRenderSettings(useControlStore.getState());

function build(grid: VillageGrid, size: number) {
  stairs.length = 0;
  furniture.length = 0;
  buildVillage(grid.getOccupiedCells(), (x, y, z) => grid.toWorldPosition(x, y, z), settings(), {
    width: size,
    depth: size,
  });
  // stairParts est appelé pour chaque cellule creuse : son contexte dit tout.
  return stairs.map(({ ctx }) => ctx);
}

/** Bâtiment plein de `levels` blocs par colonne (le dernier devient le toit). */
function building(columns: Array<[number, number]>, levels: number, size = 8): VillageGrid {
  const grid = new VillageGrid(size, 10, size);
  for (const [x, z] of columns) for (let y = 0; y < levels; y += 1) grid.addBlock(x, y, z);
  return grid;
}

function verticesOf(parts: Part[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of parts) {
    const position = p.geo.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      out.push(new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(p.matrix));
    }
  }
  return out;
}

const key = (ctx: CellContext) => `${ctx.cell.x},${ctx.cell.y},${ctx.cell.z}`;

describe('stairs', () => {
  it('climbs a two-storey house by an L stair, then a ladder to the attic', () => {
    const contexts = build(
      building(
        [
          [2, 2],
          [3, 2],
          [4, 2],
          [2, 3],
          [3, 3],
          [4, 3],
        ],
        3,
      ),
      8,
    );
    const withStair = contexts.filter((ctx) => ctx.stair);
    expect(withStair.map((ctx) => `${ctx.cell.y}:${ctx.stair!.kind}`).sort()).toEqual(['0:L', '1:ladder']);

    const ground = withStair.find((ctx) => ctx.cell.y === 0)!;
    const arrival = contexts.filter((ctx) => ctx.stairBelow);
    expect(arrival).toHaveLength(1);
    expect(key(arrival[0])).toBe(`${ground.cell.x},1,${ground.cell.z}`);
    expect(arrival[0].stairBelow).toBe(ground.stair);
    // Le grenier d'un toit à deux pans : trappe ouverte.
    const ladder = withStair.find((ctx) => ctx.cell.y === 1)!.stair!;
    expect(ladder.kind === 'ladder' && ladder.closed).toBe(false);
  });

  it('gives a tower a spiral stair per storey, on the same start, its landing facing the door', () => {
    const contexts = build(building([[4, 4]], 4), 8);
    const plans = contexts.filter((ctx) => ctx.stair).sort((a, b) => a.cell.y - b.cell.y);
    expect(plans.map((ctx) => ctx.stair!.kind)).toEqual(['spiral', 'spiral', 'ladder']);
    const [first, second, top] = plans.map((ctx) => ctx.stair!);
    expect(first.kind === 'spiral' && second.kind === 'spiral' && first.angle === second.angle).toBe(true);
    // Sous la flèche : trappe fermée.
    expect(top.kind === 'ladder' && top.closed).toBe(true);

    const base = plans[0];
    expect(base.doorFace).not.toBeNull();
    if (first.kind !== 'spiral') return;
    const landing = first.angle + (Math.PI * 7) / 4; // milieu du quart sans marches
    const door = FACE_ROTATION_Y[base.doorFace!];
    expect(Math.cos(landing - door)).toBeCloseTo(1, 6);
  });

  it('only puts a ladder in a single-storey house', () => {
    const columns: Array<[number, number]> = [];
    for (let x = 2; x < 5; x += 1) for (let z = 2; z < 5; z += 1) columns.push([x, z]);
    const contexts = build(building(columns, 2), 8);
    expect(contexts.filter((ctx) => ctx.stair).map((ctx) => ctx.stair!.kind)).toEqual(['ladder']);
    expect(contexts.some((ctx) => ctx.stairBelow)).toBe(false);
  });

  describe('in generated villages', () => {
    const villages: CellContext[][] = [];
    beforeEach(() => {
      if (villages.length > 0) return;
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const grid = new VillageGrid(10, 10, 10);
        grid.generateTerrain(10, seed);
        const contexts = build(grid, 10);
        villages.push(contexts);
        // Garde les escaliers et meubles de chaque village (build réinitialise les listes).
        allStairs.push(...stairs);
        allFurniture.push(...furniture);
      }
    });
    const allStairs: typeof stairs = [];
    const allFurniture: typeof furniture = [];

    it('links every storey to the one above, and every top storey to its attic', () => {
      let stairCount = 0;
      let ladderCount = 0;
      for (const contexts of villages) {
        const { lookup } = contexts[0];
        const ctxOf = new Map(contexts.map((ctx) => [ctx.cell, ctx]));
        const rooms = findRooms(
          contexts.map((ctx) => ctx.cell),
          lookup,
        );
        const roomOf = new Map(rooms.flatMap((room, i) => room.map((cell) => [cell, i] as const)));
        for (const room of rooms) {
          // Pièces du dessus posées sur celle-ci : un escalier exactement vers chacune.
          const uppers = new Set<number>();
          for (const cell of room) {
            const up = getCell(lookup, cell.x, cell.y + 1, cell.z);
            if (up && roomOf.has(up)) uppers.add(roomOf.get(up)!);
          }
          const leaving = room.map((cell) => ctxOf.get(cell)!).filter((ctx) => ctx.stair);
          if (uppers.size > 0) {
            const reached = leaving.map((ctx) => {
              expect(ctx.stair!.kind).not.toBe('ladder');
              return roomOf.get(getCell(lookup, ctx.cell.x, ctx.cell.y + 1, ctx.cell.z)!);
            });
            expect(new Set(reached)).toEqual(uppers);
            expect(reached).toHaveLength(uppers.size);
            stairCount += reached.length;
          } else if (room.some((cell) => getCell(lookup, cell.x, cell.y + 1, cell.z)?.type === BlockType.Roof)) {
            expect(leaving.map((ctx) => ctx.stair!.kind)).toEqual(['ladder']);
            ladderCount += 1;
          }
        }
      }
      expect(stairCount).toBeGreaterThan(10);
      expect(ladderCount).toBeGreaterThan(10);
    });

    it('builds both kinds of stairs, within budget', () => {
      const budget = { L: 1300, spiral: 600, ladder: 400 } as const;
      const kinds = new Set<string>();
      for (const { ctx, parts } of allStairs) {
        if (!ctx.stair) {
          expect(parts).toEqual([]);
          continue;
        }
        kinds.add(ctx.stair.kind);
        const vertices = parts.reduce((sum, p) => sum + p.geo.getAttribute('position').count, 0);
        expect(vertices).toBeLessThan(budget[ctx.stair.kind]);
      }
      expect([...kinds].sort()).toEqual(['L', 'ladder', 'spiral']);
    });

    it('stays inside the cavity, on the floor, clear of the door passage', () => {
      let doors = 0;
      for (const { ctx, parts } of allStairs) {
        if (!ctx.stair) continue;
        const contour = offsetPolygon(innerContourXZ(ctx.hollow!, ctx.radii), 0.012);
        const door = ctx.doorFace;
        if (door) doors += 1;
        for (const v of verticesOf(parts)) {
          expect(pointInPolygon([v.x, v.z], contour)).toBe(true);
          expect(v.y).toBeGreaterThan(STAIR_FLOOR_Y - 0.001);
          // Rien sous le linteau devant la porte (largeur de la porte, ~55 cm de profondeur).
          if (!door || v.y > OPENING_SIZES.door.y + OPENING_SIZES.door.h / 2) continue;
          const a = FACE_ROTATION_Y[door];
          const towards = v.x * Math.sin(a) + v.z * Math.cos(a);
          const along = v.x * Math.cos(a) - v.z * Math.sin(a);
          const inPassage = towards > INNER - DOOR_PASSAGE_DEPTH + 0.001 && Math.abs(along) < OPENING_SIZES.door.w / 2;
          expect(inPassage).toBe(false);
        }
      }
      expect(doors).toBeGreaterThan(0);
    });

    it('keeps furniture off the stairs and away from the stairwells', () => {
      let checked = 0;
      for (const { ctx, parts } of allFurniture) {
        const obstacles = stairObstacles(ctx);
        if (obstacles.length === 0) continue;
        checked += 1;
        for (const v of verticesOf(parts)) {
          for (const obstacle of obstacles) expect(pointInPolygon([v.x, v.z], obstacle)).toBe(false);
        }
      }
      expect(checked).toBeGreaterThan(10);
    });
  });
});
