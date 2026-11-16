import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FLOOR_T, hollowSheetGeo, hollowShellGeo, innerContourXZ, WALL_T, type OpeningSpec } from './geometryCache';
import { getRoundedRectContourPoints, type CellFace } from '../utils/cellUtils';
import { pointInPolygon, rect, type Point } from '../utils/polygon';
import { EXTERIOR_SUPPORT } from './growMaterial';
import type { CornerRadii, HollowShape, HollowSideKind } from '../utils/cellUtils';

const SQUARE: CornerRadii = { backLeft: 0, backRight: 0, frontLeft: 0, frontRight: 0, max: 0, uniform: true };
const TOWER: CornerRadii = {
  backLeft: 0.22,
  backRight: 0.22,
  frontLeft: 0.22,
  frontRight: 0.22,
  max: 0.22,
  uniform: true,
};

function shape(
  sides: Partial<Record<'front' | 'back' | 'left' | 'right', HollowSideKind>> = {},
  { pillars = {} }: { pillars?: Partial<HollowShape['pillars']> } = {},
): HollowShape {
  return {
    sides: { front: 'exterior', back: 'exterior', left: 'exterior', right: 'exterior', ...sides },
    pillars: { backLeft: false, backRight: false, frontLeft: false, frontRight: false, ...pillars },
  };
}

/** Distances (le long du rayon) de toutes les intersections avec la géométrie, triées. */
function hits(geo: THREE.BufferGeometry, origin: [number, number, number], dir: [number, number, number]): number[] {
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize());
  // Dédoublonne les intersections sur une arête partagée par deux triangles.
  const distances = ray.intersectObject(mesh).map((h) => Math.round(h.distance * 1000) / 1000);
  return [...new Set(distances)];
}

