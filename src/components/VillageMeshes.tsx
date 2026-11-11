/**
 * Rend le village en meshes fusionnés (un par chunk de colonnes × groupe de
 * matériau, voir VillageChunkCache), avec couleurs par vertex. Reconstruit
 * quand `cells` change (add/remove de bloc), jamais par frame — et seuls les
 * chunks dont le contenu a changé sont refusionnés.
 */

import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import { VillageChunkCache } from '../render/buildVillage';
import {
  createGrowMaterialSet,
  disposeGrowMaterialSet,
  POP_DURATION,
  updateGrowTime,
  type GrowMaterialSet,
} from '../render/growMaterial';
import { matKey, type MaterialSpec } from '../render/parts';
import { pickRenderSettings } from '../render/renderSettings';
import { useControlStore } from '../store/controlStore';

/** Teinte des fenêtres allumées (lumière de bougie / lampe). */
const WINDOW_GLOW_COLOR = '#ffb45c';
/** Intensité d'émission à `windowGlow` = 1 — assez pour passer le seuil du bloom. */
const WINDOW_GLOW_INTENSITY = 2.2;
/** Lueur des vitres une fois fondue (après opacité), à `windowGlow` = 1. */
const GLASS_GLOW_INTENSITY = 0.1;
/** Teinte de l'appoint de jour des pièces : lumière du ciel entrée par les fenêtres. */
const INTERIOR_DAY_COLOR = '#fff3e3';
/** Intensité de la lampe des pièces à `windowGlow` = 1 (× albédo des surfaces). */
const INTERIOR_LAMP_INTENSITY = 0.9;
/**
 * Teinte de la lampe des pièces : plus pâle que la lueur des vitres. Aussi
 * saturée qu'elle, elle noyait tout l'intérieur dans le même orange — bois,
 * tentures et rideaux ne se distinguaient plus depuis la rue.
 */
const INTERIOR_LAMP_COLOR = '#ffd9a8';

interface VillageMeshesProps {
  cells: GridCell[];
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
  /** Emprise de la grille : sert à paver les ruelles autour des bâtiments. */
  gridWidth: number;
  gridDepth: number;
}

function createMaterialSet(mat: MaterialSpec): GrowMaterialSet {
  // Patine procédurale partout sauf sur le verre et les pièces lumineuses.
  const detail = !mat.transparent && !mat.glow;
  return createGrowMaterialSet(
    {
      vertexColors: true,
      roughness: mat.roughness,
      metalness: mat.metalness ?? 0,
      transparent: mat.transparent ?? false,
      opacity: mat.opacity ?? 1,
      depthWrite: !mat.transparent,
      side: mat.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      // Ombres inchangées : comme un matériau FrontSide, la carte d'ombre
      // ne rend que les faces arrière (sinon acné sur les murs fins).
      shadowSide: mat.doubleSide ? THREE.BackSide : null,
    },
    { detail },
  );
}

