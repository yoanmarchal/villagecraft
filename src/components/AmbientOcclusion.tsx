/**
 * Occlusion ambiante (N8AO), chargée à la demande par VoxelScene.
 *
 * Équivalent du composant `N8AO` de @react-three/postprocessing, mais qui
 * importe `n8ao` directement : utilisé via l'export du paquet, la lib
 * (~85 kB gzip, texture de bruit incluse) finissait dans le bundle initial.
 */

import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { N8AOPostPass } from 'n8ao';

interface AmbientOcclusionProps {
  intensity: number;
  radius: number;
}

export default function AmbientOcclusion({ intensity, radius }: AmbientOcclusionProps) {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const pass = useMemo(() => new N8AOPostPass(scene, camera), [scene, camera]);

  useLayoutEffect(() => {
    Object.assign(pass.configuration, {
      aoRadius: radius,
      intensity,
      distanceFalloff: 1,
      // Demi-résolution : quasi invisible sur ces formes simples, pour un quart du coût.
      halfRes: true,
      depthAwareUpsampling: true,
    });
  }, [pass, radius, intensity]);

  useLayoutEffect(() => {
    pass.setQualityMode('Medium');
  }, [pass]);

  return <primitive object={pass} dispose={null} />;
}
