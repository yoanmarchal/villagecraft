import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Color, type DirectionalLight } from 'three';
import { useShallow } from 'zustand/react/shallow';
import type { GridCell } from '../types';
import { VillageMeshes } from './VillageMeshes';
import { PlacementPreview } from './PlacementPreview';
import { SkyDome } from './SkyDome';
import { Terrain, TERRAIN_FINE_STEP } from './Terrain';
import { Trees } from './Trees';
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ColorGrade } from './ColorGrade';
import { ToneMappingMode } from 'postprocessing';
import { useControlStore, type ControlState } from '../store/controlStore';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { useUiStore } from '../store/uiStore';
import { GRID_HEIGHT, initialCameraScale, sceneScale, shadowCameraHalfSize } from '../config/gridConfig';
import { raycastVoxels, targetColumn } from '../utils/voxelRaycast';
import { createGround, raycastGround } from '../render/ground';
import { groundHeight } from '../render/landscape';
import { RELIEF_MAX, reliefFor, reliefHeight, type Relief } from '../render/relief';

// Chargé seulement quand le moniteur est activé (Debug) : hors du bundle initial.
const Perf = lazy(() => import('r3f-perf').then((module) => ({ default: module.Perf })));

/** Étalonnage appliqué après le tone mapping AgX (voir ColorGrade). */
const GRADE_CONTRAST = 1.22;
const GRADE_SATURATION = 1.16;

// Vue assez basse pour montrer l'horizon et le ciel dès l'arrivée.
const BASE_CAMERA_POSITION: [number, number, number] = [11, 8, 15];

/**
 * Position initiale de la caméra. Le FOV (45°) est vertical : sur un écran
 * en portrait le champ horizontal se resserre et coupe le village, on
 * recule donc la caméra en proportion (plafonné).
 */
function initialCameraPosition(gridSize: number): [number, number, number] {
  const aspect = window.innerWidth / window.innerHeight;
  // Plafonné pour rester en deçà du début du brouillard par défaut.
  const factor = aspect < 1 ? Math.min(1.4, 1 / aspect) : 1;
  const scale = initialCameraScale(gridSize);
  return BASE_CAMERA_POSITION.map((v) => v * factor * scale) as [number, number, number];
}

/** Au-delà de ce déplacement (px) entre pointerdown et pointerup, c'est un drag caméra, pas un clic. */
const CLICK_MAX_DRAG_PX = 5;

/**
 * Côté de la surface de clic invisible. Bien plus grande que la grille : un
 * rayon qui touche un bâtiment (voir raycastVoxels) doit aussi rencontrer le
 * plan, même quand il passe au ras d'une tour en bord de grille.
 */
const CLICK_PLANE_SIZE = 1000;
/** Garde de la caméra au-dessus du terrain. */
const CAMERA_CLEARANCE = 0.4;

/**
 * Quadrillage discret de la grille, drapé sur le terrain : ses sommets sont
 * ceux de la maille fine du terrain (Terrain.tsx), les lignes suivent donc
 * exactement la surface, juste au-dessus de l'herbe (évite le z-fighting).
 */
function GridLines({ width, depth, relief }: { width: number; depth: number; relief: Relief }) {
  const geometry = useMemo(() => {
    const points: number[] = [];
    const line = (count: number, length: number, at: (index: number, along: number) => [number, number]) => {
      const steps = Math.round(length / TERRAIN_FINE_STEP);
      for (let index = 0; index <= count; index += 1) {
        for (let s = 0; s < steps; s += 1) {
          for (const along of [s, s + 1]) {
            const [x, z] = at(index, (along * length) / steps);
            points.push(x, reliefHeight(x, z, relief) + 0.004, z);
          }
        }
      }
    };
    line(width, depth, (index, along) => [index - width / 2, along - depth / 2]);
    line(depth, width, (index, along) => [along - width / 2, index - depth / 2]);
    const lines = new BufferGeometry();
    lines.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
    return lines;
  }, [width, depth, relief]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#000000" transparent opacity={0.08} depthWrite={false} />
    </lineSegments>
  );
}

