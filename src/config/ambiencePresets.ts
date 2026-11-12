/**
 * Ambiances prêtes à l'emploi : chacune règle ensemble la lumière, le ciel et
 * le brouillard (les réglages fins restent disponibles dans le panneau).
 */

import type { LightingState, SkyFogState } from '../store/controlStore';

export type AmbienceSettings = Pick<
  LightingState,
  | 'ambientIntensity'
  | 'ambientColor'
  | 'directionalIntensity'
  | 'directionalColor'
  | 'directionalPosition'
  | 'windowGlow'
> &
  Pick<SkyFogState, 'skyTopColor' | 'skyHorizonColor' | 'fogColor' | 'fogNear' | 'fogFar'>;

export interface AmbiencePreset {
  id: string;
  label: string;
  settings: AmbienceSettings;
}

export const AMBIENCE_PRESETS: AmbiencePreset[] = [
  {
    id: 'day',
    label: 'Day',
    // = valeurs par défaut du store
    settings: {
      ambientIntensity: 1.1,
      ambientColor: '#dfe9ff',
      directionalIntensity: 3.4,
      directionalColor: '#ffe2bd',
      directionalPosition: [16, 11, 5],
      windowGlow: 0,
      skyTopColor: '#3f86d9',
      skyHorizonColor: '#cfe4f5',
      fogColor: '#cfe4f5',
      fogNear: 22,
      fogFar: 110,
    },
  },
  {
    id: 'morning',
    label: 'Morning',
    settings: {
      ambientIntensity: 0.9,
      ambientColor: '#ffe9d6',
      directionalIntensity: 3,
      directionalColor: '#ffc892',
      directionalPosition: [14, 6, 8],
      windowGlow: 0,
      skyTopColor: '#7fb0e6',
      skyHorizonColor: '#f8dcc0',
      fogColor: '#f3dcc6',
      fogNear: 20,
      fogFar: 100,
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    settings: {
      ambientIntensity: 0.8,
      ambientColor: '#ffd9c2',
      directionalIntensity: 2.6,
      directionalColor: '#ffa76b',
      directionalPosition: [-14, 5, 8],
      windowGlow: 0.45,
      skyTopColor: '#5b5f9e',
      skyHorizonColor: '#f2a77c',
      fogColor: '#efb48f',
      fogNear: 20,
      fogFar: 100,
    },
  },
  {
    id: 'mist',
    label: 'Mist',
    settings: {
      ambientIntensity: 1.5,
      ambientColor: '#eef2f5',
      directionalIntensity: 1.4,
      directionalColor: '#f4f6f8',
      directionalPosition: [6, 18, 8],
      windowGlow: 0,
      skyTopColor: '#c3ccd3',
      skyHorizonColor: '#e3e8eb',
      fogColor: '#dfe6ea',
      fogNear: 8,
      fogFar: 42,
    },
  },
  {
    id: 'night',
    label: 'Night',
    settings: {
      ambientIntensity: 0.4,
      ambientColor: '#8fa3d9',
      directionalIntensity: 0.9,
      directionalColor: '#b8c8ff',
      directionalPosition: [-8, 14, -10],
      windowGlow: 1,
      skyTopColor: '#070b1c',
      skyHorizonColor: '#26305a',
      fogColor: '#1b2440',
      fogNear: 22,
      fogFar: 100,
    },
  },
];

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

/** L'ambiance dont tous les réglages correspondent à `state`, sinon null (réglages personnalisés). */
export function matchAmbience(state: AmbienceSettings): AmbiencePreset | null {
  return (
    AMBIENCE_PRESETS.find((preset) =>
      (Object.keys(preset.settings) as Array<keyof AmbienceSettings>).every((key) =>
        sameValue(preset.settings[key], state[key]),
      ),
    ) ?? null
  );
}
