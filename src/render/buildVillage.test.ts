import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VillageGrid } from '../villageGrid';
import { buildVillage, CHUNK_SIZE, VillageChunkCache } from './buildVillage';
import { FLOOR_T, WALL_T } from './geometryCache';
import { PARAPET_H, WALKWAY_H } from './cells/walkwayParts';
import { BlockType } from '../types';
import { getRidgeAxis, makeCellLookup } from '../utils/cellUtils';
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

  describe('arche entre une tour et un bâtiment haut', () => {
    // Tour en (2, 4), bâtiment de deux cases (z = 4, 5), 3 étages de murs +
    // toit, en x = 4 : arche automatique en (3, 1, 4) ; au-dessus, les deux
    // appuis ont un mur, d'où un chemin de ronde crénelé de l'un à l'autre.
    const grid = new VillageGrid(9, 10, 9);
    for (let i = 0; i < 4; i += 1) grid.addBlockInColumn(2, 4);
    for (const bz of [4, 5]) for (let y = 0; y < 4; y += 1) grid.addBlock(4, y, bz);
    const meshes = build(grid, SETTINGS).map(
      ({ geometry, key }) => Object.assign(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), { name: key }),
    );
    const [ax, ay, az] = grid.toWorldPosition(3, 1, 4);

    it('est bien une arche', () => {
      expect(grid.getOccupiedCells().find((c) => c.x === 3 && c.y === 1 && c.z === 4)?.type).toBe(BlockType.Arch);
    });

    it('épouse les coins arrondis de la tour, jusqu’en haut du parapet', () => {
      // Juste dans la case de la tour, le long de la face de l'arche : sans
      // raccord, le coin arrondi de la tour laisse un jour de ~11 cm.
      for (const dy of [-0.3, 0, 0.3, 0.6]) {
        for (const side of [1, -1]) {
          const ray = new THREE.Raycaster(new THREE.Vector3(ax - 0.53, ay + dy, az + side * 3), new THREE.Vector3(0, 0, -side));
          const hit = ray.intersectObjects(meshes)[0];
          expect(Math.abs(hit.point.z - az)).toBeGreaterThanOrEqual(0.495);
        }
      }
    });

    it('n’a pas de rainure ouverte entre la corniche et le parapet', () => {
      // Entre le dessus de la corniche (0.03) et le dessus des dalles (0.06).
      for (const side of [1, -1]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(ax, ay + 0.5 + 0.045, az + side * 3), new THREE.Vector3(0, 0, -side));
        const hit = ray.intersectObjects(meshes)[0];
        // Le parapet (nu extérieur à 0.52) arrête le rayon, pas le bord des dalles (0.40).
        expect(Math.abs(hit.point.z - az)).toBeGreaterThan(0.5);
      }
    });

    it('a des archères qui traversent les merlons', () => {
      // Merlons à x = ±0.25 ; fente centrée un peu sous le milieu du merlon.
      const slitY = 0.5 + WALKWAY_H + PARAPET_H + SETTINGS.merlonH / 2 - SETTINGS.merlonH * 0.05;
      for (const x of [-0.25, 0.25]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(ax + x, ay + slitY, az + 3), new THREE.Vector3(0, 0, -1));
        ray.far = 6;
        expect(ray.intersectObjects(meshes)).toEqual([]);
        // À côté de la fente, le merlon est bien plein.
        ray.set(new THREE.Vector3(ax + x + 0.06, ay + slitY, az + 3), new THREE.Vector3(0, 0, -1));
        expect(ray.intersectObjects(meshes).length).toBeGreaterThan(0);
      }
    });
  });

  it('prolonge le toit d’un appui qui arrive au niveau du dessus de l’arche, plutôt que des merlons', () => {
    // Tour en (2, 4) ; maison de deux cases (z = 4, 5 — d'une seule case, son
    // toit isolé serait une flèche de tour), 2 étages de murs, toit à deux
    // pans au 3e niveau (y = 2), en x = 4. Le dessus de l'arche (y = 2)
    // touche ce toit : un chemin de ronde y adosserait des merlons à des tuiles.
    const grid = new VillageGrid(9, 10, 9);
    for (let i = 0; i < 4; i += 1) grid.addBlockInColumn(2, 4);
    for (const bz of [4, 5]) for (let y = 0; y < 3; y += 1) grid.addBlock(4, y, bz);
    expect(grid.getCell({ x: 3, y: 1, z: 4 })?.type).toBe(BlockType.Arch);
    expect(grid.getCell({ x: 4, y: 2, z: 4 })?.type).toBe(BlockType.Roof);

    // Toits en vert pur pour les reconnaître.
    const meshes = build(grid, { ...SETTINGS, roofBaseColor: '#00ff00' }).map(
      ({ geometry, key }) => Object.assign(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), { name: key }),
    );
    const [ax, ay, az] = grid.toWorldPosition(3, 1, 4);
    const hit = new THREE.Raycaster(new THREE.Vector3(ax, ay + 5, az + 0.3), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes)[0];
    const colors = (hit.object as THREE.Mesh).geometry.getAttribute('color');
    const [r, g, b] = [colors.getX(hit.face!.a), colors.getY(hit.face!.a), colors.getZ(hit.face!.a)];
    expect(g).toBeGreaterThan(r + 0.2);
    expect(g).toBeGreaterThan(b + 0.2);
    // Et aucun merlon : rien au-dessus du toit à hauteur de créneau, à l'aplomb des merlons.
    const merlonY = ay + 0.5 + WALKWAY_H + PARAPET_H + SETTINGS.merlonH / 2;
    const across = new THREE.Raycaster(new THREE.Vector3(ax + 0.25 + 0.06, merlonY, az + 3), new THREE.Vector3(0, 0, -1));
    across.far = 2.5;
    expect(across.intersectObjects(meshes).every((h) => {
      const c = (h.object as THREE.Mesh).geometry.getAttribute('color');
      return c.getY(h.face!.a) > c.getX(h.face!.a) + 0.2;
    })).toBe(true);
  });

  describe('jonction de toits perpendiculaires', () => {
    /** Hauteur du premier toit rencontré par un rayon vertical en (x, z) monde. */
    const roofHeight = (meshes: THREE.Object3D[], x: number, z: number) =>
      new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes)[0]?.point.y;
    const meshesOf = (grid: VillageGrid) =>
      build(grid, SETTINGS).map(({ geometry }) => new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
    /**
     * De part et d'autre de la frontière entre la case de jonction `c` et son
     * aile (direction `d`), sur l'axe de l'aile : le toit doit être continu.
     * Avant, l'aile butait, bout ouvert à pleine hauteur de faîtage, contre le
     * pan descendant de la jonction (trou de ~0.6).
     */
    const jumpAtBoundary = (grid: VillageGrid, meshes: THREE.Object3D[], c: [number, number], d: [number, number]) => {
      const [cx, , cz] = grid.toWorldPosition(c[0], 1, c[1]);
      const inside = roofHeight(meshes, cx + d[0] * 0.45, cz + d[1] * 0.45)!;
      const beyond = roofHeight(meshes, cx + d[0] * 0.55, cz + d[1] * 0.55)!;
      return Math.abs(inside - beyond);
    };

    it('fusionne les toits d’un coin en L', () => {
      // Maisons de plain-pied en (2, 2), (3, 2) et (2, 3) : coin en (2, 2).
      const grid = new VillageGrid(9, 10, 9);
      for (const [x, z] of [[2, 2], [3, 2], [2, 3]]) grid.addBlockInColumn(x, z);
      const meshes = meshesOf(grid);
      expect(jumpAtBoundary(grid, meshes, [2, 2], [1, 0])).toBeLessThan(0.1);
      expect(jumpAtBoundary(grid, meshes, [2, 2], [0, 1])).toBeLessThan(0.1);
    });

    it('garde des faîtages parallèles dans un bloc large, sans les croiser', () => {
      // Bloc de plain-pied 4 × 2 (x = 2..5, z = 2..3) : toutes les cases ont
      // des voisins sur les deux axes, mais ce n'est pas une jonction d'ailes.
      const grid = new VillageGrid(9, 10, 9);
      for (let x = 2; x < 6; x += 1) for (let z = 2; z < 4; z += 1) grid.addBlockInColumn(x, z);
      const meshes = meshesOf(grid);
      const [x3, , z2] = grid.toWorldPosition(3, 1, 2);
      const ridge = roofHeight(meshes, x3 + 0.2, z2)!;
      // Faîtage continu selon X (le long du bloc), y compris d'une case à l'autre…
      expect(Math.abs(roofHeight(meshes, x3 + 0.5, z2)! - ridge)).toBeLessThan(0.1);
      // …et une noue entre les deux rangées, pas un faîtage croisé selon Z.
      expect(roofHeight(meshes, x3 + 0.2, z2 + 0.5)!).toBeLessThan(ridge - 0.4);
    });

    it('oriente tout un bloc carré de la même façon, même contre un mur plus haut', () => {
      // Bloc 2 × 2 de plain-pied, mur de 3 niveaux contre (3, 2) : à égalité,
      // cette case prenait l'axe de ses voisins (X) et croisait les autres (Z).
      const grid = new VillageGrid(9, 10, 9);
      for (let x = 2; x < 4; x += 1) for (let z = 2; z < 4; z += 1) grid.addBlockInColumn(x, z);
      for (let y = 0; y < 3; y += 1) grid.addBlock(4, y, 2);
      const lookup = makeCellLookup(grid.getOccupiedCells());
      const axes = new Set(
        grid.getOccupiedCells().filter((c) => c.y === 1 && c.x < 4).map((c) => getRidgeAxis(lookup, c)),
      );
      expect(axes.size).toBe(1);
    });

    it('prolonge sur une arche le toit de l’appui dans son orientation', () => {
      // Tour en (1, 2) ; maison en rangée selon X (x = 1..3, z = 4), toit à
      // y = 2, faîtage selon X ; arche en (1, 1, 3), portée selon Z. Son toit
      // suivait la portée (Z) et butait, bout ouvert, contre le pan de la maison.
      const grid = new VillageGrid(9, 10, 9);
      for (let y = 0; y < 3; y += 1) grid.addBlock(1, y, 2);
      for (let x = 1; x < 4; x += 1) for (let y = 0; y < 3; y += 1) grid.addBlock(x, y, 4);
      expect(grid.getCell({ x: 1, y: 1, z: 3 })?.type).toBe(BlockType.Arch);
      const meshes = meshesOf(grid);
      const [ax, , az] = grid.toWorldPosition(1, 1, 3);
      const ridge = roofHeight(meshes, ax + 0.3, az)!;
      // Faîtage selon X : même hauteur le long de X, pans qui descendent selon Z…
      expect(Math.abs(roofHeight(meshes, ax - 0.3, az)! - ridge)).toBeLessThan(0.1);
      expect(roofHeight(meshes, ax, az - 0.4)!).toBeLessThan(ridge - 0.4);
      // …et continu avec le toit de la maison au-delà de l'appui.
      expect(jumpAtBoundary(grid, meshes, [1, 3], [0, 1])).toBeLessThan(0.45);
    });

    it('arrête la demi-aile d’un coin en L contre le pignon, sans rien devant son pied', () => {
      // Aile selon Z (x = 3, z = 0..3), aile selon X (x = 1..2, z = 3) : le
      // coin (3, 3) suit l'aile la plus longue (Z), pignon en façade (+Z) ;
      // l'aile X y entre par une demi-aile. Son pan avant passait devant le
      // pied du pignon jusqu'à la façade, liteaux et bandeau d'égout compris.
      const grid = new VillageGrid(9, 10, 9);
      for (const [x, z] of [[3, 0], [3, 1], [3, 2], [3, 3], [1, 3], [2, 3]]) grid.addBlockInColumn(x, z);
      const meshes = meshesOf(grid);
      const [cx, cy, cz] = grid.toWorldPosition(3, 1, 3);
      // Juste au-dessus de l'égout, côté de la demi-aile, à l'aplomb d'un liteau.
      const hit = new THREE.Raycaster(new THREE.Vector3(cx - 0.4, cy - 0.47, cz + 3), new THREE.Vector3(0, 0, -1)).intersectObjects(meshes)[0];
      expect(hit.point.z - cz).toBeLessThanOrEqual(0.505); // la face du pignon (0.501), rien devant
      // Et le toit reste continu entre l'aile X et le coin.
      expect(jumpAtBoundary(grid, meshes, [3, 3], [-1, 0])).toBeLessThan(0.1);
    });

    it('ne laisse rien dépasser au pied d’un pignon', () => {
      // Maison de plain-pied en rangée selon X (x = 2..4, z = 4) : pignons à
      // ±X. Près de l'égout, rien ne doit dépasser le nu du bandeau bas de
      // pignon (0.544) — le bandeau d'égout latéral allait jusqu'à 0.57.
      const grid = new VillageGrid(9, 10, 9);
      for (const x of [2, 3, 4]) grid.addBlockInColumn(x, 4);
      const meshes = meshesOf(grid);
      const [ex, ey, ez] = grid.toWorldPosition(4, 1, 4);
      for (const dz of [-0.52, 0.52]) {
        const hit = new THREE.Raycaster(new THREE.Vector3(ex + 3, ey - 0.52, ez + dz), new THREE.Vector3(-1, 0, 0)).intersectObjects(meshes)[0];
        expect(hit.point.x - ex).toBeLessThanOrEqual(0.545);
      }
      // Le bandeau bas du pignon couvre le bout des pans et des bandeaux
      // latéraux (nu à 0.54) : sa face est devant, pas dans le même plan.
      for (const dz of [-0.48, 0, 0.48]) {
        const hit = new THREE.Raycaster(new THREE.Vector3(ex + 3, ey - 0.495, ez + dz), new THREE.Vector3(-1, 0, 0)).intersectObjects(meshes)[0];
        expect(hit.point.x - ex).toBeGreaterThan(0.542);
      }
    });

    it('fusionne l’aile d’une jonction en T sans pignon au dos', () => {
      // Rangée (1..3, 2) et aile en (2, 3) : jonction en (2, 2).
      const grid = new VillageGrid(9, 10, 9);
      for (const [x, z] of [[1, 2], [2, 2], [3, 2], [2, 3]]) grid.addBlockInColumn(x, z);
      const meshes = meshesOf(grid);
      expect(jumpAtBoundary(grid, meshes, [2, 2], [0, 1])).toBeLessThan(0.1);
      expect(jumpAtBoundary(grid, meshes, [2, 2], [1, 0])).toBeLessThan(0.1);
      // Au dos (côté sans aile), le pan du toit principal descend normalement :
      // pas de pignon d'aile qui dépasse au milieu du pan.
      const [cx, , cz] = grid.toWorldPosition(2, 1, 2);
      const ridge = roofHeight(meshes, cx + 0.2, cz)!;
      expect(roofHeight(meshes, cx + 0.2, cz - 0.4)!).toBeLessThan(ridge - 0.4);
    });
  });
});