/**
 * Le terrain n'est plus plat sous la caméra : après OrbitControls (priorité
 * −1), on la remonte si elle passerait sous le sol.
 */
function CameraFloor({ heightAt }: { heightAt: (x: number, z: number) => number }) {
  useFrame(({ camera }) => {
    const floor = heightAt(camera.position.x, camera.position.z) + CAMERA_CLEARANCE;
    if (camera.position.y < floor) camera.position.y = floor;
  });
  return null;
}

/**
 * Lumière du ciel (hémisphérique) : le dessus des volumes prend la teinte du
 * ciel, le dessous celle du sol éclairé — des ombres bleutées et des débords
 * de toit réchauffés par le rebond, là où une ambiante uniforme aplatit tout.
 */
function skyLightColors(ambientColor: string, skyTopColor: string, groundColor: string, sunColor: string) {
  const sky = new Color(ambientColor).lerp(new Color(skyTopColor), 0.45);
  const bounce = new Color(groundColor).multiply(new Color(sunColor)).multiplyScalar(0.55);
  return { sky, bounce };
}

/** Exposition du tone mapping : réglage impératif du renderer → frame à demander. */
function Exposure({ value }: { value: number }) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    // Le renderer est un objet impératif de three, pas un état React : son
    // exposition ne peut être réglée que par affectation.
    // eslint-disable-next-line react-hooks/immutability
    gl.toneMappingExposure = value;
    invalidate();
  }, [gl, value, invalidate]);
  return null;
}

/** Pointeurs enfoncés, et si le geste en cours en a compté plusieurs (pinch). */
interface GestureState {
  active: Set<number>;
  multiTouch: boolean;
}

/**
 * Suit les pointeurs enfoncés sur le canvas, en phase de capture sur
 * `window` : passe avant les handlers R3F, et voit aussi les pointerup
 * capturés par OrbitControls. Un geste à plusieurs doigts (pinch) n'est
 * jamais un tap, même si l'un des doigts se relève là où il s'est posé.
 */
function GestureTracker({ gesture }: { gesture: RefObject<GestureState> }) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const root = gl.domElement.parentElement ?? gl.domElement;
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.contains(event.target)) return;
      const state = gesture.current;
      if (state.active.size === 0) state.multiTouch = false;
      state.active.add(event.pointerId);
      if (state.active.size > 1) state.multiTouch = true;
    };
    const onUp = (event: PointerEvent) => gesture.current.active.delete(event.pointerId);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [gl, gesture]);

  return null;
}

