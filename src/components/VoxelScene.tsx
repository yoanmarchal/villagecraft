import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import type { DirectionalLight } from 'three';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import { VillageMeshes } from './VillageMeshes';
import { PlacementPreview } from './PlacementPreview';
import { GradientBackground } from './GradientBackground';
import { GroundTile } from './GroundTile';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { useControlStore, type ControlState } from '../store/controlStore';
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { useUiStore } from '../store/uiStore';
import { initialCameraScale, sceneScale, shadowCameraHalfSize } from '../config/gridConfig';

// Chargé seulement quand le moniteur est activé (Debug) : hors du bundle initial.
const Perf = lazy(() => import('r3f-perf').then((module) => ({ default: module.Perf })));

const BASE_CAMERA_POSITION: [number, number, number] = [10, 12, 14];

/**
 * Position initiale de la caméra. Le FOV (45°) est vertical : sur un écran
 * en portrait le champ horizontal se resserre et coupe le village, on
 * recule donc la caméra en proportion (plafonné).
 */
function initialCameraPosition(gridSize: number): [number, number, number] {
  const aspect = window.innerWidth / window.innerHeight;
  // Plafonné pour rester en deçà du début du brouillard par défaut (fogNear = 30).
  const factor = aspect < 1 ? Math.min(1.4, 1 / aspect) : 1;
  const scale = initialCameraScale(gridSize);
  return BASE_CAMERA_POSITION.map((v) => v * factor * scale) as [number, number, number];
}

/** Au-delà de ce déplacement (px) entre pointerdown et pointerup, c'est un drag caméra, pas un clic. */
const CLICK_MAX_DRAG_PX = 5;

interface VoxelSceneProps {
  cells: GridCell[];
  gridWidth: number;
  gridDepth: number;
  selectedHeight: number;
  onAddBlock: (x: number, y: number, z: number) => void;
  onRemoveColumn: (x: number, z: number) => void;
  onPreviewMove: (x: number, z: number) => void;
  onPreviewLeave: () => void;
  previewCell: { x: number; z: number } | null;
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
  getNextPlacementY: (x: number, z: number, minimumY: number) => number | null;
  /** Y du bloc que la démolition retirerait dans la colonne (null si vide). */
  getRemovalY: (x: number, z: number) => number | null;
}

/**
 * Expose à l'UI une capture PNG du canvas. `advance()` rend une frame de
 * façon synchrone (post-processing compris) : le buffer est donc encore
 * valide au moment de `toDataURL`, sans `preserveDrawingBuffer` (coûteux).
 */
function ScreenshotBridge() {
  const gl = useThree((state) => state.gl);
  const advance = useThree((state) => state.advance);

  useEffect(() => {
    const { setCaptureScreenshot } = useUiStore.getState();
    setCaptureScreenshot(() => {
      advance(performance.now());
      return gl.domElement.toDataURL('image/png');
    });
    return () => setCaptureScreenshot(null);
  }, [gl, advance]);

  return null;
}

const selectLighting = (state: ControlState) => ({
  ambientIntensity: state.ambientIntensity,
  ambientColor: state.ambientColor,
  directionalIntensity: state.directionalIntensity,
  directionalColor: state.directionalColor,
  directionalPosition: state.directionalPosition,
  shadowMapSize: state.shadowMapSize,
  shadowRadius: state.shadowRadius,
  shadowBias: state.shadowBias,
});

const selectSkyFog = (state: ControlState) => ({
  skyTopColor: state.skyTopColor,
  skyHorizonColor: state.skyHorizonColor,
  fogColor: state.fogColor,
  fogNear: state.fogNear,
  fogFar: state.fogFar,
  groundColor: state.groundColor,
  groundRoughness: state.groundRoughness,
});

const selectCamera = (state: ControlState) => ({
  dampingFactor: state.dampingFactor,
  maxPolarAngle: state.maxPolarAngle,
  minDistance: state.minDistance,
  maxDistance: state.maxDistance,
});