describe('hollowShellGeo', () => {
  /** Distance d'un point à des segments. */
  const distanceTo = ([px, pz]: Point, edges: Array<[Point, Point]>) =>
    Math.min(
      ...edges.map(([[x0, z0], [x1, z1]]) => {
        const length2 = (x1 - x0) ** 2 + (z1 - z0) ** 2;
        const t =
          length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * (x1 - x0) + (pz - z0) * (z1 - z0)) / length2));
        return Math.hypot(px - x0 - t * (x1 - x0), pz - z0 - t * (z1 - z0));
      }),
    );

  it('produit une géométrie indexée avec seulement position + normal, partagée par clé', () => {
    const geo = hollowShellGeo(SQUARE, shape(), []);
    // Sommets soudés (getGeo) : chaque sommet sert en moyenne à plusieurs triangles.
    expect(geo.index).not.toBeNull();
    expect(geo.index!.count).toBeGreaterThan(geo.getAttribute('position').count);
    expect(Object.keys(geo.attributes).sort()).toEqual(['normal', 'position']);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(hollowShellGeo(SQUARE, shape(), [])).toBe(geo);
  });

  it('est creux : un rayon horizontal traverse deux murs d’épaisseur WALL_T', () => {
    const geo = hollowShellGeo(SQUARE, shape(), []);
    expect(hits(geo, [0, 0, 2], [0, 0, -1])).toEqual([1.5, 1.5 + WALL_T, 2.5 - WALL_T, 2.5]);
  });

  it('a toujours un plancher et un plafond (hauteur sous plafond uniforme)', () => {
    const geo = hollowShellGeo(SQUARE, shape({ left: 'open', right: 'open' }), []);
    expect(hits(geo, [0, 2, 0], [0, -1, 0])).toEqual([1.5, 1.5 + FLOOR_T, 2.5 - FLOOR_T, 2.5]);
  });

  it('n’a pas de mur du côté d’un voisin creux, mais un mur plein côté toit/arche', () => {
    const open = hollowShellGeo(SQUARE, shape({ right: 'open' }), []);
    expect(hits(open, [2, 0, 0], [-1, 0, 0])).toEqual([2.5 - WALL_T, 2.5]);

    const partition = hollowShellGeo(SQUARE, shape({ right: 'partition' }), []);
    expect(hits(partition, [2, 0, 0], [-1, 0, 0])).toHaveLength(4);
  });

  it('garde un pilier au coin rentrant de deux côtés ouverts', () => {
    const sides = { front: 'open', right: 'open' } as const;
    // Rayon horizontal le long du mur de droite (x dans l'épaisseur du pilier), vers l'avant.
    const start: [number, number, number] = [0.5 - WALL_T / 2, 0, 0];
    const withPillar = hollowShellGeo(SQUARE, shape(sides, { pillars: { frontRight: true } }), []);
    expect(hits(withPillar, start, [0, 0, 1])[0]).toBeCloseTo(0.5 - WALL_T);

    const without = hollowShellGeo(SQUARE, shape(sides), []);
    expect(hits(without, start, [0, 0, 1])).toEqual([]);
  });

  it('perce les ouvertures de part en part', () => {
    const windows: OpeningSpec[] = [{ face: 'front', kind: 'window', scale: 1 }];
    const geo = hollowShellGeo(SQUARE, shape(), windows);
    // Le rayon entre par la fenêtre et ne touche que le mur du fond.
    expect(hits(geo, [0, 0, 2], [0, 0, -1])).toEqual([2.5 - WALL_T, 2.5]);

    const door = hollowShellGeo(SQUARE, shape(), [{ face: 'left', kind: 'door', scale: 1 }]);
    expect(hits(door, [-2, -0.2, 0], [1, 0, 0])).toEqual([2.5 - WALL_T, 2.5]);
  });

  it('garde une épaisseur de mur constante dans les coins arrondis d’une tour', () => {
    const geo = hollowShellGeo(TOWER, shape(), []);
    // Diagonale : traverse le mur arrondi, le vide, puis le mur opposé.
    const found = hits(geo, [2, 0, 2], [-1, 0, -1]);
    expect(found).toHaveLength(4);
    expect(found[1] - found[0]).toBeGreaterThan(WALL_T * 0.9);
    expect(found[1] - found[0]).toBeLessThan(WALL_T * 1.6);
  });

  it('reste dans le budget de sommets (ouvertures à angles vifs)', () => {
    const faces = ['front', 'back', 'left', 'right'] as const;
    const geo = hollowShellGeo(
      TOWER,
      shape(),
      faces.map((face) => ({ face, kind: 'window', scale: 1 })),
    );
    // Un volume de découpe arrondi faisait monter cette coque à ~14 000 sommets.
    expect(geo.getAttribute('position').count).toBeLessThan(2500);
  });

  it('perce les trémies d’escalier dans le plafond et le plancher, et elles seules', () => {
    const hole = rect(0.1, 0.1, 0.4, 0.4);
    const ceiling = hollowShellGeo(SQUARE, shape(), [], { ceiling: hole });
    // Par la trémie, un rayon vertical ne traverse plus que le plancher ; à côté, les deux dalles.
    expect(hits(ceiling, [0.25, 2, 0.25], [0, -1, 0])).toEqual([2.5 - FLOOR_T, 2.5]);
    expect(hits(ceiling, [-0.25, 2, -0.25], [0, -1, 0])).toEqual([1.5, 1.5 + FLOOR_T, 2.5 - FLOOR_T, 2.5]);
    const floor = hollowShellGeo(SQUARE, shape(), [], { floor: hole });
    expect(hits(floor, [0.25, 2, 0.25], [0, -1, 0])).toEqual([1.5, 1.5 + FLOOR_T]);
    // Les murs restent entiers, et la coque dans le budget.
    expect(hits(floor, [0, 0, 2], [0, 0, -1])).toEqual([1.5, 1.5 + WALL_T, 2.5 - WALL_T, 2.5]);
    expect(ceiling.getAttribute('position').count).toBeLessThan(2500);
    expect(hollowShellGeo(SQUARE, shape(), [], { ceiling: hole })).toBe(ceiling);
    expect(ceiling).not.toBe(hollowShellGeo(SQUARE, shape(), []));
  });

  it('perce aussi le parquet et le plafond enduit', () => {
    const sheet = hollowSheetGeo(SQUARE, shape(), 0.01, rect(0.1, 0.1, 0.4, 0.4));
    expect(hits(sheet, [0.25, 1, 0.25], [0, -1, 0])).toEqual([]);
    expect(hits(sheet, [-0.25, 1, -0.25], [0, -1, 0])).toEqual([0.99, 1]);
  });

  describe('jonction arrondie (« interior corner roundness »)', () => {
    const radiiOf = (corners: Partial<CornerRadii>): CornerRadii => {
      const r = { ...SQUARE, ...corners };
      const values = [r.backLeft, r.backRight, r.frontLeft, r.frontRight];
      return { ...r, max: Math.max(...values), uniform: new Set(values).size === 1 };
    };

    it('garde un mur le long de la gorge, sans trou vers la pièce', () => {
      // Côté droit ouvert sur le voisin, coin avant droit arrondi : la façade fait une gorge.
      const geo = hollowShellGeo(radiiOf({ frontRight: 0.3 }), shape({ right: 'open' }), []);
      // Rayon venu de la rue, dans la gorge : il traverse un mur d'au moins WALL_T avant la pièce.
      const found = hits(geo, [0.48, 0, 2], [0, 0, -1]);
      expect(found.length).toBeGreaterThanOrEqual(2);
      expect(found[1] - found[0]).toBeGreaterThan(WALL_T * 0.9);
      // Plus bas que la gorge, le côté reste ouvert sur le voisin.
      expect(hits(geo, [0, 0, -0.2], [1, 0, 0])).toEqual([]);
    });

    it('mure un côté ouvert quand les gorges de ses deux coins se rejoignent', () => {
      const geo = hollowShellGeo(radiiOf({ frontRight: 0.5, backRight: 0.5 }), shape({ right: 'open' }), []);
      const found = hits(geo, [0, 0, 0], [1, 0, 0]);
      expect(found).toHaveLength(2);
      expect(found[1] - found[0]).toBeGreaterThan(WALL_T * 0.9);
    });

    it('reste à WALL_T du dehors, sauf le long du passage vers le voisin', () => {
      const faces: CellFace[] = ['front', 'back', 'left', 'right'];
      for (const r of [0.05, 0.1, 0.3, 0.42, 0.5]) {
        for (const open of faces) {
          const radii = radiiOf({ backLeft: r, backRight: r, frontLeft: r, frontRight: r });
          // Contour extérieur, dans le repère de la scène (z = −y de la shape, comme shapedBoxGeo).
          const outer = getRoundedRectContourPoints(0.5, 0.5, radii).map(([x, y]): Point => [x, -y]);
          const onOpenSide = ([x, z]: Point) =>
            open === 'right' ? x > 0.499 : open === 'left' ? x < -0.499 : open === 'front' ? z > 0.499 : z < -0.499;
          // Le dehors : le contour extérieur, sauf le côté mitoyen (bord de la cellule côté ouvert).
          const outside = outer
            .map((p, i): [Point, Point] => [p, outer[(i + 1) % outer.length]])
            .filter(([a, b]) => !(onOpenSide(a) && onOpenSide(b)));
          for (const point of innerContourXZ(shape({ [open]: 'open' }), radii)) {
            if (onOpenSide(point)) {
              // Sur le passage : la coque existe juste en deçà (elle rejoint celle du voisin).
              const [x, z] = point;
              const inward: Point = [
                x - Math.sign(x) * 0.002 * +(Math.abs(x) > 0.499),
                z - Math.sign(z) * 0.002 * +(Math.abs(z) > 0.499),
              ];
              expect(pointInPolygon(inward, outer)).toBe(true);
            } else {
              expect(pointInPolygon(point, outer)).toBe(true);
              expect(distanceTo(point, outside)).toBeGreaterThan(WALL_T * 0.9);
            }
          }
        }
      }
    });
  });

  it('ses faces extérieures et celles de la cavité se distinguent par leur orientation (shader)', () => {
    // Même critère que growMaterial.ts / surfaceDetail.ts : dot(n, p) horizontal
    // ≥ EXTERIOR_SUPPORT ⇔ face du dehors (mortier, jamais la lampe de la pièce).
    const cases: Array<[CornerRadii, HollowShape, OpeningSpec[]]> = [
      [SQUARE, shape(), [{ face: 'front', kind: 'window', scale: 1 }]],
      [TOWER, shape(), [{ face: 'left', kind: 'slit', scale: 1 }]],
      [{ ...TOWER, backLeft: 0.5, backRight: 0.5, frontLeft: 0.5, frontRight: 0.5, max: 0.5 }, shape(), []],
      // Gorges de jonction arrondies, côté droit ouvert sur le voisin (passage ouvert, puis muré).
      [{ ...SQUARE, frontRight: 0.3, backRight: 0.3, max: 0.3, uniform: false }, shape({ right: 'open' }), []],
      [{ ...SQUARE, frontRight: 0.5, backRight: 0.5, max: 0.5, uniform: false }, shape({ right: 'open' }), []],
    ];
    for (const [radii, hollow, openings] of cases) {
      const geo = hollowShellGeo(radii, hollow, openings);
      const outer = getRoundedRectContourPoints(0.5, 0.5, radii).map(([x, y]): Point => [x, -y]);
      const edges = outer.map((p, i): [Point, Point] => [p, outer[(i + 1) % outer.length]]);
      const position = geo.getAttribute('position');
      const index = geo.index!;
      const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      let exterior = 0;
      let cavity = 0;
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(position, index.getX(i));
        b.fromBufferAttribute(position, index.getX(i + 1));
        c.fromBufferAttribute(position, index.getX(i + 2));
        const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
        const centre = a.clone().add(b).add(c).divideScalar(3);
        const horizontal = Math.hypot(normal.x, normal.z);
        // Faces verticales de la hauteur de la pièce seulement (dalles : critère de hauteur).
        if (horizontal < 0.7 || Math.abs(centre.y) > 0.5 - FLOOR_T) continue;
        const support = (normal.x * centre.x + normal.z * centre.z) / horizontal;
        const onOuter = distanceTo([centre.x, centre.z], edges) < 3e-3;
        expect(support >= EXTERIOR_SUPPORT).toBe(onOuter);
        if (onOuter) exterior += 1;
        else cavity += 1;
      }
      expect(exterior).toBeGreaterThan(0);
      expect(cavity).toBeGreaterThan(0);
    }
  });
});
