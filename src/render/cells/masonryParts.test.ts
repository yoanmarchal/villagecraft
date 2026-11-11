import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../../villageGrid';
import { getCornerRadii, makeCellLookup } from '../../utils/cellUtils';
import { pickRenderSettings } from '../renderSettings';
import { useControlStore } from '../../store/controlStore';
import type { Part } from '../parts';
import { courseBed, MASONRY_COURSES, masonryFacesOf, masonryParts } from './masonryParts';

const SETTINGS = pickRenderSettings(useControlStore.getState());

/** Boîte englobante (repère cellule) de chaque pierre, avec sa teinte. */
function boxesOf(parts: Part[]) {
  return parts.map((p) => {
    p.geo.computeBoundingBox();
    return { box: p.geo.boundingBox!.clone().applyMatrix4(p.matrix), color: p.color };
  });
}

/** Mur droit de `length` cases le long de X, sur `storeys` niveaux, et les pierres de la face avant de chaque case. */
function wall(length: number, storeys = 1) {
  const grid = new VillageGrid(8, 10, 8);
  for (let x = 1; x <= length; x += 1) for (let i = 0; i < storeys; i += 1) grid.addBlockInColumn(x, 3);
  const cells = grid.getOccupiedCells();
  const lookup = makeCellLookup(cells);
  const stonesOf = (x: number, y: number) => {
    const cell = cells.find((c) => c.x === x && c.y === y && c.z === 3)!;
    const radii = getCornerRadii(lookup, cell, SETTINGS);
    return boxesOf(masonryParts({ cell, lookup, radii }, [{ face: 'front' }], '#f5e6d3', 0.85));
  };
  return { cells, lookup, stonesOf };
}

describe('courseBed', () => {
  it('monte strictement, avec un lit à chaque niveau', () => {
    for (let k = -MASONRY_COURSES; k < 4 * MASONRY_COURSES; k += 1) {
      expect(courseBed(k + 1)).toBeGreaterThan(courseBed(k) + 0.04);
    }
    for (let storey = -1; storey < 5; storey += 1) expect(courseBed(storey * MASONRY_COURSES)).toBe(storey);
  });
});

describe('masonryParts', () => {
  it('pose de vraies pierres en saillie sur le nu du mur', () => {
    const stones = wall(3).stonesOf(2, 0);
    expect(stones.length).toBeGreaterThan(30);
    for (const { box } of stones) {
      // Encastrées dans le mur, saillantes de 1,4 à 2,4 cm.
      expect(box.min.z).toBeLessThan(0.5);
      expect(box.max.z).toBeGreaterThan(0.5 + 0.013);
      expect(box.max.z).toBeLessThan(0.5 + 0.025);
      // Dans l'emprise de la face.
      expect(box.min.x).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(box.max.x).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.5);
      expect(box.max.y).toBeLessThanOrEqual(0.5);
    }
  });

  it('continue son appareil de case en case : une pierre à cheval se raccorde bord à bord', () => {
    const { stonesOf } = wall(3);
    const left = stonesOf(1, 0);
    const right = stonesOf(2, 0);
    // Morceaux qui touchent la limite commune : bord droit de la case 1, bord gauche de la case 2.
    const leftHalves = left.filter(({ box }) => Math.abs(box.max.x - 0.5) < 1e-6);
    const rightHalves = right.filter(({ box }) => Math.abs(box.min.x + 0.5) < 1e-6);
    expect(leftHalves.length).toBeGreaterThan(3);
    // Un morceau de moins d'un centimètre et demi n'est pas posé : d'un côté
    // ou de l'autre, il peut donc manquer le pendant d'une pierre.
    expect(Math.abs(rightHalves.length - leftHalves.length)).toBeLessThanOrEqual(2);
    const [fewer, others] =
      leftHalves.length <= rightHalves.length ? [leftHalves, rightHalves] : [rightHalves, leftHalves];
    for (const half of fewer) {
      // Même assise, même saillie, même teinte : les deux morceaux forment une seule pierre.
      const twin = others.find(({ box }) => Math.abs(box.min.y - half.box.min.y) < 1e-6);
      expect(twin).toBeDefined();
      expect(twin!.box.max.y).toBeCloseTo(half.box.max.y, 6);
      expect(twin!.box.max.z).toBeCloseTo(half.box.max.z, 6);
      expect(twin!.color).toBe(half.color);
    }
  });

  it('ne met aucune pierre à cheval sur deux niveaux', () => {
    const { stonesOf } = wall(2, 2);
    for (const y of [0, 1]) {
      const stones = stonesOf(1, y);
      expect(Math.min(...stones.map(({ box }) => box.min.y))).toBeGreaterThan(-0.5);
      expect(Math.max(...stones.map(({ box }) => box.max.y))).toBeLessThan(0.5);
    }
  });

  it('découpe les pierres autour des ouvertures', () => {
    const { cells, lookup } = wall(3);
    const cell = cells.find((c) => c.x === 2)!;
    const radii = getCornerRadii(lookup, cell, SETTINGS);
    const hole = { t0: -0.3, t1: 0.3, y0: -0.25, y1: 0.25 };
    const stones = boxesOf(masonryParts({ cell, lookup, radii }, [{ face: 'front', holes: [hole] }], '#f5e6d3', 0.85));
    const area = new THREE.Box2(
      new THREE.Vector2(hole.t0 + 1e-6, hole.y0 + 1e-6),
      new THREE.Vector2(hole.t1 - 1e-6, hole.y1 - 1e-6),
    );
    for (const { box } of stones) {
      const footprint = new THREE.Box2(
        new THREE.Vector2(box.min.x, box.min.y),
        new THREE.Vector2(box.max.x, box.max.y),
      );
      expect(footprint.intersectsBox(area)).toBe(false);
    }
    // Le reste de la face est bien garni, jusqu'au ras de la baie.
    expect(stones.length).toBeGreaterThan(25);
    expect(stones.some(({ box }) => Math.abs(box.max.x - hole.t0) < 0.01)).toBe(true);
  });

  it('habille les coins arrondis des tours, sans jour entre les faces', () => {
    const grid = new VillageGrid(5, 10, 5);
    grid.addBlockInColumn(2, 2);
    const cells = grid.getOccupiedCells();
    const lookup = makeCellLookup(cells);
    const cell = cells.find((c) => c.y === 0)!;
    const radii = getCornerRadii(lookup, cell, SETTINGS);
    expect(radii.max).toBeGreaterThan(0.1);
    const faces = masonryFacesOf(lookup, cell);
    expect(faces).toHaveLength(4);
    const stones = boxesOf(
      masonryParts(
        { cell, lookup, radii },
        faces.map((face) => ({ face })),
        '#f5e6d3',
        0.85,
      ),
    );
    // Des pierres jusque dans la diagonale des quatre coins.
    for (const [sx, sz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const diagonal = new THREE.Vector3(sx * (0.5 - radii.max * 0.3), 0, sz * (0.5 - radii.max * 0.3));
      expect(stones.some(({ box }) => box.distanceToPoint(diagonal) < 0.03)).toBe(true);
    }
    // Rien ne déborde du contour de la tour de plus que la saillie des pierres.
    for (const { box } of stones) {
      const reach = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
      expect(reach).toBeLessThan(0.53);
    }
  });

  it('est déterministe', () => {
    const signature = () =>
      wall(3)
        .stonesOf(2, 0)
        .map(({ box, color }) => `${box.min.x.toFixed(4)},${box.min.y.toFixed(4)},${box.max.z.toFixed(4)},${color}`)
        .join('|');
    expect(signature()).toBe(signature());
  });
});
