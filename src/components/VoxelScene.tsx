import { OrbitControls, Sky } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import { VillageMeshes } from './VillageMeshes';
import { PlacementPreview } from './PlacementPreview';
import { Bloom, EffectComposer, Noise, Vignette } from '@react-three/postprocessing'
import { Perf } from 'r3f-perf';
import { useControlStore, type ControlState } from '../store/controlStore';

interface VoxelSceneProps {
  cells: GridCell[];
  gridWidth: number;
  gridDepth: number;
  selectedHeight: number;
  onCellAction: (action: 'add' | 'remove', x: number, y: number, z: number) => void;
  onPreviewMove: (x: number, z: number) => void;
  previewCell: { x: number; z: number } | null;
  toWorldPosition: (x: number, y: number, z: number) => [number, number, number];
  getNextPlacementY: (x: number, z: number, minimumY: number) => number | null;
  getTopRealOccupiedY: (x: number, z: number) => number | null;
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
  onCellAction,
  onPreviewMove,
  previewCell,
  toWorldPosition,
  getNextPlacementY,
  getTopRealOccupiedY,
}: VoxelSceneProps) {
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

  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const gridX = Math.floor(event.point.x + gridWidth / 2);
    const gridZ = Math.floor(event.point.z + gridDepth / 2);
    onPreviewMove(gridX, gridZ);
    const placementY = getNextPlacementY(gridX, gridZ, selectedHeight);
    const removalY = getTopRealOccupiedY(gridX, gridZ);

    if (event.button === 2) {
      if (removalY !== null) {
        onCellAction('remove', gridX, removalY, gridZ);
      }
      return;
    }

    if (event.button === 0 && placementY !== null) {
      onCellAction('add', gridX, placementY, gridZ);
    }
  };

  return (
    <Canvas
      shadows="percentage"
      camera={{ position: [10, 12, 14], fov: 45, near: 0.1, far: 100 }}
      gl={{ antialias: true }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <color attach="background" args={[backgroundColor]} />
      <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
      {showPerfMonitor && <Perf position="top-left" />}
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
        <gridHelper args={[Math.max(gridWidth, gridDepth), Math.max(gridWidth, gridDepth), '#d4c4a8', '#e8dcc8']} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerMove={handlePointer} onPointerDown={handlePointer} receiveShadow>
          <planeGeometry args={[gridWidth, gridDepth]} />
        <meshStandardMaterial color={groundColor} transparent opacity={groundOpacity} roughness={groundRoughness} />
      </mesh>
      <VillageMeshes cells={cells} toWorldPosition={toWorldPosition} />
      <PlacementPreview
        previewCell={previewCell}
        toWorldPosition={toWorldPosition}
        getNextPlacementY={getNextPlacementY}
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
        <Noise opacity={noiseOpacity} />
        <Vignette eskil={false} offset={vignetteOffset} darkness={vignetteDarkness} />
      </EffectComposer>
    </Canvas>
  );
}
