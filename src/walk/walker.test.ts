import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, STEP_HEIGHT, WALK_SPEED, WALKER_HEIGHT, WALKER_RADIUS } from './walkConfig';
import {
  createWalker,
  findSpawn,
  clearHeading,
  isFree,
  SPAWN_CLEARANCE,
  stepWalker,
  type WalkInput,
  type WalkerState,
} from './walker';
import { createVillageWorld, type Aabb, type WalkWorld } from './walkWorld';

const idle: WalkInput = { forward: 0, strafe: 0, yaw: 0, run: false, jump: false };

/** Monde fait main : sol `groundAt`, volumes donnés. */
function world(boxes: Aabb[], groundAt: WalkWorld['groundAt'] = () => 0, reach = 100): WalkWorld {
  return {
    groundAt,
    reach,
    solidsIn: (minX, minZ, maxX, maxZ) =>
      boxes.filter((b) => b.min[0] <= maxX && b.max[0] >= minX && b.min[2] <= maxZ && b.max[2] >= minZ),
  };
}

function run(w: WalkWorld, state: WalkerState, input: WalkInput, seconds: number): WalkerState {
  let next = state;
  for (let t = 0; t < seconds; t += 1 / 60) next = stepWalker(w, next, input, 1 / 60);
  return next;
}

describe('walker scale', () => {
  it('is a person in a world where a unit is ~2.8 m and a door 0.71', () => {
    expect(WALKER_HEIGHT).toBeLessThan(0.71);
    expect(EYE_HEIGHT).toBeLessThan(WALKER_HEIGHT);
    expect(WALKER_RADIUS * 2).toBeLessThan(0.3);
  });
});

describe('stepWalker', () => {
  it('walks forward along −z at walking speed (yaw 0)', () => {
    const next = run(world([]), createWalker([0, 0, 0]), { ...idle, forward: 1 }, 2);
    expect(next.position[0]).toBeCloseTo(0, 6);
    expect(next.position[2]).toBeLessThan(-WALK_SPEED * 1.6);
    expect(next.position[2]).toBeGreaterThan(-WALK_SPEED * 2.01);
  });

  it('turns with the yaw: yaw π/2 walks towards −x, strafing right goes to −z', () => {
    const turned = run(world([]), createWalker([0, 0, 0]), { ...idle, forward: 1, yaw: Math.PI / 2 }, 1);
    expect(turned.position[0]).toBeLessThan(-0.3);
    expect(Math.abs(turned.position[2])).toBeLessThan(1e-6);
    const strafed = run(world([]), createWalker([0, 0, 0]), { ...idle, strafe: 1, yaw: Math.PI / 2 }, 1);
    expect(strafed.position[2]).toBeLessThan(-0.3);
  });

  it('does not walk faster diagonally', () => {
    const straight = run(world([]), createWalker([0, 0, 0]), { ...idle, forward: 1 }, 1);
    const diagonal = run(world([]), createWalker([0, 0, 0]), { ...idle, forward: 1, strafe: 1 }, 1);
    expect(Math.hypot(diagonal.position[0], diagonal.position[2])).toBeCloseTo(Math.abs(straight.position[2]), 6);
  });

  it('stops against a wall and slides along it', () => {
    const wall: Aabb = { min: [-5, -1, -1], max: [5, 2, -0.5] };
    const next = run(world([wall]), createWalker([0, 0, 0]), { ...idle, forward: 1, strafe: 1 }, 2);
    expect(next.position[2]).toBeCloseTo(-0.5 + WALKER_RADIUS, 3);
    expect(next.position[0]).toBeGreaterThan(0.3);
  });

  it('climbs a low step but not a block', () => {
    const step: Aabb = { min: [-5, -1, -2], max: [5, STEP_HEIGHT * 0.8, -0.5] };
    const climbed = run(world([step]), createWalker([0, 0, 0]), { ...idle, forward: 1 }, 2);
    expect(climbed.position[1]).toBeCloseTo(STEP_HEIGHT * 0.8, 6);
    expect(climbed.position[2]).toBeLessThan(-0.6);

    const block: Aabb = { min: [-5, -1, -2], max: [5, 1, -0.5] };
    const blocked = run(world([block]), createWalker([0, 0, 0]), { ...idle, forward: 1 }, 2);
    expect(blocked.position[1]).toBe(0);
    expect(blocked.position[2]).toBeCloseTo(-0.5 + WALKER_RADIUS, 3);
  });

  it('follows the terrain up and down a slope without leaving it', () => {
    const slope = world([], (_x, z) => -z * 0.3);
    let state = createWalker([0, 0, 0]);
    for (let i = 0; i < 120; i += 1) {
      state = stepWalker(slope, state, { ...idle, forward: 1 }, 1 / 60);
      expect(state.position[1]).toBeCloseTo(-state.position[2] * 0.3, 6);
      expect(state.grounded).toBe(true);
    }
    for (let i = 0; i < 240; i += 1) {
      state = stepWalker(slope, state, { ...idle, forward: -1 }, 1 / 60);
      expect(state.position[1]).toBeCloseTo(-state.position[2] * 0.3, 6);
    }
  });

  it('jumps once, lands back on the ground, and the jump clears less than a storey', () => {
    let state = stepWalker(world([]), createWalker([0, 0, 0]), { ...idle, jump: true }, 1 / 60);
    expect(state.grounded).toBe(false);
    let top = 0;
    for (let i = 0; i < 120; i += 1) {
      state = stepWalker(world([]), state, idle, 1 / 60);
      top = Math.max(top, state.position[1]);
    }
    expect(state.grounded).toBe(true);
    expect(state.position[1]).toBe(0);
    expect(top).toBeGreaterThan(0.1);
    expect(top).toBeLessThan(0.5);
  });

  it('bumps its head on a ceiling', () => {
    const ceiling: Aabb = { min: [-5, WALKER_HEIGHT + 0.05, -5], max: [5, 3, 5] };
    let state = stepWalker(world([ceiling]), createWalker([0, 0, 0]), { ...idle, jump: true }, 1 / 60);
    for (let i = 0; i < 60; i += 1) {
      state = stepWalker(world([ceiling]), state, idle, 1 / 60);
      expect(state.position[1] + WALKER_HEIGHT).toBeLessThanOrEqual(ceiling.min[1] + 1e-9);
    }
  });

  it('is frame-rate independent', () => {
    const w = world([]);
    const input = { ...idle, forward: 1 };
    let fast = createWalker([0, 0, 0]);
    for (let i = 0; i < 144; i += 1) fast = stepWalker(w, fast, input, 1 / 144);
    let slow = createWalker([0, 0, 0]);
    for (let i = 0; i < 30; i += 1) slow = stepWalker(w, slow, input, 1 / 30);
    expect(fast.position[2]).toBeCloseTo(slow.position[2], 2);
  });

  it('stays within reach of the scene centre', () => {
    const next = run(
      world([], () => 0, 1),
      createWalker([0, 0, 0]),
      { ...idle, forward: 1, run: true },
      3,
    );
    expect(Math.hypot(next.position[0], next.position[2])).toBeCloseTo(1, 6);
  });
});

