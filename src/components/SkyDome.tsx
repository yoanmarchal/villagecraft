/**
 * Ciel : dôme en espace monde, dessiné au plan lointain derrière toute la
 * scène. Dégradé zénith → horizon (`skyTopColor` → `skyHorizonColor`), disque
 * et halo du soleil dans la direction de la lumière directionnelle (la lune,
 * dans l'ambiance de nuit : même lumière, bleutée), nuages procéduraux et
 * étoiles quand le ciel est sombre.
 *
 * Remplace le dégradé en espace écran : avec le terrain qui file jusqu'à
 * l'horizon, le ciel doit rester fixe quand la caméra tourne. Aucune texture :
 * tout est calculé par fragment, sur un seul triangle-écran de sphère.
 */

import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from '../render/surfaceDetail';

interface SkyDomeProps {
  top: string;
  horizon: string;
  /** Position de la lumière directionnelle (le dôme n'en garde que la direction). */
  sunPosition: [number, number, number];
  sunColor: string;
  sunIntensity: number;
}

const VERTEX_SHADER = `
  varying vec3 vSkyDirection;

  void main() {
    vSkyDirection = position;
    // Rotation de la caméra seulement : le dôme la suit, à distance infinie.
    vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = clip.xyww; // profondeur = plan lointain
  }
`;

const FRAGMENT_SHADER = `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDirection;
  uniform vec3 uSunLight; // couleur × intensité de la lumière directionnelle
  varying vec3 vSkyDirection;

  ${NOISE_GLSL}

  void main() {
    vec3 direction = normalize(vSkyDirection);
    float elevation = max(direction.y, 0.0);

    // Dégradé : l'horizon s'éclaircit vite, le zénith sature lentement.
    vec3 color = mix(uHorizon, uTop, 1.0 - exp(-elevation * 3.6));

    float sunAlignment = max(dot(direction, uSunDirection), 0.0);
    float skyLuminance = dot(uTop, vec3(0.2126, 0.7152, 0.0722));
    float night = 1.0 - smoothstep(0.015, 0.09, skyLuminance);

    // Nuages : bruit projeté sur un plan d'altitude, estompé vers l'horizon.
    vec2 cloudUv = direction.xz / (direction.y + 0.16);
    float cloudDensity = vcFbm(vec3(cloudUv * 0.85, 4.2)) + 0.35 * vcNoise(vec3(cloudUv * 3.4, 9.1)) * 0.5;
    float cloud = smoothstep(0.54, 0.8, cloudDensity) * smoothstep(0.015, 0.22, direction.y);
    vec3 cloudColor = mix(uHorizon, vec3(1.0), 0.35 * (1.0 - night)) * 1.05
      + uSunLight * (0.07 + 0.2 * pow(sunAlignment, 6.0)) * (1.0 - 0.8 * night);
    // Dessous des nuages un peu plus sombre : du volume sans raymarching.
    cloudColor *= 0.86 + 0.14 * smoothstep(0.5, 0.9, cloudDensity);
    color = mix(color, cloudColor, cloud * 0.82);

    // Étoiles : une par cellule d'un réseau sur la sphère, masquées par les nuages.
    vec3 starCell = direction * 190.0;
    float star = step(0.9965, vcHash(floor(starCell)))
      * smoothstep(0.32, 0.0, length(fract(starCell) - 0.5));
    color += vec3(0.9, 0.95, 1.0) * star * night * (1.0 - cloud) * smoothstep(0.0, 0.3, direction.y) * 1.6;

    // Soleil (ou lune) : disque net, couronne serrée, large halo.
    float disc = smoothstep(0.99955, 0.99975, sunAlignment);
    float halo = pow(sunAlignment, 420.0) * 0.9 + pow(sunAlignment, 14.0) * 0.16;
    color += uSunLight * (disc * 2.5 + halo) * (1.0 - cloud * 0.75);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function SkyDome({ top, horizon, sunPosition, sunColor, sunIntensity }: SkyDomeProps) {
  const invalidate = useThree((state) => state.invalidate);
  const [material] = useState(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        uniforms: {
          uTop: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
          uSunLight: { value: new THREE.Color() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
  );
  useEffect(() => () => material.dispose(), [material]);

  // Changement impératif → frame à demander (frameloop "demand").
  const [sunX, sunY, sunZ] = sunPosition;
  useEffect(() => {
    const { uniforms } = material;
    (uniforms.uTop.value as THREE.Color).set(top);
    (uniforms.uHorizon.value as THREE.Color).set(horizon);
    (uniforms.uSunDirection.value as THREE.Vector3).set(sunX, sunY, sunZ).normalize();
    (uniforms.uSunLight.value as THREE.Color).set(sunColor).multiplyScalar(sunIntensity);
    invalidate();
  }, [material, top, horizon, sunX, sunY, sunZ, sunColor, sunIntensity, invalidate]);

  // Dessiné après les objets opaques (renderOrder) : au plan lointain, il ne
  // remplit que les pixels restés vides.
  return (
    <mesh material={material} frustumCulled={false} renderOrder={1000}>
      <icosahedronGeometry args={[1, 3]} />
    </mesh>
  );
}
