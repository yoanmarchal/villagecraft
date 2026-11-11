import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GridState {
  gridSize: number;
}

export interface LightingState {
  /** Lumière du ciel (hémisphérique, voir VoxelScene) : intensité et teinte. */
  ambientIntensity: number;
  ambientColor: string;
  directionalIntensity: number;
  directionalColor: string;
  directionalPosition: [number, number, number];
  shadowMapSize: number;
  shadowRadius: number;
  shadowBias: number;
  /** 0 = fenêtres éteintes, 1 = pleinement éclairées (soirée, nuit). */
  windowGlow: number;
  /**
   * Éclairage d'appoint de jour des pièces (lumière qui entre par les
   * fenêtres) ; le soir, `windowGlow` le remplace par la lampe, plus chaude.
   */
  interiorFill: number;
}

export interface SkyFogState {
  /** Ciel : dégradé du zénith à l'horizon (voir SkyDome). */
  skyTopColor: string;
  skyHorizonColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /** Teinte de base de la prairie (voir Terrain). */
  groundColor: string;
  groundRoughness: number;
}

export interface CameraState {
  dampingFactor: number;
  maxPolarAngle: number;
  minDistance: number;
  maxDistance: number;
}

export interface PostFxState {
  aoEnabled: boolean;
  aoIntensity: number;
  aoRadius: number;
  bloomEnabled: boolean;
  bloomLuminanceThreshold: number;
  bloomLuminanceSmoothing: number;
  bloomHeight: number;
  noiseOpacity: number;
  /** Exposition avant tone mapping (1 = neutre). */
  exposure: number;
  vignetteOffset: number;
  vignetteDarkness: number;
}

export interface DebugState {
  showPerfMonitor: boolean;
}

export interface UiState {
  panelVisible: boolean;
}

export interface CellMaterialsState {
  wallRoughness: number;
  wallBaseColor: string;
  roofBaseColor: string;
  /** Ardoise des toitures de tours. */
  spireColor: string;
}

export interface CellDecorationsState {
  windowStonesPerFace: number;
  windowStoneRoughness: number;
  quoinMargin: number;
  quoinRoughness: number;
}

export interface CellRoofState {
  ridgeY: number;
  towerR: number;
  merlonCount: number;
  merlonR: number;
  merlonH: number;
  spireH: number;
}

export interface CellShapeState {
  isolatedWallRadius: number;
  connectedWallExposedRadius: number;
  connectedWallInteriorRadius: number;
}

export interface CellTransitionState {
  blockTransitionEnabled: boolean;
}

export interface ControlState
  extends
    GridState,
    LightingState,
    SkyFogState,
    CameraState,
    PostFxState,
    DebugState,
    UiState,
    CellMaterialsState,
    CellDecorationsState,
    CellRoofState,
    CellShapeState,
    CellTransitionState {
  setGridSize: (gridSize: number) => void;
  togglePanel: () => void;
  resetToDefaults: () => void;
  // Les autres réglages sont écrits directement par le panneau (controls/storeFolder.ts)
  // et les ambiances (setState), sans setter dédié par domaine.
}

const DEFAULT_STATE: GridState &
  LightingState &
  SkyFogState &
  CameraState &
  PostFxState &
  DebugState &
  UiState &
  CellMaterialsState &
  CellDecorationsState &
  CellRoofState &
  CellShapeState &
  CellTransitionState = {
  gridSize: 4,

  ambientIntensity: 1.1,
  ambientColor: '#dfe9ff',
  directionalIntensity: 3.4,
  directionalColor: '#ffe2bd',
  directionalPosition: [16, 11, 5],
  shadowMapSize: 2048,
  shadowRadius: 4,
  shadowBias: -0.0001,
  windowGlow: 0,
  interiorFill: 0.45,

  skyTopColor: '#3f86d9',
  skyHorizonColor: '#cfe4f5',
  fogColor: '#cfe4f5',
  fogNear: 22,
  fogFar: 110,
  groundColor: '#6f8a4a',
  groundRoughness: 0.95,

  dampingFactor: 0.08,
  maxPolarAngle: Math.PI / 2.08,
  minDistance: 6,
  maxDistance: 36,

  aoEnabled: true,
  aoIntensity: 4,
  aoRadius: 1,
  bloomEnabled: true,
  bloomLuminanceThreshold: 0.85,
  bloomLuminanceSmoothing: 0.9,
  bloomHeight: 300,
  noiseOpacity: 0.02,
  exposure: 1.15,
  vignetteOffset: 0.1,
  vignetteDarkness: 0.5,

  showPerfMonitor: false,

  panelVisible: true,

  wallRoughness: 0.94,
  wallBaseColor: '#f5e6d3',
  roofBaseColor: '#a65238',
  spireColor: '#56606c',

  windowStonesPerFace: 25,
  windowStoneRoughness: 0.85,
  quoinMargin: 0.2,
  quoinRoughness: 0.9,

  ridgeY: 0.22,
  towerR: 0.5,
  merlonCount: 6,
  merlonR: 0.1,
  merlonH: 0.28,
  spireH: 1.1,

  isolatedWallRadius: 0.22,
  connectedWallExposedRadius: 0.1,
  connectedWallInteriorRadius: 0.0,

  blockTransitionEnabled: true,
};