export function VillageMeshes({ cells, toWorldPosition, gridWidth, gridDepth }: VillageMeshesProps) {
  // Référence stable tant qu'aucune valeur ne change (useShallow).
  const settings = useControlStore(useShallow(pickRenderSettings));
  const blockTransitionEnabled = useControlStore((state) => state.blockTransitionEnabled);
  const windowGlow = useControlStore((state) => state.windowGlow);
  const interiorFill = useControlStore((state) => state.interiorFill);
  const invalidate = useThree((state) => state.invalidate);

  // Cache des chunks fusionnés, propre à cette instance (survit aux rendus).
  const [chunkCache] = useState(() => new VillageChunkCache());
  const groups = useMemo(
    () => chunkCache.build(cells, toWorldPosition, settings, { width: gridWidth, depth: gridDepth }),
    [chunkCache, cells, toWorldPosition, settings, gridWidth, gridDepth],
  );

  // Un jeu de matériaux "grow" (voir growMaterial.ts) par groupe de
  // matériau, partagé par tous les chunks de ce groupe. Ceux qui servent
  // encore sont repris tels quels : leur shader n'est pas recompilé.
  const materialsRef = useRef(new Map<string, GrowMaterialSet>());
  const [materials, setMaterials] = useState(() => new Map<string, GrowMaterialSet>());
  const neededKeys = useMemo(() => [...new Set(groups.map(({ mat }) => matKey(mat)))].sort().join(';'), [groups]);
  if (neededKeys !== [...materials.keys()].sort().join(';')) {
    const next = new Map<string, GrowMaterialSet>();
    for (const { mat } of groups) {
      const key = matKey(mat);
      if (!next.has(key)) next.set(key, materials.get(key) ?? createMaterialSet(mat));
    }
    setMaterials(next);
  }

  // Libère les matériaux qui ne servent plus (et tous au démontage).
  useEffect(() => {
    const previous = materialsRef.current;
    for (const [key, set] of previous) if (!materials.has(key)) disposeGrowMaterialSet(set);
    materialsRef.current = materials;
  }, [materials]);

  // Libère les géométries fusionnées remplacées ; les chunks inchangés
  // gardent la leur (même objet), donc rien à recharger sur le GPU.
  const geometriesRef = useRef(new Set<THREE.BufferGeometry>());
  useEffect(() => {
    const current = new Set(groups.map(({ geometry }) => geometry));
    for (const geometry of geometriesRef.current) if (!current.has(geometry)) geometry.dispose();
    geometriesRef.current = current;
  }, [groups]);

  useEffect(() => {
    const geometries = geometriesRef;
    const materialSets = materialsRef;
    return () => {
      for (const geometry of geometries.current) geometry.dispose();
      for (const set of materialSets.current.values()) disposeGrowMaterialSet(set);
    };
  }, []);

  // Fenêtres allumées : réglage de l'émission des matériaux "glow" en place,
  // sans toucher à la géométrie. Changement impératif → frame à demander.
  useEffect(() => {
    for (const { mat } of groups) {
      if (!mat.glow) continue;
      const set = materials.get(matKey(mat));
      if (!set) continue;
      set.material.emissive.set(WINDOW_GLOW_COLOR);
      // Vitres : le mélange alpha multiplie aussi l'émission par l'opacité ;
      // on la compense pour qu'une fois fondue, la lueur vaille
      // GLASS_GLOW_INTENSITY — un voile chaud, la pièce éclairée restant
      // visible derrière (la vraie lumière vient de l'intérieur).
      const intensity = mat.transparent ? GLASS_GLOW_INTENSITY / (mat.opacity ?? 1) : WINDOW_GLOW_INTENSITY;
      set.material.emissiveIntensity = windowGlow * intensity;
    }
    invalidate();
  }, [groups, materials, windowGlow, invalidate]);

  // Lumière des pièces (voir growMaterial.ts) : appoint neutre le jour,
  // lampe chaude le soir — le fondu suit `windowGlow`.
  useEffect(() => {
    const light = new THREE.Color(INTERIOR_DAY_COLOR)
      .multiplyScalar(interiorFill * (1 - windowGlow))
      .add(new THREE.Color(INTERIOR_LAMP_COLOR).multiplyScalar(windowGlow * INTERIOR_LAMP_INTENSITY));
    for (const set of materials.values()) set.interiorLight.value.copy(light);
    invalidate();
  }, [materials, interiorFill, windowGlow, invalidate]);

  // Le canvas rend à la demande (frameloop="demand") : tant qu'une cellule
  // est en pleine animation d'apparition, on redemande une frame à chaque
  // frame ; ensuite plus rien ne tourne jusqu'au prochain changement.
  const latestSpawn = useMemo(() => cells.reduce((latest, cell) => Math.max(latest, cell.spawnedAt ?? 0), 0), [cells]);

  useFrame(({ invalidate }) => {
    // Même horloge que `cell.spawnedAt` (villageGrid.ts), pas celle du canvas.
    const time = performance.now() / 1000;
    for (const set of materials.values()) updateGrowTime(set, time, blockTransitionEnabled);
    if (blockTransitionEnabled && time - latestSpawn < POP_DURATION) invalidate();
  });

  return (
    <>
      {groups.map(({ key, mat, geometry }) => {
        const set = materials.get(matKey(mat));
        if (!set) return null;
        return (
          <mesh
            key={key}
            name={`village-${key}`}
            geometry={geometry}
            material={set.material}
            customDepthMaterial={set.depthMaterial}
            castShadow
            receiveShadow
          />
        );
      })}
    </>
  );
}
