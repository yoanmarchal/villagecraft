import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface GridState {
  gridSize: number;
}

export interface LightingState {
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
}

export interface SkyFogState {
  /** Fond en dégradé vertical : haut de l'écran → horizon (voir GradientBackground). */
  skyTopColor: string;
  skyHorizonColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /** Dessus (herbe) du socle du village ; les flancs sont en terre (GroundTile). */
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
  extends GridState,
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

  ambientIntensity: 0.7,
  ambientColor: '#fffaed',
  directionalIntensity: 2.4,
  directionalColor: '#fffaed',
  directionalPosition: [12, 16, 10],
  shadowMapSize: 2048,
  shadowRadius: 4,
  shadowBias: -0.0001,
  windowGlow: 0,

  skyTopColor: '#7fb6e8',
  skyHorizonColor: '#dcebf5',
  fogColor: '#dcebf5',
  fogNear: 30,
  fogFar: 60,
  groundColor: '#a9bd84',
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
  vignetteOffset: 0.1,
  vignetteDarkness: 0.5,

  showPerfMonitor: false,

  panelVisible: true,

  wallRoughness: 0.94,
  wallBaseColor: '#f5e6d3',
  roofBaseColor: '#c85a3f',
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

export function migrateControlState(persisted: unknown, version: number): PersistedState {
  const state: PersistedState = { ...(persisted as PersistedState) };
  if (version < 2) {
    const defaults = DEFAULT_STATE as unknown as PersistedState;
    for (const [key, oldDefault] of Object.entries(V1_CHANGED_DEFAULTS)) {
      if (state[key] === oldDefault) state[key] = defaults[key];
    }
    for (const key of V1_REMOVED_KEYS) delete state[key];
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
      version: 2,
      migrate: (persisted, version) => migrateControlState(persisted, version) as unknown as ControlState,
    },
  ),
);
