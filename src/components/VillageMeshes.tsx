/**
 * Rend le village entier en quelques meshes fusionnés (un par groupe de
 * matériau), avec couleurs par vertex. Reconstruit uniquement quand `cells`
 * change (add/remove de bloc), jamais par frame.
 */

import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import { buildVillage } from '../render/buildVillage';
import {
  useControlStore,
  type CellMaterialsState,
  type CellDecorationsState,
  type CellRoofState,
} from '../store/controlStore';

interface VillageMeshesProps {
  cells: GridCell[];
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
}

const selectCellMaterials = (state: CellMaterialsState) => ({
  wallRoughness: state.wallRoughness,
  colorJitterIntensity: state.colorJitterIntensity,
});

const selectCellDecorations = (state: CellDecorationsState) => ({
  standardStonesPerFace: state.standardStonesPerFace,
  windowStonesPerFace: state.windowStonesPerFace,
  standardStoneRoughness: state.standardStoneRoughness,
  windowStoneRoughness: state.windowStoneRoughness,
  quoinMargin: state.quoinMargin,
  quoinRoughness: state.quoinRoughness,
});

const selectCellRoof = (state: CellRoofState) => ({
  eaveY: state.eaveY,
  ridgeY: state.ridgeY,
  towerR: state.towerR,
  merlonCount: state.merlonCount,
  merlonR: state.merlonR,
  merlonH: state.merlonH,
  spireH: state.spireH,
});

export function VillageMeshes({ cells, toWorldPosition }: VillageMeshesProps) {
  // Ces valeurs ne sont pas passées à buildVillage() : les builders de cells
  // les lisent eux-mêmes via useControlStore.getState(). Elles ne servent ici
  // qu'à invalider le memo quand un slider de style change.
  const cellMaterials = useControlStore(useShallow(selectCellMaterials));
  const cellDecorations = useControlStore(useShallow(selectCellDecorations));
  const cellRoof = useControlStore(useShallow(selectCellRoof));

  const groups = useMemo(
    () => buildVillage(cells, toWorldPosition),
    [cells, toWorldPosition, cellMaterials, cellDecorations, cellRoof],
  );

  // Libère les géométries fusionnées quand elles sont remplacées
  useEffect(() => {
    return () => {
      for (const g of groups) g.geometry.dispose();
    };
  }, [groups]);

  return (
    <>
      {groups.map(({ key, mat, geometry }) => (
        <mesh key={key} name={`village-${key}`} geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={mat.roughness}
            metalness={mat.metalness ?? 0}
            transparent={mat.transparent ?? false}
            opacity={mat.opacity ?? 1}
            depthWrite={!mat.transparent}
          />
        </mesh>
      ))}
    </>
  );
}
