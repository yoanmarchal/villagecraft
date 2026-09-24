/**
 * Rend le village entier en quelques meshes fusionnés (un par groupe de
 * matériau), avec couleurs par vertex. Reconstruit uniquement quand `cells`
 * change (add/remove de bloc), jamais par frame.
 */

import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import { buildVillage } from '../render/buildVillage';
import { createGrowMaterialSet, disposeGrowMaterialSet, POP_DURATION, updateGrowTime } from '../render/growMaterial';
import { pickRenderSettings } from '../render/renderSettings';
import { useControlStore } from '../store/controlStore';

interface VillageMeshesProps {
  cells: GridCell[];
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
}

export function VillageMeshes({ cells, toWorldPosition }: VillageMeshesProps) {
  // Référence stable tant qu'aucune valeur ne change (useShallow).
  const settings = useControlStore(useShallow(pickRenderSettings));
  const blockTransitionEnabled = useControlStore((state) => state.blockTransitionEnabled);

  const groups = useMemo(
    () => buildVillage(cells, toWorldPosition, settings),
    [cells, toWorldPosition, settings],
  );

  // Libère les géométries fusionnées quand elles sont remplacées
  useEffect(() => {
    return () => {
      for (const g of groups) g.geometry.dispose();
    };
  }, [groups]);

  // Un jeu de matériaux "grow" par groupe (voir growMaterial.ts), reconstruit
  // seulement quand les groupes le sont — la transition qu'ils pilotent
  // avance ensuite uniquement via l'uniform de temps, à chaque frame.
  const materialSets = useMemo(
    () =>
      groups.map(({ mat }) =>
        createGrowMaterialSet({
          vertexColors: true,
          roughness: mat.roughness,
          metalness: mat.metalness ?? 0,
          transparent: mat.transparent ?? false,
          opacity: mat.opacity ?? 1,
          depthWrite: !mat.transparent,
        }),
      ),
    [groups],
  );

  useEffect(() => {
    return () => {
      for (const set of materialSets) disposeGrowMaterialSet(set);
    };
  }, [materialSets]);

  // Le canvas rend à la demande (frameloop="demand") : tant qu'une cellule
  // est en pleine animation d'apparition, on redemande une frame à chaque
  // frame ; ensuite plus rien ne tourne jusqu'au prochain changement.
  const latestSpawn = useMemo(
    () => cells.reduce((latest, cell) => Math.max(latest, cell.spawnedAt ?? 0), 0),
    [cells],
  );

  useFrame(({ invalidate }) => {
    // Même horloge que `cell.spawnedAt` (villageGrid.ts), pas celle du canvas.
    const time = performance.now() / 1000;
    for (const set of materialSets) updateGrowTime(set, time, blockTransitionEnabled);
    if (blockTransitionEnabled && time - latestSpawn < POP_DURATION) invalidate();
  });

  return (
    <>
      {groups.map(({ key, geometry }, i) => (
        <mesh
          key={key}
          name={`village-${key}`}
          geometry={geometry}
          material={materialSets[i].material}
          customDepthMaterial={materialSets[i].depthMaterial}
          castShadow
          receiveShadow
        />
      ))}
    </>
  );
}
