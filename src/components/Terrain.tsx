/**
 * Terrain : une prairie qui file jusqu'à l'horizon — doucement vallonnée sous
 * le village (relief.ts : les bâtiments s'y posent de niveau, les rues
 * suivent la pente), plate dans le reste de la zone où la caméra orbite, puis
 * en collines (landscape.ts) que le brouillard fond dans le ciel. Remplace
 * l'ancien socle "diorama", qui flottait dans le vide.
 *
 * L'herbe est procédurale (surfaceDetail.ts) : grandes plages plus sèches ou
 * plus grasses, marbrures, brins fins de près, et un relief de touffes.
 */

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { groundHeight } from '../render/landscape';
import { reliefReach, type Relief } from '../render/relief';
import { injectWorldDetail } from '../render/surfaceDetail';

interface TerrainProps {
  grassColor: string;
  roughness: number;
  /** Rayon parfaitement plat autour du centre (voir landscape.ts). */
  flatRadius: number;
  /** Demi-côté du terrain : au-delà du brouillard, donc jamais visible. */
  reach: number;
  /** Relief sous le village (relief.ts). */
  relief: Relief;
}

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

const GRASS_ALBEDO = `
  {
    float grassNear = 1.0 - smoothstep(4.0, 22.0, length(vViewPosition));
    float flowerNear = 1.0 - smoothstep(3.0, 11.0, length(vViewPosition));
    vec3 grassPos = vec3(vDetailPos.x, 0.0, vDetailPos.z);
    float grassField = vcFbm(grassPos * 0.07 + 5.3);
    float grassMottle = vcFbm(grassPos * 0.9 + 1.7);
    float grassBlade = vcNoise(grassPos * 46.0) * grassNear;

    // Plages plus sèches (jaunies) ou plus grasses (sombres), à l'échelle d'un pré.
    vec3 grassDry = diffuseColor.rgb * vec3(1.04, 1.0, 0.8);
    vec3 grassLush = diffuseColor.rgb * vec3(0.6, 0.8, 0.58);
    diffuseColor.rgb = mix(grassLush, grassDry, smoothstep(0.3, 0.68, grassField));
    diffuseColor.rgb *= 0.62 + 0.56 * grassMottle + (grassBlade - 0.5 * grassNear) * 0.3;

    // Semis de fleurs des champs, de près seulement (un point par cellule de bruit).
    vec3 flowerCell = grassPos * 30.0;
    float flowerSeed = vcHash(floor(flowerCell));
    float flower = step(0.988, flowerSeed) * smoothstep(0.26, 0.16, length(fract(flowerCell).xz - 0.5))
      * flowerNear * smoothstep(0.4, 0.6, grassMottle);
    diffuseColor.rgb = mix(diffuseColor.rgb, flowerSeed > 0.994 ? vec3(0.95, 0.9, 0.78) : vec3(0.92, 0.74, 0.2), flower);

    vcDetailHeight = grassMottle * 0.05 + grassBlade * 0.004;
  }
`;

export function Terrain({ grassColor, roughness, flatRadius, reach, relief }: TerrainProps) {
  const geometry = useMemo(() => {
    const coords = axisCoords(reach, Math.min(Math.ceil(reliefReach(relief)), reach - 1));
    const n = coords.length;
    const positions = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const o = (j * n + i) * 3;
        positions[o] = coords[i];
        positions[o + 1] = groundHeight(coords[i], coords[j], flatRadius, relief);
        positions[o + 2] = coords[j];
      }
    }
    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let j = 0; j < n - 1; j += 1) {
      for (let i = 0; i < n - 1; i += 1) {
        const a = j * n + i;
        const b = a + n;
        indices.set([a, b, a + 1, b, b + 1, a + 1], k);
        k += 6;
      }
    }
    const plane = new THREE.BufferGeometry();
    plane.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    plane.setIndex(new THREE.BufferAttribute(indices, 1));
    plane.computeVertexNormals();
    return plane;
  }, [flatRadius, reach, relief]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const [material] = useState(() => {
    const grass = new THREE.MeshStandardMaterial();
    grass.onBeforeCompile = (shader) => injectWorldDetail(shader, { albedo: GRASS_ALBEDO });
    return grass;
  });
  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      material-color={grassColor}
      material-roughness={roughness}
      receiveShadow
    />
  );
}
