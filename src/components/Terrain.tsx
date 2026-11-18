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

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { reliefReach, type Relief } from '../render/relief';
import { applyRelief, terrainMesh } from '../render/terrainMesh';
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
  // Étendue de la maille fine : ne dépend que de la taille de la grille, pas de la graine.
  const fine = Math.min(Math.ceil(reliefReach(relief)), reach - 1);
  const mesh = useMemo(() => terrainMesh(reach, flatRadius, fine), [reach, flatRadius, fine]);
  const geometry = mesh.geometry;
  const invalidate = useThree((state) => state.invalidate);
  // Avant la frame suivante : le sol change dans la même image que le village (voir VoxelScene).
  useLayoutEffect(() => {
    applyRelief(mesh, relief);
    invalidate();
  }, [mesh, relief, invalidate]);
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
