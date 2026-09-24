/**
 * Ambiances prêtes à l'emploi : chacune règle ensemble la lumière, le ciel et
 * le brouillard (les réglages fins restent disponibles dans le panneau).
 */

import type { LightingState, SkyFogState } from '../store/controlStore';

export type AmbienceSettings = Pick<
  LightingState,
  'ambientIntensity' | 'ambientColor' | 'directionalIntensity' | 'directionalColor' | 'directionalPosition' | 'windowGlow'
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
      ambientIntensity: 0.7,
      ambientColor: '#fffaed',
      directionalIntensity: 2.4,
      directionalColor: '#fffaed',
      directionalPosition: [12, 16, 10],
      windowGlow: 0,
      skyTopColor: '#7fb6e8',
      skyHorizonColor: '#dcebf5',
      fogColor: '#dcebf5',
      fogNear: 30,
      fogFar: 60,
    },
  },
  {
    id: 'morning',
    label: 'Morning',
    settings: {
      ambientIntensity: 0.6,
      ambientColor: '#ffeedd',
      directionalIntensity: 2.1,
      directionalColor: '#ffd6ad',
      directionalPosition: [16, 8, -6],
      windowGlow: 0,
      skyTopColor: '#9cc0e6',
      skyHorizonColor: '#f6dcc6',
      fogColor: '#f3e0cf',
      fogNear: 28,
      fogFar: 58,
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    settings: {
      ambientIntensity: 0.5,
      ambientColor: '#ffd9c2',
      directionalIntensity: 2.2,
      directionalColor: '#ff9d5c',
      directionalPosition: [-14, 5, 8],
      windowGlow: 0.45,
      skyTopColor: '#5b5f9e',
      skyHorizonColor: '#f2a77c',
      fogColor: '#efb48f',
      fogNear: 26,
      fogFar: 55,
    },
  },
  {
    id: 'mist',
    label: 'Mist',
    settings: {
      ambientIntensity: 1.0,
      ambientColor: '#eef2f5',
      directionalIntensity: 1.2,
      directionalColor: '#f4f6f8',
      directionalPosition: [6, 18, 8],
      windowGlow: 0,
      skyTopColor: '#c3ccd3',
      skyHorizonColor: '#e3e8eb',
      fogColor: '#dfe6ea',
      fogNear: 12,
      fogFar: 38,
    },
  },
  {
    id: 'night',
    label: 'Night',
    settings: {
      ambientIntensity: 0.3,
      ambientColor: '#8fa3d9',
      directionalIntensity: 0.6,
      directionalColor: '#b8c8ff',
      directionalPosition: [-8, 14, -10],
      windowGlow: 1,
      skyTopColor: '#070b1c',
      skyHorizonColor: '#26305a',
      fogColor: '#1b2440',
      fogNear: 25,
      fogFar: 55,
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
