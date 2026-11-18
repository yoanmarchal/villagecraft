import { describe, expect, it, vi } from 'vitest';
import { VillageGrid } from '../villageGrid';
import { VillageChunkCache } from '../render/buildVillage';
import { pickRenderSettings } from '../render/renderSettings';
import { useControlStore } from '../store/controlStore';
import type { CellFace } from '../utils/cellUtils';
import type { CellContext } from '../render/cells/context';
import { lStairPoint, STAIR_FLOOR_Y } from '../render/cells/stairPlan';
import { DOOR_OPEN_ANGLE, doorPose } from '../render/cells/doors';
import { WALL_T } from '../render/geometryCache';
import * as THREE from 'three';
import { createWalker, stepWalker, type WalkerState } from './walker';
import { createBoxWorld, type Vec3, type WalkWorld } from './walkWorld';
import { subtractBox, type Box } from './cellColliders';

// Contexte de chaque cellule pendant une vraie construction (plans des portes et des escaliers).
const contexts: CellContext[] = [];
vi.mock('./cellColliders', async (importOriginal) => {
  const original = await importOriginal<typeof import('./cellColliders')>();
  return {
    ...original,
    cellColliders: (ctx: CellContext) => {
      contexts.push(ctx);
      return original.cellColliders(ctx);
    },
  };
});

const OUT: Record<CellFace, [number, number]> = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };

/** Bâtiment plein de `levels` blocs par colonne (le dernier devient le toit), construit ; son monde de collision. */
function village(columns: Array<[number, number]>, levels: number, size = 8) {
  const grid = new VillageGrid(size, 10, size);
  for (const [x, z] of columns) for (let y = 0; y < levels; y += 1) grid.addBlock(x, y, z);
  contexts.length = 0;
  const cache = new VillageChunkCache();
  const groups = cache.build(
    grid.getOccupiedCells(),
    (x, y, z) => grid.toWorldPosition(x, y, z),
    pickRenderSettings(useControlStore.getState()),
    { width: size, depth: size },
  );
  const world = createBoxWorld(cache.colliders, () => 0, 50);
  /** Point monde d'un point (x, z) du repère d'une cellule, au niveau de son plancher. */
  const at = (ctx: CellContext, [lx, lz]: [number, number]): Vec3 => {
    const [wx, wy, wz] = grid.toWorldPosition(ctx.cell.x, ctx.cell.y, ctx.cell.z);
    return [wx + lx, wy + STAIR_FLOOR_Y, wz + lz];
  };
  return { world, groups, contexts: [...contexts], at };
}

/**
 * Marche vers chaque point de passage (en plan), droit devant ; s'arrête au
 * premier qu'il n'atteint pas. Retourne l'état final et le nombre de points atteints.
 */
function follow(world: WalkWorld, start: Vec3, waypoints: Vec3[]): { state: WalkerState; reached: number } {
  let state = createWalker(start);
  for (let i = 0; i < waypoints.length; i += 1) {
    const [tx, , tz] = waypoints[i];
    let steps = 0;
    for (;;) {
      const [x, , z] = state.position;
      if (Math.hypot(tx - x, tz - z) < 0.03) break;
      if ((steps += 1) > 600) return { state, reached: i };
      state = stepWalker(
        world,
        state,
        { forward: 1, strafe: 0, yaw: Math.atan2(x - tx, z - tz), run: false, jump: false },
        1 / 60,
      );
    }
  }
  return { state, reached: waypoints.length };
}

const HOUSE: Array<[number, number]> = [
  [2, 2],
  [3, 2],
  [4, 2],
  [2, 3],
  [3, 3],
  [4, 3],
];

