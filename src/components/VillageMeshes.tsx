/**
 * Rend le village en meshes fusionnés (un par chunk de colonnes × groupe de
 * matériau, voir VillageChunkCache), avec couleurs par vertex. Reconstruit
 * quand `cells` change (add/remove de bloc), jamais par frame — et seuls les
 * chunks dont le contenu a changé sont refusionnés.
 */

import * as THREE from 'three';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import type { MergedGroup } from '../render/buildVillage';
import { sampleMapping, VillageBuildClient } from '../render/villageBuild';
import {
  createGrowMaterialSet,
  disposeGrowMaterialSet,
  POP_DURATION,
  updateGrowTime,
  type GrowMaterialSet,
} from '../render/growMaterial';
import { matKey, type MaterialSpec } from '../render/parts';
import { pickRenderSettings } from '../render/renderSettings';
import type { Relief } from '../render/relief';
import {
  createReliefUniforms,
  disposeReliefUniforms,
  updateReliefUniforms,
  type ReliefUniforms,
} from '../render/reliefUniforms';
import { useControlStore } from '../store/controlStore';
import { hideAppLoader } from '../loader';
import { sceneBridge } from '../api/sceneBridge';
import { DOOR_OPEN_ANGLE, doorPose } from '../render/cells/doors';
import type { DoorHinge } from '../render/parts';
import { walkerPresence } from '../walk/walkerPresence';

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
/** Une porte s'ouvre quand le promeneur passe à moins de cette distance (en plan) du milieu de son seuil. */
const DOOR_OPEN_DISTANCE = 0.75;
/** Vitesse d'ouverture et de fermeture des vantaux (rad/s) : grand ouvert en ~0,4 s. */
const DOOR_SPEED = 4;

/** Porte d'un mesh de pièces mobiles (voir doors.ts) : identifiant, charnière en monde. */
interface DoorMeshData {
  doorId: string;
  hinge: DoorHinge;
}

interface VillageMeshesProps {
  cells: GridCell[];
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
  /** Emprise de la grille : sert à paver les ruelles autour des bâtiments. */
  gridWidth: number;
  gridDepth: number;
  /** Relief du terrain : les bâtiments s'y posent de niveau, rues et décor suivent la pente. */
  relief: Relief;
  /**
   * Relief du village affiché, à chaque livraison du worker : la scène y
   * aligne sol et arbres, pour que terrain et village changent ensemble.
   */
  onPresent?: (relief: Relief) => void;
  /** Volumes de collision du promeneur livrés avec le village (monde, 6 nombres par boîte). */
  onColliders?: (colliders: Float32Array) => void;
}

function createMaterialSet(mat: MaterialSpec, relief: ReliefUniforms): GrowMaterialSet {
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
    { detail, masonry: detail && mat.masonry === true, relief },
  );
}

