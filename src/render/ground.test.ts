import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../villageGrid';
import { useControlStore } from '../store/controlStore';
import { getExposedFaces, makeCellLookup } from '../utils/cellUtils';
import { buildVillage } from './buildVillage';
import { createGround, raycastGround } from './ground';
import { pavedCells } from './cells/pavingParts';
import { FLAT_RELIEF, RELIEF_GLSL, RELIEF_MAX, reliefFor, reliefHeight } from './relief';
import { pickRenderSettings } from './renderSettings';

const SETTINGS = pickRenderSettings(useControlStore.getState());
const SIZE = 12;
const RELIEF = reliefFor(SIZE, 1);

describe('relief', () => {
  it('laisse le centre du village à y = 0 et s’éteint aux abords', () => {
    expect(Math.abs(reliefHeight(0, 0, RELIEF))).toBeLessThan(1e-4);
    expect(reliefHeight(RELIEF.outer + 0.01, 0, RELIEF)).toBe(0);
    expect(reliefHeight(0, -RELIEF.outer - 5, RELIEF)).toBe(0);
    expect(reliefHeight(3, 4, FLAT_RELIEF)).toBe(0);
    expect(reliefFor(SIZE, 0)).toBe(FLAT_RELIEF);
  });

  it('donne un vrai dénivelé sous la grille, borné et sans marche', () => {
    let low = Infinity;
    let high = -Infinity;
    for (let x = -SIZE / 2; x <= SIZE / 2; x += 0.25) {
      for (let z = -SIZE / 2; z <= SIZE / 2; z += 0.25) {
        const height = reliefHeight(x, z, RELIEF);
        low = Math.min(low, height);
        high = Math.max(high, height);
        expect(Math.abs(height)).toBeLessThanOrEqual(RELIEF_MAX);
        // Pente douce : une rue reste praticable.
        expect(Math.abs(height - reliefHeight(x + 0.25, z, RELIEF))).toBeLessThan(0.25 * 0.45);
      }
    }
    expect(high - low).toBeGreaterThan(0.8);
  });

  it('est proportionnel à l’amplitude réglée', () => {
    expect(reliefHeight(3, -2, reliefFor(SIZE, 2))).toBeCloseTo(2 * reliefHeight(3, -2, RELIEF), 10);
  });

  it('expose la même formule aux shaders', () => {
    expect(RELIEF_GLSL).toContain('float vcGroundHeight(vec2 p)');
    expect(RELIEF_GLSL.match(/sin\(/g)).toHaveLength(3);
    expect(RELIEF_GLSL).not.toMatch(/NaN|undefined/);
  });
});

/** Deux bâtiments séparés par une rue, et une tour. */
function slopeVillage(): VillageGrid {
  const grid = new VillageGrid(SIZE, 10, SIZE);
  for (let x = 1; x <= 4; x += 1) for (let z = 2; z <= 3; z += 1) grid.addBlockInColumn(x, z);
  for (let x = 1; x <= 4; x += 1) for (let z = 5; z <= 6; z += 1) grid.addBlockInColumn(x, z);
  for (let i = 0; i < 3; i += 1) grid.addBlockInColumn(9, 9);
  return grid;
}

const toWorld = (grid: VillageGrid) => (x: number, y: number, z: number) => grid.toWorldPosition(x, y, z);

describe('createGround', () => {
  const grid = slopeVillage();
  const cells = grid.getOccupiedCells();
  const ground = createGround(cells, toWorld(grid), RELIEF);

  it('donne un seul niveau à toutes les colonnes d’un bâtiment : il ne penche pas, ses pièces restent de plain-pied', () => {
    const first = ground.baseAt(1, 2);
    for (let x = 1; x <= 4; x += 1) for (let z = 2; z <= 3; z += 1) expect(ground.baseAt(x, z)).toBe(first);
  });

  it('pose chaque bâtiment au point haut du terrain sous lui : jamais de sol au-dessus du plancher', () => {
    for (const cell of cells) {
      if (cell.y !== 0) continue;
      const [wx, , wz] = grid.toWorldPosition(cell.x, 0, cell.z);
      const base = ground.baseAt(cell.x, cell.z);
      for (let dx = -0.5; dx <= 0.5; dx += 0.125) {
        for (let dz = -0.5; dz <= 0.5; dz += 0.125) {
          expect(ground.heightAt(wx + dx, wz + dz)).toBeLessThanOrEqual(base + 0.004);
        }
      }
    }
    // … et pas plus haut que nécessaire : le terrain l'atteint quelque part sous lui.
    let reach = -Infinity;
    for (let x = 1; x <= 5; x += 0.05) {
      for (let z = 2; z <= 4; z += 0.05) reach = Math.max(reach, ground.heightAt(x - SIZE / 2, z - SIZE / 2));
    }
    expect(ground.baseAt(1, 2) - reach).toBeLessThan(0.02);
  });

  it('laisse leur propre niveau à des bâtiments séparés par une rue', () => {
    expect(ground.baseAt(1, 2)).not.toBe(ground.baseAt(1, 5));
    expect(ground.baseAt(9, 9)).not.toBe(ground.baseAt(1, 2));
  });

  it('met de niveau les deux appuis d’une arche', () => {
    const linked = slopeVillage();
    // Rue en z = 4 entre les deux bâtiments (3 niveaux de mur + toit) : une arche s'y tend.
    for (let i = 0; i < 2; i += 1) {
      for (const z of [3, 5]) for (let x = 1; x <= 4; x += 1) linked.addBlockInColumn(x, z);
    }
    const linkedCells = linked.getOccupiedCells();
    expect(linkedCells.some((cell) => cell.z === 4)).toBe(true);
    const joined = createGround(linkedCells, toWorld(linked), RELIEF);
    expect(joined.baseAt(1, 3)).toBe(joined.baseAt(1, 5));
  });

  it('annonce le niveau qu’aurait un bloc posé sur une case libre', () => {
    // Contre un bâtiment : il le rejoint, donc au moins son niveau.
    expect(ground.baseAt(5, 2)).toBeGreaterThanOrEqual(ground.baseAt(4, 2));
    // Loin de tout : le point haut du terrain sous la case.
    const [wx, , wz] = grid.toWorldPosition(10, 0, 1);
    expect(ground.baseAt(10, 1)).toBeGreaterThanOrEqual(ground.heightAt(wx, wz));
    expect(ground.baseAt(10, 1) - ground.heightAt(wx, wz)).toBeLessThan(0.4);
  });

  it('reste à 0 partout sur terrain plat', () => {
    const flat = createGround(cells, toWorld(grid), FLAT_RELIEF);
    expect(flat.baseAt(1, 2)).toBe(0);
    expect(flat.heightAt(3, 3)).toBe(0);
  });
});

describe('raycastGround', () => {
  const ground = createGround([], (x, y, z) => [x, y, z], RELIEF);

  it('trouve le point du terrain sous un rayon vertical ou rasant', () => {
    const down = raycastGround(ground, [2, 30, -3], [0, -1, 0]);
    expect(down).not.toBeNull();
    expect(30 - down!.t).toBeCloseTo(ground.heightAt(2, -3), 3);

    const direction = new THREE.Vector3(1, -0.15, 0.3).normalize();
    const hit = raycastGround(ground, [-20, 4, -6], [direction.x, direction.y, direction.z]);
    expect(hit).not.toBeNull();
    expect(4 + direction.y * hit!.t).toBeCloseTo(ground.heightAt(hit!.x, hit!.z), 3);
  });

  it('ne trouve rien vers le ciel', () => {
    expect(raycastGround(ground, [0, 3, 0], [0.6, 0.8, 0])).toBeNull();
  });
});

describe('village sur un terrain en pente', () => {
  const grid = slopeVillage();
  const cells = grid.getOccupiedCells();
  const ground = createGround(cells, toWorld(grid), RELIEF);
  const groups = buildVillage(cells, toWorld(grid), SETTINGS, { width: SIZE, depth: SIZE, relief: 1 });
  const meshes = groups.map(
    ({ geometry }) => new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
  );
  const raycaster = new THREE.Raycaster();
  const cast = (origin: [number, number, number], direction: [number, number, number], far: number) => {
    raycaster.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
    raycaster.far = far;
    return raycaster.intersectObjects(meshes, false);
  };

  it('place chaque cellule au niveau de son bâtiment, d’aplomb au-dessus de sa case', () => {
    const pivots = new Set(
      cells.map((cell) => {
        const [wx, wy, wz] = grid.toWorldPosition(cell.x, cell.y, cell.z);
        return `${wx * 2},${Math.round((wy + ground.baseAt(cell.x, cell.z)) * 100)},${wz * 2}`;
      }),
    );
    let checked = 0;
    for (const { geometry } of groups) {
      const cell = geometry.getAttribute('aCell');
      for (let i = 0; i < cell.count; i += 53) {
        const key = `${cell.getX(i)},${cell.getY(i)},${cell.getZ(i)}`;
        // Pavés et décor : pivot au sol (y = 0), sans animation.
        if (cell.getY(i) === 0) continue;
        expect(pivots.has(key)).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('prolonge les murs jusqu’au sol par un soubassement, côté aval', () => {
    const lookup = makeCellLookup(cells);
    const out = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] } as const;
    let deep = 0;
    for (const cell of cells) {
      if (cell.y !== 0) continue;
      const [wx, , wz] = grid.toWorldPosition(cell.x, 0, cell.z);
      const base = ground.baseAt(cell.x, cell.z);
      for (const face of getExposedFaces(lookup, cell)) {
        const [ox, oz] = out[face];
        const soil = ground.heightAt(wx + ox * 0.5, wz + oz * 0.5);
        if (base - soil < 0.1) continue;
        deep += 1;
        // Rayon horizontal vers le mur, à mi-hauteur entre le sol et le pied du bâtiment.
        const y = (base + soil) / 2;
        const hits = cast([wx + ox * 0.6, y, wz + oz * 0.6], [-ox, 0, -oz], 0.11);
        expect(hits.length).toBeGreaterThan(0);
      }
    }
    expect(deep).toBeGreaterThan(3);
  });

  it('couche les pavés sur la pente : ni enterrés, ni en l’air', () => {
    const paved = pavedCells(makeCellLookup(cells), { width: SIZE, depth: SIZE });
    expect(paved.size).toBeGreaterThan(10);
    for (const key of paved) {
      const [x, z] = key.split(',').map(Number);
      const [wx, , wz] = grid.toWorldPosition(x, 0, z);
      for (const [dx, dz] of [
        [0, 0],
        [0.2, -0.15],
        [-0.25, 0.2],
      ]) {
        const soil = ground.heightAt(wx + dx, wz + dz);
        // Dessus du pavé (ou de son lit, dans un joint) : de 0 à 5 cm au-dessus du terrain.
        // (Un perron peut le recouvrir : on cherche le pavé parmi tout ce que le rayon traverse.)
        const tops = cast([wx + dx, soil + 1, wz + dz], [0, -1, 0], 1.2).map((hit) => hit.point.y - soil);
        expect(tops.some((top) => top > -0.004 && top < 0.055)).toBe(true);
      }
    }
  });

  it('reste identique au village plat quand le relief est nul', () => {
    const flat = buildVillage(cells, toWorld(grid), SETTINGS, { width: SIZE, depth: SIZE });
    const zero = buildVillage(cells, toWorld(grid), SETTINGS, { width: SIZE, depth: SIZE, relief: 0 });
    expect(zero.map(({ geometry }) => geometry.getAttribute('position').count)).toEqual(
      flat.map(({ geometry }) => geometry.getAttribute('position').count),
    );
  });
});