const selectPostFx = (state: ControlState) => ({
  aoEnabled: state.aoEnabled,
  aoIntensity: state.aoIntensity,
  aoRadius: state.aoRadius,
  bloomEnabled: state.bloomEnabled,
  bloomLuminanceThreshold: state.bloomLuminanceThreshold,
  bloomLuminanceSmoothing: state.bloomLuminanceSmoothing,
  bloomHeight: state.bloomHeight,
  noiseOpacity: state.noiseOpacity,
  vignetteOffset: state.vignetteOffset,
  vignetteDarkness: state.vignetteDarkness,
});

export function VoxelScene({
  cells,
  gridWidth,
  gridDepth,
  selectedHeight,
  onAddBlock,
  onRemoveColumn,
  onPreviewMove,
  onPreviewLeave,
  previewCell,
  toWorldPosition,
  getNextPlacementY,
  getRemovalY,
}: VoxelSceneProps) {
  const toolMode = useUiStore((state) => state.toolMode);
  // Calculée une seule fois : R3F réapplique les options caméra si elles changent.
  const gridSize = useControlStore((state) => state.gridSize);
  const [cameraPosition] = useState(() => initialCameraPosition(gridSize));
  // Distances caméra/brouillard étirées pour les grandes grilles (voir gridConfig).
  const scale = sceneScale(gridSize);
  const shadowHalf = shadowCameraHalfSize(gridSize);
  const sunRef = useRef<DirectionalLight>(null);


  // Les bornes de la caméra d'ombre sont posées via props : il faut
  // recalculer sa projection nous-mêmes quand elles changent.
  useEffect(() => {
    sunRef.current?.shadow.camera.updateProjectionMatrix();
  }, [shadowHalf]);
  const showPerfMonitor = useControlStore((state) => state.showPerfMonitor);
  const {
    ambientIntensity,
    ambientColor,
    directionalIntensity,
    directionalColor,
    directionalPosition,
    shadowMapSize,
    shadowRadius,
    shadowBias,
  } = useControlStore(useShallow(selectLighting));
  const { skyTopColor, skyHorizonColor, fogColor, fogNear, fogFar, groundColor, groundRoughness } = useControlStore(
    useShallow(selectSkyFog),
  );
  const { dampingFactor, maxPolarAngle, minDistance, maxDistance } = useControlStore(
    useShallow(selectCamera),
  );
  const {
    aoEnabled,
    aoIntensity,
    aoRadius,
    bloomEnabled,
    bloomLuminanceThreshold,
    bloomLuminanceSmoothing,
    bloomHeight,
    noiseOpacity,
    vignetteOffset,
    vignetteDarkness,
  } = useControlStore(useShallow(selectPostFx));

  // N8AO (~85 kB gzip) n'est chargé qu'une fois l'effet activé. Pas de
  // React.lazy + Suspense ici : l'EffectComposer ne recalcule ses passes que
  // quand ses enfants changent, il faut donc monter le composant une fois
  // le module arrivé (même mécanique que l'activation/désactivation du bloom).
  const [AmbientOcclusion, setAmbientOcclusion] = useState<ComponentType<{ intensity: number; radius: number }> | null>(null);
  useEffect(() => {
    if (!aoEnabled || AmbientOcclusion) return;
    let cancelled = false;
    void import('./AmbientOcclusion').then((module) => {
      if (!cancelled) setAmbientOcclusion(() => module.default);
    });
    return () => {
      cancelled = true;
    };
  }, [aoEnabled, AmbientOcclusion]);

  // Position écran du pointerdown : le clic gauche/droit glissé sert aussi à
  // OrbitControls (rotation/pan), on n'agit donc qu'au pointerup, et
  // seulement si le pointeur n'a quasiment pas bougé entre-temps.
  const pointerDownRef = useRef<{ x: number; y: number; button: number } | null>(null);

  const toGridCoords = (event: ThreeEvent<PointerEvent>) => ({
    gridX: Math.floor(event.point.x + gridWidth / 2),
    gridZ: Math.floor(event.point.z + gridDepth / 2),
  });

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const { gridX, gridZ } = toGridCoords(event);
    onPreviewMove(gridX, gridZ);
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    pointerDownRef.current = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY, button: event.button };
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!down || down.button !== event.button) return;

    const dragDistance = Math.hypot(event.nativeEvent.clientX - down.x, event.nativeEvent.clientY - down.y);
    if (dragDistance > CLICK_MAX_DRAG_PX) return;

    const { gridX, gridZ } = toGridCoords(event);
    onPreviewMove(gridX, gridZ);

    // Clic droit : toujours démolir. Clic gauche / tap : selon l'outil actif.
    if (event.button === 2 || (event.button === 0 && toolMode === 'demolish')) {
      onRemoveColumn(gridX, gridZ);
      return;
    }

    if (event.button === 0) {
      const placementY = getNextPlacementY(gridX, gridZ, selectedHeight);
      if (placementY !== null) {
        onAddBlock(gridX, placementY, gridZ);
      }
    }
  };

  return (
    <Canvas
      shadows="percentage"
      // Rendu à la demande : une frame seulement quand quelque chose change
      // (props R3F, OrbitControls, animation d'apparition — voir VillageMeshes).
      // Sauf avec le moniteur de perf : r3f-perf échantillonne via les
      // callbacks globaux de la boucle (addEffect/addAfterEffect), qui ne
      // tournent que si une frame est rendue — et mesurer des FPS n'a de sens
      // qu'en boucle continue.
      frameloop={showPerfMonitor ? 'always' : 'demand'}
      dpr={[1, 2]}
      camera={{ position: cameraPosition, fov: 45, near: 0.1, far: 100 }}
      gl={{ antialias: true }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <GradientBackground top={skyTopColor} horizon={skyHorizonColor} />
      <fog attach="fog" args={[fogColor, fogNear * scale, fogFar * scale]} />
      {showPerfMonitor && (
        <Suspense fallback={null}>
          <Perf position="top-left" />
        </Suspense>
      )}
      <ambientLight intensity={ambientIntensity} color={ambientColor} />
      <directionalLight
        ref={sunRef}
        position={directionalPosition}
        intensity={directionalIntensity}
        color={directionalColor}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-radius={shadowRadius}
        shadow-bias={shadowBias}
        shadow-camera-left={-shadowHalf}
        shadow-camera-right={shadowHalf}
        shadow-camera-top={shadowHalf}
        shadow-camera-bottom={-shadowHalf}
        shadow-camera-near={0.5}
        shadow-camera-far={100}
      />
      <ScreenshotBridge />
      <GroundTile width={gridWidth} depth={gridDepth} grassColor={groundColor} roughness={groundRoughness} />
      {/* Quadrillage discret, juste au-dessus de l'herbe (évite le z-fighting). */}
      <gridHelper
        args={[Math.max(gridWidth, gridDepth), Math.max(gridWidth, gridDepth), '#000000', '#000000']}
        position={[0, 0.003, 0]}
        material-transparent
        material-opacity={0.08}
        material-depthWrite={false}
      />
      {/* Surface de clic : invisible (ni couleur ni profondeur), seulement raycastée. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerOut={onPreviewLeave}
      >
        <planeGeometry args={[gridWidth, gridDepth]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <VillageMeshes cells={cells} toWorldPosition={toWorldPosition} gridWidth={gridWidth} gridDepth={gridDepth} />
      <PlacementPreview
        previewCell={previewCell}
        mode={toolMode}
        toWorldPosition={toWorldPosition}
        getNextPlacementY={getNextPlacementY}
        getRemovalY={getRemovalY}
      />
      <OrbitControls
        enableDamping
        dampingFactor={dampingFactor}
        maxPolarAngle={maxPolarAngle}
        minDistance={minDistance}
        maxDistance={maxDistance * scale}
      />
      <EffectComposer>
        {/* Occlusion ambiante en premier : elle doit assombrir la scène avant
            que bloom/vignette ne s'appliquent. */}
        {aoEnabled && AmbientOcclusion ? <AmbientOcclusion intensity={aoIntensity} radius={aoRadius} /> : <></>}
        {bloomEnabled ? (
          <Bloom
            mipmapBlur
            luminanceThreshold={bloomLuminanceThreshold}
            luminanceSmoothing={bloomLuminanceSmoothing}
            height={bloomHeight}
          />
        ) : (
          <></>
        )}
        {noiseOpacity > 0 ? <Noise opacity={noiseOpacity} /> : <></>}
        <Vignette eskil={false} offset={vignetteOffset} darkness={vignetteDarkness} />
      </EffectComposer>
    </Canvas>
  );
}
