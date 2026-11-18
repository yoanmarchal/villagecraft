import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../../villageGrid';
import { buildVillage } from '../buildVillage';
import { pickRenderSettings } from '../renderSettings';
import { useControlStore } from '../../store/controlStore';
import type { GridCell } from '../../types';
import type { Part } from '../parts';
import type { CellContext } from './context';
import { QUOIN_JOINT } from './decorations';

// Intercepte, pendant une vraie construction, les chaînages et le parement de chaque cellule.
const quoins = new Map<GridCell, Part[]>();
const facing = new Map<GridCell, Part[]>();
const contexts = new Map<GridCell, CellContext>();
const copy = (parts: Part[]) => parts.map((p) => ({ ...p, matrix: p.matrix.clone() }));
vi.mock('./decorations', async (importOriginal) => {
  const original = await importOriginal<typeof import('./decorations')>();
  return {
    ...original,
    // Étage et soubassement (plinthParts) : les deux appels s'ajoutent.
    quoinParts: (...args: Parameters<typeof original.quoinParts>) => {
      const parts = original.quoinParts(...args);
      const [ctx] = args;
      contexts.set(ctx.cell, ctx);
      quoins.set(ctx.cell, [...(quoins.get(ctx.cell) ?? []), ...copy(parts)]);
      return parts;
    },
  };
});
vi.mock('./masonryParts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./masonryParts')>();
  return {
    ...original,
    masonryParts: (...args: Parameters<typeof original.masonryParts>) => {
      const parts = original.masonryParts(...args);
      facing.set(args[0].cell, [...(facing.get(args[0].cell) ?? []), ...copy(parts)]);
      return parts;
    },
  };
});

/** Boîte (repère local du part) d'une pierre — sans toucher à la géométrie du cache. */
function localBox(p: Part): THREE.Box3 {
  return new THREE.Box3().setFromBufferAttribute(p.geo.getAttribute('position') as THREE.BufferAttribute);
}

function build(columns: Array<[number, number]>, levels: number, interiorRadius = 0, relief?: number) {
  quoins.clear();
  facing.clear();
  contexts.clear();
  const grid = new VillageGrid(9, 10, 9);
  for (const [x, z] of columns) for (let y = 0; y < levels; y += 1) grid.addBlock(x, y, z);
  const settings = { ...pickRenderSettings(useControlStore.getState()), connectedWallInteriorRadius: interiorRadius };
  buildVillage(
    grid.getOccupiedCells(),
    (x, y, z) => grid.toWorldPosition(x, y, z),
    settings,
    relief === undefined ? undefined : { width: 9, depth: 9, relief },
  );
  const find = <T>(map: Map<GridCell, T>, x: number, y: number, z: number) =>
    [...map.entries()].find(([cell]) => cell.x === x && cell.y === y && cell.z === z)?.[1];
  const at = (x: number, y: number, z: number) => find(quoins, x, y, z) ?? [];
  const contextAt = (x: number, y: number, z: number) => find(contexts, x, y, z);
  return { at, contextAt };
}

/** Pierres de chaînage d'un coin (signes du centre), triées de bas en haut. */
function column(parts: Part[], sx: number, sz: number) {
  return parts
    .map((p) => ({ p, centre: new THREE.Vector3().setFromMatrixPosition(p.matrix), box: localBox(p) }))
    .filter(({ centre }) => Math.sign(centre.x) === sx && Math.sign(centre.z) === sz)
    .sort((a, b) => a.centre.y - b.centre.y);
}

