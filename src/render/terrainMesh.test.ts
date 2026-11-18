import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundHeight } from './landscape';
import { FLAT_RELIEF, reliefFor, reliefReach } from './relief';
import { applyRelief, terrainMesh } from './terrainMesh';
import { DEFAULT_TERRAIN } from '../terrainShape';

const REACH = 60;
const FLAT_RADIUS = 30;

/** Maille construite d'un bloc : hauteurs complètes, normales de three (l'ancien Terrain.tsx). */
function fullBuild(relief: ReturnType<typeof reliefFor>, fine: number) {
  const mesh = terrainMesh(REACH, FLAT_RADIUS, fine);
  const geometry = mesh.geometry.clone();
  const p = geometry.getAttribute('position') as THREE.BufferAttribute;
  const { coords } = mesh;
  for (let j = 0; j < coords.length; j += 1) {
    for (let i = 0; i < coords.length; i += 1) {
      p.setY(j * coords.length + i, groundHeight(coords[i], coords[j], FLAT_RADIUS, relief));
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}

const attr = (geometry: THREE.BufferGeometry, name: string) =>
  (geometry.getAttribute(name) as THREE.BufferAttribute).array as Float32Array;

/** Plus grand écart entre deux tableaux de même longueur. */
function worstGap(a: Float32Array, b: Float32Array): number {
  expect(a.length).toBe(b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}

describe('terrainMesh', () => {
  it('places a new relief exactly like a full rebuild, relief after relief on the same mesh', () => {
    const first = reliefFor(12, 1, { ...DEFAULT_TERRAIN, seed: 11 });
    const fine = Math.ceil(reliefReach(first));
    const mesh = terrainMesh(REACH, FLAT_RADIUS, fine);
    // Plusieurs générations successives sur la même maille, puis retour au plat.
    for (const relief of [
      first,
      reliefFor(12, 1, { ...DEFAULT_TERRAIN, seed: 42 }),
      reliefFor(12, 0.4, DEFAULT_TERRAIN),
    ]) {
      applyRelief(mesh, relief);
      const expected = fullBuild(relief, fine);
      expect(worstGap(attr(mesh.geometry, 'position'), attr(expected, 'position'))).toBe(0);
      expect(worstGap(attr(mesh.geometry, 'normal'), attr(expected, 'normal'))).toBeLessThan(1e-5);
    }
    applyRelief(mesh, FLAT_RELIEF);
    expect(worstGap(attr(mesh.geometry, 'position'), attr(fullBuild(FLAT_RELIEF, fine), 'position'))).toBe(0);
  });
});