export function VillageMeshes({
  cells,
  toWorldPosition,
  gridWidth,
  gridDepth,
  relief,
  onPresent,
  onColliders,
}: VillageMeshesProps) {
  // Référence stable tant qu'aucune valeur ne change (useShallow).
  const settings = useControlStore(useShallow(pickRenderSettings));
  const blockTransitionEnabled = useControlStore((state) => state.blockTransitionEnabled);
  const windowGlow = useControlStore((state) => state.windowGlow);
  const interiorFill = useControlStore((state) => state.interiorFill);
  const invalidate = useThree((state) => state.invalidate);

  // Construction dans un Web Worker (villageBuild.ts) : l'interface ne fige
  // plus pendant un clic ou une génération. Le village affiché reste le
  // précédent jusqu'à la réponse ; seuls les chunks refusionnés changent.
  // Tout ce qui dépend du village (relief des shaders, sol, animation)
  // suit la demande livrée, pas la grille courante.
  const [groups, setGroups] = useState<MergedGroup[]>([]);
  const [built, setBuilt] = useState(false);
  const [shownRelief, setShownRelief] = useState(relief);
  const [colliders, setColliders] = useState<Float32Array | null>(null);
  // Fin de l'animation d'apparition des blocs livrés (horloge de `cell.spawnedAt`).
  const [animateUntil, setAnimateUntil] = useState(0);
  const [client] = useState(
    () =>
      new VillageBuildClient((next, { request, delay, colliders: solids }) => {
        setGroups(next);
        setColliders(solids);
        setBuilt(true);
        setShownRelief(request.relief);
        // Apparitions recalées sur la livraison (retimeSpawns) : même décalage ici.
        const latest = request.cells.reduce((max, cell) => Math.max(max, cell.spawnedAt ?? 0), 0);
        if (latest + POP_DURATION > performance.now() / 1000 - delay) {
          setAnimateUntil((until) => Math.max(until, latest + delay + POP_DURATION));
        }
      }),
  );
  useEffect(() => () => client.dispose(), [client]);
  // Avant l'image suivante : sol et village livré s'affichent ensemble.
  useLayoutEffect(() => onPresent?.(shownRelief), [onPresent, shownRelief]);
  useLayoutEffect(() => {
    if (colliders) onColliders?.(colliders);
  }, [onColliders, colliders]);
  // API (window.villagecraft) : attendre la fin d'une construction avant une capture.
  useEffect(() => {
    sceneBridge.isBuilding = () => !client.idle;
    return () => {
      sceneBridge.isBuilding = () => false;
    };
  }, [client]);
  useEffect(() => {
    client.request({
      cells,
      settings,
      width: gridWidth,
      depth: gridDepth,
      relief,
      mapping: sampleMapping(toWorldPosition),
    });
  }, [client, cells, toWorldPosition, settings, gridWidth, gridDepth, relief]);

  // Relief connu des shaders (pied des murs sali au ras du sol) : uniforms
  // partagés par tous les matériaux, réglés en place.
  const [reliefValue] = useState(createReliefUniforms);
  useEffect(() => {
    updateReliefUniforms(reliefValue, shownRelief);
    invalidate();
  }, [reliefValue, shownRelief, invalidate]);
  useEffect(() => () => disposeReliefUniforms(reliefValue), [reliefValue]);

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
      if (!next.has(key)) next.set(key, materials.get(key) ?? createMaterialSet(mat, reliefValue));
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
  useEffect(() => {
    sceneBridge.latestSpawn = () => animateUntil - POP_DURATION;
    invalidate();
  }, [animateUntil, invalidate]);

  // Écran de chargement : retiré après la première image où le village est
  // monté — ses géométries construites et ses shaders compilés (ce que fait
  // le rendu de cette image). Le rAF attend que cette image soit affichée.
  const meshesMounted = useRef(false);
  const loaderHidden = useRef(false);
  useEffect(() => {
    // Première réponse du worker reçue : le village est monté.
    if (!built) return;
    meshesMounted.current = true;
    invalidate();
  }, [built, invalidate]);

  const meshesRef = useRef(new Map<string, THREE.Mesh>());

  // Portes : chaque vantail tourne vers l'intérieur autour de ses gonds quand
  // le promeneur approche, se referme derrière lui (et à la sortie de la
  // promenade). Ses pièces mobiles sont des meshes à part (un par matériau),
  // qui partagent l'angle de leur porte.
  const doorAngles = useRef(new Map<string, number>());
  const swingDoors = (delta: number): boolean => {
    const feet = walkerPresence.feet;
    const angles = doorAngles.current;
    const moved = new Map<string, number>();
    let moving = false;
    for (const mesh of meshesRef.current.values()) {
      const data = mesh.userData.door as DoorMeshData | null;
      if (!data) continue;
      const { doorId, hinge: door } = data;
      let angle = moved.get(doorId);
      if (angle === undefined) {
        const near =
          feet !== null &&
          Math.hypot(feet[0] - door.center[0], feet[2] - door.center[2]) < DOOR_OPEN_DISTANCE &&
          Math.abs(feet[1] - (door.center[1] - 0.4)) < 0.4;
        const target = near ? DOOR_OPEN_ANGLE : 0;
        const current = angles.get(doorId) ?? 0;
        const step = Math.min(Math.abs(target - current), DOOR_SPEED * Math.min(delta, 0.1));
        angle = current + Math.sign(target - current) * step;
        if (angle !== target) moving = true;
        if (angle === 0) angles.delete(doorId);
        else angles.set(doorId, angle);
        moved.set(doorId, angle);
      }
      const { rotationY, position } = doorPose(door, angle);
      if (mesh.rotation.y === rotationY) continue;
      mesh.rotation.y = rotationY;
      mesh.position.set(...position);
    }
    return moving;
  };

  useFrame(({ invalidate }, delta) => {
    if (meshesMounted.current && !loaderHidden.current) {
      loaderHidden.current = true;
      requestAnimationFrame(hideAppLoader);
    }
    // Même horloge que `cell.spawnedAt` (villageGrid.ts), pas celle du canvas.
    const time = performance.now() / 1000;
    for (const set of materials.values()) updateGrowTime(set, time, blockTransitionEnabled);
    if (blockTransitionEnabled && time < animateUntil) invalidate();
    if (swingDoors(delta)) invalidate();
  });

  // Meshes des chunks gérés directement en three.js, pas en éléments React :
  // une génération remplace une centaine de chunks d'un coup, et leur
  // réconciliation par React figeait ~100 ms la frame de livraison. Ici, un
  // chunk gardé reçoit sa nouvelle géométrie en place ; seuls les chunks
  // apparus ou disparus sont ajoutés ou retirés du groupe.
  const groupRef = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const parent = groupRef.current;
    if (!parent) return;
    const meshes = meshesRef.current;
    const kept = new Set<string>();
    for (const { key, mat, geometry, door } of groups) {
      const set = materials.get(matKey(mat));
      if (!set) continue;
      kept.add(key);
      let mesh = meshes.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, set.material);
        mesh.name = `village-${key}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        meshes.set(key, mesh);
        parent.add(mesh);
      }
      mesh.geometry = geometry;
      mesh.material = set.material;
      mesh.customDepthMaterial = set.depthMaterial;
      mesh.userData.door = door
        ? ({ doorId: key.slice(0, key.indexOf('|')), hinge: door } satisfies DoorMeshData)
        : null;
    }
    const gone = [...meshes].filter(([key]) => !kept.has(key));
    if (gone.length > 0) parent.remove(...gone.map(([, mesh]) => mesh));
    for (const [key] of gone) meshes.delete(key);
    invalidate();
  }, [groups, materials, invalidate]);

  return <group ref={groupRef} name="village" />;
}
