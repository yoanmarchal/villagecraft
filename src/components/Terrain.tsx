/**
 * Terrain : une prairie qui file jusqu'à l'horizon, plate sous le village et
 * dans toute la zone où la caméra orbite, vallonnée au-delà (landscape.ts) —
 * le brouillard la fond dans le ciel. Remplace l'ancien socle "diorama", qui
 * flottait dans le vide.
 *
 * L'herbe est procédurale (surfaceDetail.ts) : grandes plages plus sèches ou
 * plus grasses, marbrures, brins fins de près, et un relief de touffes. Le
 * dessus affleure y = 0, le pied des blocs.
 */

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { terrainHeight } from '../render/landscape';
import { injectWorldDetail } from '../render/surfaceDetail';

interface TerrainProps {
  grassColor: string;
  roughness: number;
  /** Rayon parfaitement plat autour du centre (voir landscape.ts). */
  flatRadius: number;
  /** Demi-côté du terrain : au-delà du brouillard, donc jamais visible. */
  reach: number;
}

/** Subdivisions par côté : le relief est doux, ~2 unités par maille suffisent. */
const SEGMENTS = 160;

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

export function Terrain({ grassColor, roughness, flatRadius, reach }: TerrainProps) {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(reach * 2, reach * 2, SEGMENTS, SEGMENTS);
    plane.rotateX(-Math.PI / 2);
    const position = plane.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      position.setY(i, terrainHeight(position.getX(i), position.getZ(i), flatRadius));
    }
    plane.computeVertexNormals();
    return plane;
  }, [flatRadius, reach]);
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
