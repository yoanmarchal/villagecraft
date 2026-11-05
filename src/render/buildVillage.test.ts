import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../villageGrid';
import { buildVillage } from './buildVillage';
import { FLOOR_T, WALL_T } from './geometryCache';
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

  it('dessine les deux côtés des coques creuses, et d’elles seules', () => {
    const groups = build(sampleVillage(), SETTINGS);
    const doubleSided = groups.filter((g) => g.mat.doubleSide);
    expect(doubleSided).toHaveLength(1);
    expect(doubleSided[0].key.endsWith('|ds')).toBe(true);
    // Les autres pièces (toits, arches, décors) restent dans des groupes simple face.
    expect(groups.length).toBeGreaterThan(1);
  });

  it('rien du toit ne pend sous le plafond, entre une pièce sous toit et une pièce sous étage', () => {
    // 4 × 4 sur deux niveaux, 2 × 2 au centre sur un niveau de plus : au 1er
    // étage, le pourtour a un toit au-dessus et le centre un étage. Quand le
    // plafond du centre était ouvert (6 cm plus haut), les égouts et pans des
    // toits adossés pendaient dans ce ressaut (traits rouges au plafond).
    const grid = new VillageGrid(9, 10, 9);
    for (let x = 2; x < 6; x += 1) for (let z = 2; z < 6; z += 1) for (let i = 0; i < 2; i += 1) grid.addBlockInColumn(x, z);
    for (let x = 3; x < 5; x += 1) for (let z = 3; z < 5; z += 1) grid.addBlockInColumn(x, z);
    // Toits peints d'une couleur témoin (vert pur, et ses nuances) pour les reconnaître.
    const groups = build(grid, { ...SETTINGS, roofBaseColor: '#00ff00' });
    const meshes = groups.map(
      ({ geometry, key }) => Object.assign(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), { name: key }),
    );

    const [, y1] = grid.toWorldPosition(0, 1, 0);
    const ceiling = 0.5 - FLOOR_T; // sous le plafond, partout le même
    const [x2] = grid.toWorldPosition(2, 0, 0);
    const ray = new THREE.Raycaster();
    const intruders = new Set<string>();
    for (const row of [3, 4]) {
      const [, , z] = grid.toWorldPosition(0, 0, row);
      for (let dy = ceiling - 0.05; dy < ceiling; dy += 0.005) {
        ray.set(new THREE.Vector3(x2, y1 + dy, z + 0.2), new THREE.Vector3(1, 0, 0));
        ray.far = 3;
        for (const hit of ray.intersectObjects(meshes)) {
          const colors = (hit.object as THREE.Mesh).geometry.getAttribute('color');
          const [r, g, b] = [colors.getX(hit.face!.a), colors.getY(hit.face!.a), colors.getZ(hit.face!.a)];
          if (g > r + 0.2 && g > b + 0.2) intruders.add(`${hit.object.name} @ ${hit.point.toArray().map((v) => v.toFixed(2))}`);
        }
      }
    }
    expect([...intruders]).toEqual([]);
  });

  it('habille l’intérieur : parquet en bois et plafond distincts des murs', () => {
    const grid = new VillageGrid(9, 10, 9);
    for (let x = 2; x < 5; x += 1) for (let z = 2; z < 5; z += 1) grid.addBlockInColumn(x, z);
    const groups = build(grid, SETTINGS);
    const meshes = groups.map(
      ({ geometry, key }) => Object.assign(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), { name: key }),
    );
    const [cx, cy, cz] = grid.toWorldPosition(3, 0, 3);
    const colorAt = (dir: number) => {
      const hit = new THREE.Raycaster(new THREE.Vector3(cx + 0.2, cy, cz + 0.05), new THREE.Vector3(0, dir, 0)).intersectObjects(meshes)[0];
      const colors = (hit.object as THREE.Mesh).geometry.getAttribute('color');
      return new THREE.Color(colors.getX(hit.face!.a), colors.getY(hit.face!.a), colors.getZ(hit.face!.a));
    };
    const floor = colorAt(-1);
    const ceiling = colorAt(1);
    const wall = new THREE.Color(SETTINGS.wallBaseColor);
    // Parquet : brun (rouge > vert > bleu), bien plus sombre que la maçonnerie.
    expect(floor.r).toBeGreaterThan(floor.g);
    expect(floor.g).toBeGreaterThan(floor.b);
    expect(floor.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(wall.getHSL({ h: 0, s: 0, l: 0 }).l - 0.2);
    expect(ceiling.equals(wall)).toBe(false);
  });
});