type PersistedState = Record<string, unknown>;

/**
 * v1 → v2 (refonte ciel/éclairage) : ces défauts ont changé. `persist`
 * enregistre tout l'état, donc sans migration un utilisateur existant
 * garderait les anciennes valeurs (image délavée, sol beige). On ne remplace
 * une valeur que si elle vaut encore l'ancien défaut : un réglage
 * personnalisé est conservé.
 */
const V1_CHANGED_DEFAULTS: PersistedState = {
  ambientIntensity: 1.3,
  directionalIntensity: 1.8,
  bloomLuminanceThreshold: 0.3,
  groundColor: '#f5e6d3',
  fogColor: '#d0e5f5',
  aoIntensity: 2,
  aoRadius: 0.6,
};

/** Réglages du ciel physique (drei Sky) et du plan de sol, supprimés en v2. */
const V1_REMOVED_KEYS = [
  'backgroundColor',
  'skyDistance',
  'skySunPosition',
  'skyInclination',
  'skyAzimuth',
  'skyTurbidity',
  'skyRayleigh',
  'groundOpacity',
];

/**
 * v2 → v3 (rendu réaliste : ciel en dôme, paysage, lumière hémisphérique,
 * tone mapping AgX) : l'éclairage par défaut a été refait pour ce pipeline —
 * soleil plus bas et plus chaud, ciel plus dense, brouillard bien plus
 * lointain (le paysage doit se voir), herbe et tuiles moins saturées.
 */
const V2_CHANGED_DEFAULTS: PersistedState = {
  ambientIntensity: 0.7,
  ambientColor: '#fffaed',
  directionalIntensity: 2.4,
  directionalColor: '#fffaed',
  directionalPosition: [12, 16, 10],
  skyTopColor: '#7fb6e8',
  skyHorizonColor: '#dcebf5',
  fogColor: '#dcebf5',
  fogNear: 30,
  fogFar: 60,
  groundColor: '#a9bd84',
  roofBaseColor: '#c85a3f',
};

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

export function migrateControlState(persisted: unknown, version: number): PersistedState {
  const state: PersistedState = { ...(persisted as PersistedState) };
  if (version < 2) {
    const defaults = DEFAULT_STATE as unknown as PersistedState;
    for (const [key, oldDefault] of Object.entries(V1_CHANGED_DEFAULTS)) {
      if (state[key] === oldDefault) state[key] = defaults[key];
    }
    for (const key of V1_REMOVED_KEYS) delete state[key];
  }
  if (version < 3) {
    const defaults = DEFAULT_STATE as unknown as PersistedState;
    for (const [key, oldDefault] of Object.entries(V2_CHANGED_DEFAULTS)) {
      if (sameValue(state[key], oldDefault)) state[key] = defaults[key];
    }
  }
  return state;
}

export const useControlStore = create<ControlState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setGridSize: (gridSize) => set({ gridSize }),
      togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),
      // La taille de grille est conservée : la changer recrée la grille et
      // rognerait le village, ce qu'on n'attend pas d'un reset de réglages.
      resetToDefaults: () => set((state) => ({ ...DEFAULT_STATE, gridSize: state.gridSize })),
    }),
    {
      name: 'voxel-control-panel',
      version: 3,
      migrate: (persisted, version) => migrateControlState(persisted, version) as unknown as ControlState,
    },
  ),
);
