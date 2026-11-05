import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../villageGrid';
import { buildVillage } from './buildVillage';
import { WALL_T } from './geometryCache';
import type { RenderSettings } from './renderSettings';

const SETTINGS: RenderSettings = {
  wallRoughness: 0.94,
  wallBaseColor: '#f5e6d3',
  roofBaseColor: '#c85a3f',
  spireColor: '#56606c',
  windowStonesPerFace: 25,
  windowStoneRoughness: 0.85,
  quoinMargin: 0.2,
  quoinRoughness: 0.9,
  ridgeY: 0.22,
  towerR: 0.5,
  merlonCount: 6,
  merlonR: 0.1,
  merlonH: 0.28,
  spireH: 1.1,
  isolatedWallRadius: 0.22,
  connectedWallExposedRadius: 0.1,
  connectedWallInteriorRadius: 0.0,
};

/** Un petit village couvrant tous les types : murs, fenêtres, toits, tour, arche. */
function sampleVillage(): VillageGrid {
  const grid = new VillageGrid(5, 10, 5);
  for (let i = 0; i < 3; i += 1) grid.addBlockInColumn(0, 0);
  for (let i = 0; i < 3; i += 1) grid.addBlockInColumn(2, 0);
  grid.addBlock(1, 1, 0); // arche
  for (let i = 0; i < 2; i += 1) grid.addBlockInColumn(0, 1);
  for (let i = 0; i < 4; i += 1) grid.addBlockInColumn(4, 4); // tour isolée
  return grid;
}

function build(grid: VillageGrid, settings: RenderSettings) {
  return buildVillage(grid.getOccupiedCells(), (x, y, z) => grid.toWorldPosition(x, y, z), settings);
}

const attr = (geometry: THREE.BufferGeometry, name: string) =>
  Array.from((geometry.getAttribute(name) as THREE.BufferAttribute).array);

describe('buildVillage', () => {
  it('produit peu de groupes, tous avec des positions finies', () => {
    const groups = build(sampleVillage(), SETTINGS);

    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(20);
    for (const { geometry } of groups) {
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(attr(geometry, 'position').every(Number.isFinite)).toBe(true);
    }
  });

  it('est déterministe pour une même entrée', () => {
    const grid = sampleVillage();
    const a = build(grid, SETTINGS);
    const b = build(grid, SETTINGS);

    expect(a.map((g) => g.key)).toEqual(b.map((g) => g.key));
    a.forEach((group, i) => expect(attr(group.geometry, 'position')).toEqual(attr(b[i].geometry, 'position')));
  });

  it('applique la couleur des réglages sans toucher à la géométrie', () => {
    const grid = sampleVillage();
    const base = build(grid, SETTINGS);
    const recolored = build(grid, { ...SETTINGS, wallBaseColor: '#3366aa' });

    const allColors = (groups: typeof base) => groups.flatMap((g) => attr(g.geometry, 'color'));
    const allPositions = (groups: typeof base) => groups.flatMap((g) => attr(g.geometry, 'position'));
    expect(allColors(recolored)).not.toEqual(allColors(base));
    expect(allPositions(recolored)).toEqual(allPositions(base));
  });

  it('les réglages de forme changent la géométrie', () => {
    const grid = sampleVillage();
    const base = build(grid, SETTINGS);
    const taller = build(grid, { ...SETTINGS, spireH: 2 });

    const allPositions = (groups: typeof base) => groups.flatMap((g) => attr(g.geometry, 'position'));
    expect(allPositions(taller)).not.toEqual(allPositions(base));
  });

  it('ne laisse rien dépasser à l’intérieur d’un bâtiment creux', () => {
    // 6 × 6 de plain-pied : 16 cellules Foundation au milieu, des jonctions de
    // façade partout. La dalle de fondation (à mi-hauteur) et les quoins plus
    // profonds que le mur flottaient ou saillaient dans la pièce.
    const grid = new VillageGrid(9, 10, 9);
    for (let x = 0; x < 6; x += 1) for (let z = 0; z < 6; z += 1) grid.addBlockInColumn(x, z);
    const meshes = build(grid, SETTINGS).map(
      ({ geometry }) => new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })),
    );

    const [x0, y0, z0] = grid.toWorldPosition(0, 0, 0);
    const [x5, , z5] = grid.toWorldPosition(5, 0, 5);
    const inner = 0.5 - WALL_T - 0.005;
    const inside = (p: THREE.Vector3) =>
      p.x > x0 - inner && p.x < x5 + inner && p.z > z0 - inner && p.z < z5 + inner;

    const strays: string[] = [];
    const ray = new THREE.Raycaster();
    for (let i = 0; i < 6; i += 1) {
      for (const offset of [-0.36, 0, 0.36]) {
        for (const dy of [-0.32, 0, 0.32]) {
          const [cx, , cz] = grid.toWorldPosition(i, 0, i);
          // Le long de X puis le long de Z, à travers toute la rangée.
          ray.set(new THREE.Vector3(x0 - 3, y0 + dy, cz + offset), new THREE.Vector3(1, 0, 0));
          for (const hit of ray.intersectObjects(meshes)) if (inside(hit.point)) strays.push(hit.point.toArray().join(','));
          ray.set(new THREE.Vector3(cx + offset, y0 + dy, z0 - 3), new THREE.Vector3(0, 0, 1));
          for (const hit of ray.intersectObjects(meshes)) if (inside(hit.point)) strays.push(hit.point.toArray().join(','));
        }
      }
    }
    expect(strays).toEqual([]);
  });
});