describe('createVillageWorld', () => {
  const village = (cells: { x: number; y: number; z: number }[], baseAt = () => 0) =>
    createVillageWorld({ cells, gridWidth: 4, gridDepth: 4, baseAt, groundAt: () => 0, reach: 50 });

  it('makes one box per stack of cells, the ground floor reaching under the terrain', () => {
    const w = village([
      { x: 1, y: 0, z: 2 },
      { x: 1, y: 1, z: 2 },
      { x: 1, y: 3, z: 2 },
    ]);
    const boxes = w.solidsIn(-0.9, 0.1, -0.1, 0.9);
    expect(boxes).toHaveLength(2);
    const [low, high] = boxes.sort((a, b) => a.min[1] - b.min[1]);
    expect(low.min[0]).toBe(-1);
    expect(low.max[0]).toBe(0);
    expect(low.min[2]).toBe(0);
    expect(low.max[1]).toBe(2);
    expect(low.min[1]).toBeLessThan(-10);
    expect(high.min[1]).toBe(3);
    expect(high.max[1]).toBe(4);
  });

  it('puts every column at its building level', () => {
    const w = village([{ x: 0, y: 0, z: 0 }], () => 0.7);
    expect(w.solidsIn(-2, -2, -1.5, -1.5)[0].max[1]).toBeCloseTo(1.7, 9);
  });

  it('lets the walker pass under an arch but not through a house', () => {
    // Arche (y = 1) au-dessus de la case (1, 2) : elle ne touche pas le sol.
    const w = village([
      { x: 0, y: 0, z: 2 },
      { x: 0, y: 1, z: 2 },
      { x: 1, y: 1, z: 2 },
      { x: 2, y: 0, z: 2 },
      { x: 2, y: 1, z: 2 },
    ]);
    expect(isFree(w, -0.5, 0, 0.5)).toBe(true);
    expect(isFree(w, -1.5, 0, 0.5)).toBe(false);
    // On traverse le passage sous l'arche, de z = 1.5 à z = −0.5.
    const next = run(w, createWalker([-0.5, 0, 1.5]), { ...idle, forward: 1 }, 6);
    expect(next.position[2]).toBeLessThan(-0.4);
  });

  it('finds a free spawn point next to a building', () => {
    const w = village([{ x: 2, y: 0, z: 2 }]);
    expect(isFree(w, 0.5, 0, 0.5)).toBe(false);
    const [x, y, z] = findSpawn(w, 0.5, 0.5);
    expect(isFree(w, x, y, z)).toBe(true);
    expect(isFree(w, x, y, z, SPAWN_CLEARANCE)).toBe(true);
    expect(Math.hypot(x - 0.5, z - 0.5)).toBeLessThan(1.5);
  });

  it('falls back to any free spot when no place is that open', () => {
    // Ruelle d'une case entre deux rangées de maisons (x = 0 et x = 2), sur toute la profondeur.
    const rows = [0, 1, 2, 3].flatMap((z) => [
      { x: 0, y: 0, z },
      { x: 2, y: 0, z },
      { x: 3, y: 0, z },
    ]);
    const w = createVillageWorld({
      cells: rows,
      gridWidth: 4,
      gridDepth: 4,
      baseAt: () => 0,
      groundAt: () => 0,
      reach: 1.2,
    });
    const [x, y, z] = findSpawn(w, -0.5, 0);
    expect(isFree(w, x, y, z)).toBe(true);
    expect(isFree(w, x, y, z, SPAWN_CLEARANCE)).toBe(false);
  });

  it('arrives facing the preferred heading unless a wall is right in front', () => {
    const wall: Aabb = { min: [-5, -1, -1], max: [5, 2, -0.5] };
    const w = world([wall]);
    // Préférence vers le mur (−z), à 0,5 : on s'en détourne juste assez pour avoir 1 de libre devant soi.
    const yaw = clearHeading(w, [0, 0, 0], 0);
    expect(Math.cos(yaw)).toBeLessThan(0.5);
    expect(Math.cos(yaw)).toBeGreaterThan(0);
    expect(isFree(w, -Math.sin(yaw), 0, -Math.cos(yaw))).toBe(true);
    // Préférence vers +x, dégagé : gardée.
    expect(clearHeading(w, [0, 0, 0], -Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 9);
  });
});