describe('walking into the village', () => {
  it('enters a house through its door, onto the floorboards', () => {
    const { world, contexts: all, at } = village(HOUSE, 3);
    const door = all.find((ctx) => ctx.doorFace)!;
    const [ox, oz] = OUT[door.doorFace!];
    const outside = at(door, [ox * 0.9, oz * 0.9]);
    outside[1] = 0;
    const { state, reached } = follow(world, outside, [at(door, [ox * 0.6, oz * 0.6]), at(door, [0, 0])]);
    expect(reached).toBe(2);
    expect(state.position[1]).toBeCloseTo(at(door, [0, 0])[1], 6);
  });

  it('cannot walk through a wall', () => {
    const { world, contexts: all, at } = village(HOUSE, 3);
    const walled = all.find((ctx) => ctx.cell.y === 0 && ctx.exposedFaces.length > 0 && !ctx.doorFace)!;
    const face = walled.exposedFaces[0];
    const [ox, oz] = OUT[face];
    const outside = at(walled, [ox * 0.9, oz * 0.9]);
    outside[1] = 0;
    const { state, reached } = follow(world, outside, [at(walled, [0, 0])]);
    expect(reached).toBe(0);
    const [cx, , cz] = at(walled, [0, 0]);
    expect((state.position[0] - cx) * ox + (state.position[2] - cz) * oz).toBeGreaterThan(0.5);
  });

  it('climbs an L stair to the floor above, out past its railing', () => {
    const { world, contexts: all, at } = village(HOUSE, 3);
    const ground = all.find((ctx) => ctx.stair?.kind === 'L')!;
    const plan = ground.stair!;
    if (plan.kind !== 'L') return;
    // Repère canonique (a, b) : volée du bas le long de a ≈ 0,27 vers +b, quart tournant, volée du haut vers −a.
    const route = ([a, b]: [number, number]) => at(ground, lStairPoint(plan, a, b));
    const { state, reached } = follow(world, route([0, -0.27]), [
      route([0.27, -0.27]),
      route([0.27, 0.27]),
      route([-0.325, 0.27]),
      route([-0.325, -0.1]),
    ]);
    expect(reached).toBe(4);
    expect(state.position[1]).toBeCloseTo(route([0, 0])[1] + 1, 6);
  });

  it('climbs a spiral stair round the newel of a tower, on the outer side of the steps', () => {
    const { world, contexts: all, at } = village([[4, 4]], 4);
    const ground = all.find((ctx) => ctx.cell.y === 0 && ctx.stair?.kind === 'spiral')!;
    const plan = ground.stair!;
    if (plan.kind !== 'spiral') return;
    const onCircle = (degrees: number) => {
      const angle = plan.angle + (degrees * Math.PI) / 180;
      return at(ground, [0.27 * Math.sin(angle), 0.27 * Math.cos(angle)]);
    };
    const waypoints = Array.from({ length: 21 }, (_, i) => onCircle(10 + i * 15));
    const { state, reached } = follow(world, onCircle(-30), waypoints);
    expect(reached).toBe(waypoints.length);
    expect(state.position[1]).toBeCloseTo(onCircle(0)[1] + 1, 6);
  });

  it('gives each door its own moving parts, hinged on the opening', () => {
    const { groups, contexts: all, at } = village(HOUSE, 3);
    const doorGroups = groups.filter((group) => group.door);
    expect(doorGroups.length).toBeGreaterThan(0);
    const door = all.find((ctx) => ctx.doorFace)!;
    const [ox, oz] = OUT[door.doorFace!];
    const [cx, , cz] = at(door, [ox * 0.46, oz * 0.46]);
    for (const { door: hinge } of doorGroups) {
      expect(Math.hypot(hinge!.center[0] - cx, hinge!.center[2] - cz)).toBeLessThan(0.01);
      // Charnière au bord de l'ouverture, sur le chant intérieur du vantail.
      expect(Math.hypot(hinge!.hinge[0] - cx, hinge!.hinge[2] - cz)).toBeGreaterThan(0.1);
    }
  });
});

describe('door panels', () => {
  it('swing open into the room, clear of the walls, and close back flush', () => {
    // Maisons de toutes formes : chaque vantail, ouvert, entre dans sa cellule sans traverser de mur.
    for (const columns of [
      HOUSE,
      [[3, 3]] as Array<[number, number]>,
      [
        [2, 2],
        [3, 2],
        [3, 3],
      ] as Array<[number, number]>,
    ]) {
      const { groups, contexts: all, at } = village(columns, 3);
      for (const { door, geometry } of groups.filter((group) => group.door)) {
        const ctx = all.find((c) => {
          const [cx, , cz] = at(c, [0, 0]);
          return c.doorFace && Math.abs(door!.center[0] - cx) < 0.5 && Math.abs(door!.center[2] - cz) < 0.5;
        })!;
        const [ox, oz] = OUT[ctx.doorFace!];
        const [cx, , cz] = at(ctx, [0, 0]);
        const { rotationY, position } = doorPose(door!, DOOR_OPEN_ANGLE);
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(...position),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        const p = geometry.getAttribute('position');
        const v = new THREE.Vector3();
        for (let i = 0; i < p.count; i += 1) {
          v.fromBufferAttribute(p, i).applyMatrix4(matrix);
          const depth = (v.x - cx) * ox + (v.z - cz) * oz; // vers la rue
          const lateral = (v.x - cx) * -oz + (v.z - cz) * ox;
          expect(depth).toBeLessThan(0.5 - WALL_T / 2 + 0.03);
          expect(Math.abs(lateral)).toBeLessThan(0.5 - WALL_T + 0.04);
        }
        // Fermé : rien ne bouge.
        expect(doorPose(door!, 0).position.every((c) => Math.abs(c) < 1e-9)).toBe(true);
      }
    }
  });
});

describe('subtractBox', () => {
  it('keeps everything around the cut and nothing inside it', () => {
    const box: Box = [0, 0, 0, 1, 1, 1];
    const pieces = subtractBox(box, [0.25, -1, 0.4, 0.75, 0.5, 2]);
    const volume = pieces.reduce((sum, [x0, y0, z0, x1, y1, z1]) => sum + (x1 - x0) * (y1 - y0) * (z1 - z0), 0);
    expect(volume).toBeCloseTo(1 - 0.5 * 0.5 * 0.6, 9);
    expect(subtractBox(box, [2, 2, 2, 3, 3, 3])).toEqual([box]);
  });
});