describe('VillageChunkCache', () => {
  const SIZE = 8;
  const ground = { width: SIZE, depth: SIZE };
  const vertexCount = (groups: ReturnType<typeof buildVillage>) =>
    groups.reduce((sum, { geometry }) => sum + geometry.getAttribute('position').count, 0);

  function bigVillage(): VillageGrid {
    const grid = new VillageGrid(SIZE, 10, SIZE);
    grid.generateTerrain(SIZE, 7);
    return grid;
  }

  const run = (cache: VillageChunkCache, grid: VillageGrid) =>
    cache.build(grid.getOccupiedCells(), (x, y, z) => grid.toWorldPosition(x, y, z), SETTINGS, ground);

  it('produces the same geometry as a full build, split by chunk', () => {
    const grid = bigVillage();
    const full = buildVillage(grid.getOccupiedCells(), (x, y, z) => grid.toWorldPosition(x, y, z), SETTINGS, ground);
    const chunked = run(new VillageChunkCache(), grid);

    expect(chunked.length).toBeGreaterThan(full.length);
    expect(vertexCount(chunked)).toBe(vertexCount(full));
    expect(new Set(chunked.map(({ key }) => key)).size).toBe(chunked.length);
  });

  it('reuses every merged geometry when nothing changed', () => {
    const grid = bigVillage();
    const cache = new VillageChunkCache();
    const first = run(cache, grid);
    const second = run(cache, grid);

    expect(second.map(({ geometry }) => geometry)).toEqual(first.map(({ geometry }) => geometry));
  });

  it('only re-merges the chunks around a new block', () => {
    const grid = new VillageGrid(SIZE, 10, SIZE);
    for (let x = 0; x < SIZE; x += 2) for (let z = 0; z < SIZE; z += 2) grid.addBlockInColumn(x, z);
    const cache = new VillageChunkCache();
    const before = new Map(run(cache, grid).map((group) => [group.key, group.geometry]));

    grid.addBlockInColumn(0, 0);
    const after = run(cache, grid);
    const rebuiltChunks = new Set(
      after.filter(({ key, geometry }) => before.get(key) !== geometry).map(({ key }) => key.split('|')[0]),
    );

    expect([...rebuiltChunks]).toEqual(['0,0']);
    expect(CHUNK_SIZE).toBeLessThan(SIZE);
  });
});