describe('quoins', () => {
  // Maison en L de deux niveaux : angles saillants, angle rentrant, jonctions de façade.
  const L: Array<[number, number]> = [
    [3, 4],
    [4, 4],
    [5, 4],
    [5, 3],
  ];

  let houses: ReturnType<typeof build>;
  beforeEach(() => {
    houses = build(L, 3);
  });

  it('chains each salient corner from floor to ceiling, stone upon stone, long and short in turn', () => {
    for (const y of [0, 1]) {
      // Angle avant gauche de la maison : cellule (3, 4), coin (−x, +z).
      const stones = column(houses.at(3, y, 4), -1, 1);
      expect(stones.length).toBe(4);
      const bottom = stones[0].centre.y + stones[0].box.min.y;
      const top = stones[stones.length - 1].centre.y + stones[stones.length - 1].box.max.y;
      expect(bottom).toBeLessThan(-0.5 + QUOIN_JOINT);
      expect(top).toBeGreaterThan(0.5 - QUOIN_JOINT);
      for (let i = 1; i < stones.length; i += 1) {
        const gap = stones[i].centre.y + stones[i].box.min.y - (stones[i - 1].centre.y + stones[i - 1].box.max.y);
        // Seulement un joint entre deux pierres d'angle.
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThan(QUOIN_JOINT + 0.001);
        // Harpe : la longue passe d'une face à l'autre.
        const width = (s: (typeof stones)[number]) => s.box.max.x - s.box.min.x;
        expect(Math.sign(width(stones[i]) - width(stones[i - 1]))).not.toBe(0);
      }
    }
  });

  it('puts no quoin at a straight facade junction nor in a re-entrant corner', () => {
    // (4, 4) : milieu de la façade avant, entre (3, 4) et (5, 4).
    expect(houses.at(4, 0, 4)).toEqual([]);
    // (5, 4) : angle avant droit saillant, mais l'angle arrière gauche (vers (4, 3)) est rentrant.
    expect(column(houses.at(5, 0, 4), 1, 1).length).toBe(4);
    expect(column(houses.at(5, 0, 4), -1, -1)).toEqual([]);
  });

  it('chains the groove of a rounded junction', () => {
    const rounded = build(
      [
        [3, 4],
        [4, 4],
      ],
      3,
      0.3,
    );
    // Gorge avant entre (3, 4) et (4, 4) : chacune sa colonne, de chaque côté.
    expect(column(rounded.at(3, 0, 4), 1, 1).length).toBe(4);
    expect(column(rounded.at(4, 0, 4), -1, 1).length).toBe(4);
  });

  it('cuts the stone facing around the quoins: no facing stone inside a quoin', () => {
    let checked = 0;
    for (const [cell, parts] of quoins) {
      const stones = facing.get(cell) ?? [];
      for (const quoin of parts) {
        const inverse = quoin.matrix.clone().invert();
        const box = localBox(quoin).expandByScalar(-0.004);
        for (const stone of stones) {
          const position = stone.geo.getAttribute('position');
          for (let i = 0; i < position.count; i += 1) {
            const v = new THREE.Vector3()
              .fromBufferAttribute(position, i)
              .applyMatrix4(stone.matrix)
              .applyMatrix4(inverse);
            expect(box.containsPoint(v)).toBe(false);
          }
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('carries the chain down through the plinth to the ground on a slope', () => {
    // Maison loin du centre de la grille, où le relief (amplifié) fait pencher le terrain.
    const sloped = build(
      [
        [6, 6],
        [7, 6],
        [6, 7],
        [7, 7],
      ],
      3,
      0,
      1.6,
    );
    let plinths = 0;
    for (const [x, z] of [
      [6, 6],
      [7, 6],
      [6, 7],
      [7, 7],
    ]) {
      const ctx = sloped.contextAt(x, 0, z)!;
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const stones = column(sloped.at(x, 0, z), sx, sz);
        if (stones.length === 0) continue;
        const bottom = stones[0].centre.y + stones[0].box.min.y;
        const top = stones[stones.length - 1].centre.y + stones[stones.length - 1].box.max.y;
        // Du terrain au pied de l'angle jusqu'au plafond du rez-de-chaussée, sans trou.
        expect(top).toBeGreaterThan(0.5 - QUOIN_JOINT);
        // (au ras du pied, la colonne commence au pied, à un demi-joint près).
        expect(bottom).toBeLessThan(Math.max(ctx.groundAt!(sx * 0.5, sz * 0.5), -0.5) + QUOIN_JOINT);
        for (let i = 1; i < stones.length; i += 1) {
          const gap = stones[i].centre.y + stones[i].box.min.y - (stones[i - 1].centre.y + stones[i - 1].box.max.y);
          expect(gap).toBeGreaterThan(0);
          expect(gap).toBeLessThan(QUOIN_JOINT + 0.001);
        }
        if (bottom < -0.5 - 0.1) plinths += 1;
      }
    }
    // Au moins un angle descend bien plus bas que le pied du rez-de-chaussée.
    expect(plinths).toBeGreaterThan(0);
  });
});
