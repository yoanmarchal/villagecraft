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
}

export interface SkyFogState {
  backgroundColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  skyDistance: number;
  skySunPosition: [number, number, number];
  skyInclination: number;
  skyAzimuth: number;
  skyTurbidity: number;
  skyRayleigh: number;
  groundColor: string;
  groundOpacity: number;
  groundRoughness: number;
}

export interface CameraState {
  dampingFactor: number;
  maxPolarAngle: number;
  minDistance: number;
  maxDistance: number;
}

export interface PostFxState {
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

export interface ControlState
  extends GridState,
    LightingState,
    SkyFogState,
    CameraState,
    PostFxState,
    DebugState,
    UiState {
  setGridSize: (gridSize: number) => void;
  setLighting: (patch: Partial<LightingState>) => void;
  setSkyFog: (patch: Partial<SkyFogState>) => void;
  setCamera: (patch: Partial<CameraState>) => void;
  setPostFx: (patch: Partial<PostFxState>) => void;
  setDebug: (patch: Partial<DebugState>) => void;
  togglePanel: () => void;
}

const DEFAULT_STATE: GridState & LightingState & SkyFogState & CameraState & PostFxState & DebugState & UiState = {
  gridSize: 2,

  ambientIntensity: 1.3,
  ambientColor: '#fffaed',
  directionalIntensity: 1.8,
  directionalColor: '#fffaed',
  directionalPosition: [12, 16, 10],
  shadowMapSize: 2048,
  shadowRadius: 4,
  shadowBias: -0.0001,

  backgroundColor: '#b8d4f1',
  fogColor: '#d0e5f5',
  fogNear: 30,
  fogFar: 60,
  skyDistance: 450000,
  skySunPosition: [100, 20, 100],
  skyInclination: 0.6,
  skyAzimuth: 0.25,
  skyTurbidity: 8,
  skyRayleigh: 1.2,
  groundColor: '#f5e6d3',
  groundOpacity: 0.95,
  groundRoughness: 0.95,

  dampingFactor: 0.08,
  maxPolarAngle: Math.PI / 2.08,
  minDistance: 6,
  maxDistance: 36,

  bloomEnabled: true,
  bloomLuminanceThreshold: 0.3,
  bloomLuminanceSmoothing: 0.9,
  bloomHeight: 300,
  noiseOpacity: 0.02,
  vignetteOffset: 0.1,
  vignetteDarkness: 0.5,

  showPerfMonitor: false,

  panelVisible: true,
};

export const useControlStore = create<ControlState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setGridSize: (gridSize) => set({ gridSize }),
      setLighting: (patch) => set(patch),
      setSkyFog: (patch) => set(patch),
      setCamera: (patch) => set(patch),
      setPostFx: (patch) => set(patch),
      setDebug: (patch) => set(patch),
      togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),
    }),
    {
      name: 'voxel-control-panel',
      version: 1,
    },
  ),
);
