import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FLOOR_T, hollowShellGeo, WALL_T, type OpeningSpec } from './geometryCache';
import type { CornerRadii, HollowShape, HollowSideKind } from '../utils/cellUtils';

const SQUARE: CornerRadii = { backLeft: 0, backRight: 0, frontLeft: 0, frontRight: 0, max: 0, uniform: true };
const TOWER: CornerRadii = { backLeft: 0.22, backRight: 0.22, frontLeft: 0.22, frontRight: 0.22, max: 0.22, uniform: true };

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
    const geo = hollowShellGeo(TOWER, shape(), faces.map((face) => ({ face, kind: 'window', scale: 1 })));
    // Un volume de découpe arrondi faisait monter cette coque à ~14 000 sommets.
    expect(geo.getAttribute('position').count).toBeLessThan(2500);
  });
});
