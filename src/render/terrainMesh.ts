/**
 * Maille du terrain (Terrain.tsx), sans React : pure, testée.
 *
 * La maille et les collines lointaines ne dépendent que de la taille de la
 * scène ; le relief du village (relief.ts) ne touche que sa zone fine. Un
 * nouveau village ne recalcule donc que celle-ci (`applyRelief`), au lieu de
 * toute la maille jusqu'à l'horizon.
 */

import * as THREE from 'three';
import { terrainHeight } from './landscape';
import { reliefHeight, type Relief } from './relief';

/** Subdivisions par côté hors du village : les collines sont douces, ~2 unités par maille suffisent. */
const SEGMENTS = 160;
/**
 * Maille sous le village et à ses abords, là où le relief compte : pavés,
 * soubassements et quadrillage sont posés à la hauteur exacte du terrain, la
 * surface dessinée ne doit pas s'en écarter (2 mm au plus à ce pas). Les
 * limites de case tombent sur cette maille (multiples de 0,25).
 */
export const TERRAIN_FINE_STEP = 0.25;

/** Abscisses des sommets le long d'un axe : maille fine au centre (jusqu'à ±`fine`), large au-delà. */
function axisCoords(reach: number, fine: number): number[] {
  if (fine <= 0) return Array.from({ length: SEGMENTS + 1 }, (_, i) => -reach + (2 * reach * i) / SEGMENTS);
  const coarse = Math.max(1, Math.ceil((reach - fine) / ((2 * reach) / SEGMENTS)));
  const coords: number[] = [];
  for (let i = 0; i < coarse; i += 1) coords.push(-reach + ((reach - fine) * i) / coarse);
  for (let i = 0; i <= Math.round((2 * fine) / TERRAIN_FINE_STEP); i += 1) coords.push(-fine + i * TERRAIN_FINE_STEP);
  for (let i = 1; i <= coarse; i += 1) coords.push(fine + ((reach - fine) * i) / coarse);
  return coords;
}

/** Maille du terrain sans le relief du village : collines lointaines comprises, fixe pour une taille de scène. */
export interface TerrainMesh {
  geometry: THREE.BufferGeometry;
  coords: number[];
  /** Hauteur des collines (landscape.ts) à chaque sommet, sans le relief du village. */
  hills: Float64Array;
  /** Plage d'indices (sur chaque axe) des sommets de la maille fine, où le relief peut être non nul. */
  lo: number;
  hi: number;
}

export function terrainMesh(reach: number, flatRadius: number, fine: number): TerrainMesh {
  const coords = axisCoords(reach, fine);
  const n = coords.length;
  const positions = new Float32Array(n * n * 3);
  const hills = new Float64Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const v = j * n + i;
      hills[v] = terrainHeight(coords[i], coords[j], flatRadius);
      positions[v * 3] = coords[i];
      positions[v * 3 + 1] = hills[v];
      positions[v * 3 + 2] = coords[j];
    }
  }
  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i;
      const b = a + n;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = a + 1;
      indices[k++] = b;
      indices[k++] = b + 1;
      indices[k++] = a + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const lo = coords.findIndex((c) => c >= -fine - 1e-6);
  const hi = n - 1 - [...coords].reverse().findIndex((c) => c <= fine + 1e-6);
  return { geometry, coords, hills, lo, hi };
}

/**
 * Pose le relief du village sur la maille : hauteurs de la zone fine (le
 * relief est nul au-delà), puis normales des sommets dont une face voisine a
 * pu bouger — même calcul que `computeVertexNormals` (somme des normales de
 * face non normalisées), sur cette zone seulement. Une génération ne
 * reconstruisait sinon toute la maille, jusqu'à l'horizon (~90 ms).
 */
export function applyRelief({ geometry, coords, hills, lo, hi }: TerrainMesh, relief: Relief): void {
  const n = coords.length;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const p = position.array as Float32Array;
  const nm = normal.array as Float32Array;
  for (let j = lo; j <= hi; j += 1) {
    for (let i = lo; i <= hi; i += 1) {
      const v = j * n + i;
      p[v * 3 + 1] = hills[v] + reliefHeight(coords[i], coords[j], relief);
    }
  }
  // Sommets à renormaliser : la zone fine et son pourtour ; faces qui les touchent.
  const v0 = Math.max(0, lo - 1);
  const v1 = Math.min(n - 1, hi + 1);
  for (let j = v0; j <= v1; j += 1) nm.fill(0, (j * n + v0) * 3, (j * n + v1 + 1) * 3);
  const add = (v: number, x: number, y: number, z: number) => {
    const i = v % n;
    const j = (v - i) / n;
    if (i < v0 || i > v1 || j < v0 || j > v1) return;
    nm[v * 3] += x;
    nm[v * 3 + 1] += y;
    nm[v * 3 + 2] += z;
  };
  const face = (a: number, b: number, c: number) => {
    // (c − b) × (a − b), comme computeVertexNormals.
    const cbx = p[c * 3] - p[b * 3];
    const cby = p[c * 3 + 1] - p[b * 3 + 1];
    const cbz = p[c * 3 + 2] - p[b * 3 + 2];
    const abx = p[a * 3] - p[b * 3];
    const aby = p[a * 3 + 1] - p[b * 3 + 1];
    const abz = p[a * 3 + 2] - p[b * 3 + 2];
    const x = cby * abz - cbz * aby;
    const y = cbz * abx - cbx * abz;
    const z = cbx * aby - cby * abx;
    add(a, x, y, z);
    add(b, x, y, z);
    add(c, x, y, z);
  };
  for (let j = Math.max(0, v0 - 1); j < Math.min(n - 1, v1 + 1); j += 1) {
    for (let i = Math.max(0, v0 - 1); i < Math.min(n - 1, v1 + 1); i += 1) {
      const a = j * n + i;
      const b = a + n;
      face(a, b, a + 1);
      face(b, b + 1, a + 1);
    }
  }
  for (let j = v0; j <= v1; j += 1) {
    for (let i = v0; i <= v1; i += 1) {
      const o = (j * n + i) * 3;
      const len = Math.hypot(nm[o], nm[o + 1], nm[o + 2]) || 1;
      nm[o] /= len;
      nm[o + 1] /= len;
      nm[o + 2] /= len;
    }
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  geometry.computeBoundingSphere();
}
