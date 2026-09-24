import { OrbitControls, Sky } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import { VillageMeshes } from './VillageMeshes';
import { PlacementPreview } from './PlacementPreview';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { useControlStore, type ControlState } from '../store/controlStore';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';

// Chargé seulement quand le moniteur est activé (Debug) : hors du bundle initial.
const Perf = lazy(() => import('r3f-perf').then((module) => ({ default: module.Perf })));

const BASE_CAMERA_POSITION: [number, number, number] = [10, 12, 14];

/**
 * Position initiale de la caméra. Le FOV (45°) est vertical : sur un écran
 * en portrait le champ horizontal se resserre et coupe le village, on
 * recule donc la caméra en proportion (plafonné).
 */
function initialCameraPosition(): [number, number, number] {
  const aspect = window.innerWidth / window.innerHeight;
  // Plafonné pour rester en deçà du début du brouillard par défaut (fogNear = 30).
  const factor = aspect < 1 ? Math.min(1.4, 1 / aspect) : 1;
  return BASE_CAMERA_POSITION.map((v) => v * factor) as [number, number, number];
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
  backgroundColor: state.backgroundColor,
  fogColor: state.fogColor,
  fogNear: state.fogNear,
  fogFar: state.fogFar,
  skyDistance: state.skyDistance,
  skySunPosition: state.skySunPosition,
  skyInclination: state.skyInclination,
  skyAzimuth: state.skyAzimuth,
  skyTurbidity: state.skyTurbidity,
  skyRayleigh: state.skyRayleigh,
  groundColor: state.groundColor,
  groundOpacity: state.groundOpacity,
  groundRoughness: state.groundRoughness,
});

const selectCamera = (state: ControlState) => ({
  dampingFactor: state.dampingFactor,
  maxPolarAngle: state.maxPolarAngle,
  minDistance: state.minDistance,
  maxDistance: state.maxDistance,
});

const selectPostFx = (state: ControlState) => ({
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
  const [cameraPosition] = useState(initialCameraPosition);
  const gridSize = useControlStore((state) => state.gridSize);
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
  const {
    backgroundColor,
    fogColor,
    fogNear,
    fogFar,
    skyDistance,
    skySunPosition,
    skyInclination,
    skyAzimuth,
    skyTurbidity,
    skyRayleigh,
    groundColor,
    groundOpacity,
    groundRoughness,
  } = useControlStore(useShallow(selectSkyFog));
  const { dampingFactor, maxPolarAngle, minDistance, maxDistance } = useControlStore(
    useShallow(selectCamera),
  );
  const {
    bloomEnabled,
    bloomLuminanceThreshold,
    bloomLuminanceSmoothing,
    bloomHeight,
    noiseOpacity,
    vignetteOffset,
    vignetteDarkness,
  } = useControlStore(useShallow(selectPostFx));

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
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
      {showPerfMonitor && (
        <Suspense fallback={null}>
          <Perf position="top-left" />
        </Suspense>
      )}
      <ambientLight intensity={ambientIntensity} color={ambientColor} />
      <directionalLight
        position={directionalPosition}
        intensity={directionalIntensity}
        color={directionalColor}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-radius={shadowRadius}
        shadow-bias={shadowBias}
      />
      <Sky
        distance={skyDistance}
        sunPosition={skySunPosition}
        inclination={skyInclination}
        azimuth={skyAzimuth}
        turbidity={skyTurbidity}
        rayleigh={skyRayleigh}
      />
      <ScreenshotBridge />
      <gridHelper args={[Math.max(gridWidth, gridDepth), Math.max(gridWidth, gridDepth), '#d4c4a8', '#e8dcc8']} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerOut={onPreviewLeave}
        receiveShadow
      >
        <planeGeometry args={[gridWidth, gridDepth]} />
        <meshStandardMaterial color={groundColor} transparent opacity={groundOpacity} roughness={groundRoughness} />
      </mesh>
      <VillageMeshes cells={cells} toWorldPosition={toWorldPosition} />
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
        maxDistance={maxDistance}
      />
      <EffectComposer>
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
