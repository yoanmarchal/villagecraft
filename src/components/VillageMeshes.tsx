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
import { createGrowMaterialSet, disposeGrowMaterialSet, updateGrowTime } from '../render/growMaterial';
import {
  useControlStore,
  type CellMaterialsState,
  type CellDecorationsState,
  type CellRoofState,
  type CellShapeState,
} from '../store/controlStore';

interface VillageMeshesProps {
  cells: GridCell[];
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
}

const selectCellMaterials = (state: CellMaterialsState) => ({
  wallRoughness: state.wallRoughness,
  wallBaseColor: state.wallBaseColor,
  roofBaseColor: state.roofBaseColor,
});

const selectCellDecorations = (state: CellDecorationsState) => ({
  windowStonesPerFace: state.windowStonesPerFace,
  windowStoneRoughness: state.windowStoneRoughness,
  quoinMargin: state.quoinMargin,
  quoinRoughness: state.quoinRoughness,
});

const selectCellRoof = (state: CellRoofState) => ({
  ridgeY: state.ridgeY,
  towerR: state.towerR,
  merlonCount: state.merlonCount,
  merlonR: state.merlonR,
  merlonH: state.merlonH,
  spireH: state.spireH,
});

const selectCellShape = (state: CellShapeState) => ({
  isolatedWallRadius: state.isolatedWallRadius,
  connectedWallExposedRadius: state.connectedWallExposedRadius,
  connectedWallInteriorRadius: state.connectedWallInteriorRadius,
});

export function VillageMeshes({ cells, toWorldPosition }: VillageMeshesProps) {
  // Ces valeurs ne sont pas passées à buildVillage() : les builders de cells
  // les lisent eux-mêmes via useControlStore.getState(). Elles ne servent ici
  // qu'à invalider le memo quand un slider de style change.
  const cellMaterials = useControlStore(useShallow(selectCellMaterials));
  const cellDecorations = useControlStore(useShallow(selectCellDecorations));
  const cellRoof = useControlStore(useShallow(selectCellRoof));
  const cellShape = useControlStore(useShallow(selectCellShape));
  const blockTransitionEnabled = useControlStore((state) => state.blockTransitionEnabled);

  const groups = useMemo(
    () => buildVillage(cells, toWorldPosition),
    [cells, toWorldPosition, cellMaterials, cellDecorations, cellRoof, cellShape],
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

  useFrame(() => {
    // Même horloge que `cell.spawnedAt` (villageGrid.ts), pas celle du canvas.
    const time = performance.now() / 1000;
    for (const set of materialSets) updateGrowTime(set, time, blockTransitionEnabled);
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