/** Clé numérique d'une case (côté ≤ 64 sur chaque axe). */
const voxelKey = (x: number, y: number, z: number) => x + 64 * (y + 64 * z);

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
  terrainRelief: state.terrainRelief,
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
  exposure: state.exposure,
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
  const { skyTopColor, skyHorizonColor, fogColor, fogNear, fogFar, groundColor, groundRoughness, terrainRelief } =
    useControlStore(useShallow(selectSkyFog));
  const { dampingFactor, maxPolarAngle, minDistance, maxDistance } = useControlStore(useShallow(selectCamera));
  const {
    aoEnabled,
    aoIntensity,
    aoRadius,
    bloomEnabled,
    bloomLuminanceThreshold,
    bloomLuminanceSmoothing,
    bloomHeight,
    noiseOpacity,
    exposure,
    vignetteOffset,
    vignetteDarkness,
  } = useControlStore(useShallow(selectPostFx));

  const skyLight = useMemo(
    () => skyLightColors(ambientColor, skyTopColor, groundColor, directionalColor),
    [ambientColor, skyTopColor, groundColor, directionalColor],
  );
  // Paysage : sans colline partout où la caméra peut orbiter, visible jusqu'au bout du brouillard.
  const flatRadius = maxDistance * scale + 4;
  const landscapeReach = Math.max(fogFar * scale, flatRadius + 20);
  // Relief sous le village, et niveau de chaque bâtiment posé dessus (ground.ts).
  const relief = useMemo(
    () => reliefFor(Math.max(gridWidth, gridDepth), terrainRelief),
    [gridWidth, gridDepth, terrainRelief],
  );
  const ground = useMemo(() => createGround(cells, toWorldPosition, relief), [cells, toWorldPosition, relief]);
  const cameraFloor = useMemo(
    () => (x: number, z: number) => groundHeight(x, z, flatRadius, relief),
    [flatRadius, relief],
  );

  // N8AO (~85 kB gzip) n'est chargé qu'une fois l'effet activé. Pas de
  // React.lazy + Suspense ici : l'EffectComposer ne recalcule ses passes que
  // quand ses enfants changent, il faut donc monter le composant une fois
  // le module arrivé (même mécanique que l'activation/désactivation du bloom).
  const [AmbientOcclusion, setAmbientOcclusion] = useState<ComponentType<{ intensity: number; radius: number }> | null>(
    null,
  );
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
  const showAo = aoEnabled && AmbientOcclusion !== null;

  // Position écran du pointerdown : le clic gauche/droit glissé sert aussi à
  // OrbitControls (rotation/pan), on n'agit donc qu'au pointerup, et
  // seulement si le pointeur n'a quasiment pas bougé entre-temps.
  const pointerDownRef = useRef<{ x: number; y: number; button: number; pointerId: number } | null>(null);
  const gestureRef = useRef<GestureState>({ active: new Set(), multiTouch: false });

  // Cases occupées (caps de toit et arches auto compris), pour viser le bloc sous le curseur.
  const solidCells = useMemo(() => new Set(cells.map(({ x, y, z }) => voxelKey(x, y, z))), [cells]);

  /**
   * Colonne visée : le premier bloc que traverse le rayon du pointeur (sur
   * un flanc, en construction, la colonne voisine — on bâtit contre le mur) ;
   * à défaut, la case du terrain sous le pointeur (le terrain, en pente,
   * peut aussi masquer un bloc : le plus proche des deux l'emporte).
   */
  const pickColumn = (event: ThreeEvent<PointerEvent>, build: boolean) => {
    const { origin, direction } = event.ray;
    const hit = raycastVoxels(
      [origin.x + gridWidth / 2, origin.y, origin.z + gridDepth / 2],
      [direction.x, direction.y, direction.z],
      [gridWidth, GRID_HEIGHT, gridDepth],
      (x, y, z) => solidCells.has(voxelKey(x, y, z)),
      ground.relief.amplitude > 0 ? ground.baseAt : undefined,
    );
    const soil = raycastGround(ground, [origin.x, origin.y, origin.z], [direction.x, direction.y, direction.z]);
    if (hit && (!soil || hit.t <= soil.t + 1e-6)) {
      const { x, z } = targetColumn(hit, build, gridWidth, gridDepth);
      return { gridX: x, gridZ: z };
    }
    const point = soil ?? event.point;
    return {
      gridX: Math.floor(point.x + gridWidth / 2),
      gridZ: Math.floor(point.z + gridDepth / 2),
    };
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const { gridX, gridZ } = pickColumn(event, toolMode === 'build');
    onPreviewMove(gridX, gridZ);
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const { clientX, clientY, pointerId } = event.nativeEvent;
    pointerDownRef.current = { x: clientX, y: clientY, button: event.button, pointerId };
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!down || down.button !== event.button || down.pointerId !== event.nativeEvent.pointerId) return;
    if (gestureRef.current.multiTouch) return;

    const dragDistance = Math.hypot(event.nativeEvent.clientX - down.x, event.nativeEvent.clientY - down.y);
    if (dragDistance > CLICK_MAX_DRAG_PX) return;

    // Clic droit : toujours démolir. Clic gauche / tap : selon l'outil actif.
    const demolish = event.button === 2 || (event.button === 0 && toolMode === 'demolish');
    const { gridX, gridZ } = pickColumn(event, !demolish);
    onPreviewMove(gridX, gridZ);

    if (demolish) {
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
      camera={{ position: cameraPosition, fov: 45, near: 0.1, far: 1000 }}
      gl={{ antialias: true }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <SkyDome
        top={skyTopColor}
        horizon={skyHorizonColor}
        sunPosition={directionalPosition}
        sunColor={directionalColor}
        sunIntensity={directionalIntensity}
      />
      <Exposure value={exposure} />
      <fog attach="fog" args={[fogColor, fogNear * scale, fogFar * scale]} />
      {showPerfMonitor && (
        <Suspense fallback={null}>
          <Perf position="top-left" />
        </Suspense>
      )}
      <hemisphereLight args={[skyLight.sky, skyLight.bounce, ambientIntensity]} />
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
      <GestureTracker gesture={gestureRef} />
      <Terrain
        grassColor={groundColor}
        roughness={groundRoughness}
        flatRadius={flatRadius}
        reach={landscapeReach}
        relief={relief}
      />
      <Trees gridSize={Math.max(gridWidth, gridDepth)} flatRadius={flatRadius} reach={landscapeReach} relief={relief} />
      <GridLines width={gridWidth} depth={gridDepth} relief={relief} />
      <CameraFloor heightAt={cameraFloor} />
      {/* Surface de clic : invisible (ni couleur ni profondeur), seulement
          raycastée — c'est son rayon qui sert ensuite à viser les blocs et le
          terrain (pickColumn). Sous le creux le plus bas du relief, pour que
          tout rayon qui touche le sol la rencontre aussi. */}
      <mesh
        position={[0, -(relief.amplitude * RELIEF_MAX + 0.5), 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerOut={onPreviewLeave}
      >
        <planeGeometry args={[CLICK_PLANE_SIZE, CLICK_PLANE_SIZE]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <VillageMeshes
        cells={cells}
        toWorldPosition={toWorldPosition}
        gridWidth={gridWidth}
        gridDepth={gridDepth}
        relief={relief}
      />
      <PlacementPreview
        previewCell={previewCell}
        mode={toolMode}
        toWorldPosition={toWorldPosition}
        getNextPlacementY={getNextPlacementY}
        getRemovalY={getRemovalY}
        baseAt={ground.baseAt}
      />
      <OrbitControls
        enableDamping
        dampingFactor={dampingFactor}
        maxPolarAngle={maxPolarAngle}
        minDistance={minDistance}
        maxDistance={maxDistance * scale}
      />
      {/* `key` : le composer est recréé quand la passe AO apparaît/disparaît.
          N8AO réclame une depth texture ; ajoutée à un composer qui a déjà
          rendu (chunk AO arrivé après les premières frames, ou AO réactivée),
          le renderbuffer MSAA reste en DEPTH24 alors que la texture est en
          DEPTH32F, et la résolution MSAA (blitFramebuffer) échoue à chaque
          frame sur les pilotes stricts (Metal/macOS) : GL_INVALID_OPERATION. */}
      <EffectComposer key={showAo ? 'ao' : 'plain'}>
        {/* Occlusion ambiante en premier : elle doit assombrir la scène avant
            que bloom/vignette ne s'appliquent. */}
        {showAo && AmbientOcclusion ? <AmbientOcclusion intensity={aoIntensity} radius={aoRadius} /> : <></>}
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
        {/* AO et bloom travaillent en linéaire HDR (tampon demi-flottant) ; le
            tone mapping ramène l'image dans [0, 1], puis viennent
            l'étalonnage et la finition. Le grain passe après : ajouté avant,
            en HDR, il ressortait en points blancs dans les ombres de nuit. */}
        <ToneMapping mode={ToneMappingMode.AGX} />
        <ColorGrade contrast={GRADE_CONTRAST} saturation={GRADE_SATURATION} />
        {noiseOpacity > 0 ? <Noise opacity={noiseOpacity} /> : <></>}
        <Vignette eskil={false} offset={vignetteOffset} darkness={vignetteDarkness} />
      </EffectComposer>
    </Canvas>
  );
}
