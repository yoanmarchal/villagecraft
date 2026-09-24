/**
 * Ambiances prêtes à l'emploi : chacune règle ensemble la lumière, le ciel et
 * le brouillard (les réglages fins restent disponibles dans le panneau).
 */

import type { LightingState, SkyFogState } from '../store/controlStore';

export type AmbienceSettings = Pick<
  LightingState,
  'ambientIntensity' | 'ambientColor' | 'directionalIntensity' | 'directionalColor' | 'directionalPosition'
> &
  Pick<SkyFogState, 'backgroundColor' | 'fogColor' | 'fogNear' | 'fogFar' | 'skySunPosition' | 'skyTurbidity' | 'skyRayleigh'>;

export interface AmbiencePreset {
  id: string;
  label: string;
  /** Dégradé (haut → bas) de la pastille dans la barre d'outils. */
  swatch: [string, string];
  settings: AmbienceSettings;
}

export const AMBIENCE_PRESETS: AmbiencePreset[] = [
  {
    id: 'day',
    label: 'Day',
    swatch: ['#8ec5f0', '#e8f3fa'],
    // = valeurs par défaut du store
    settings: {
      ambientIntensity: 1.3,
      ambientColor: '#fffaed',
      directionalIntensity: 1.8,
      directionalColor: '#fffaed',
      directionalPosition: [12, 16, 10],
      backgroundColor: '#b8d4f1',
      fogColor: '#d0e5f5',
      fogNear: 30,
      fogFar: 60,
      skySunPosition: [100, 20, 100],
      skyTurbidity: 8,
      skyRayleigh: 1.2,
    },
  },
  {
    id: 'morning',
    label: 'Morning',
    swatch: ['#b9d3ee', '#f7d9bd'],
    settings: {
      ambientIntensity: 1.05,
      ambientColor: '#ffeedd',
      directionalIntensity: 1.6,
      directionalColor: '#ffd6ad',
      directionalPosition: [16, 8, -6],
      backgroundColor: '#f0d8c4',
      fogColor: '#f3e0cf',
      fogNear: 28,
      fogFar: 58,
      skySunPosition: [100, 9, -40],
      skyTurbidity: 6,
      skyRayleigh: 2,
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatch: ['#6d78b8', '#f59a62'],
    settings: {
      ambientIntensity: 0.85,
      ambientColor: '#ffd9c2',
      directionalIntensity: 1.7,
      directionalColor: '#ff9d5c',
      directionalPosition: [-14, 5, 8],
      backgroundColor: '#e9a37c',
      fogColor: '#efb48f',
      fogNear: 26,
      fogFar: 55,
      skySunPosition: [-100, 3, 50],
      skyTurbidity: 10,
      skyRayleigh: 3,
    },
  },
  {
    id: 'mist',
    label: 'Mist',
    swatch: ['#c9d3da', '#eef1f3'],
    settings: {
      ambientIntensity: 1.45,
      ambientColor: '#eef2f5',
      directionalIntensity: 0.9,
      directionalColor: '#f4f6f8',
      directionalPosition: [6, 18, 8],
      backgroundColor: '#dfe6ea',
      fogColor: '#dfe6ea',
      fogNear: 12,
      fogFar: 38,
      skySunPosition: [40, 30, 60],
      skyTurbidity: 20,
      skyRayleigh: 0.8,
    },
  },
  {
    id: 'night',
    label: 'Night',
    swatch: ['#0e1430', '#34406e'],
    settings: {
      ambientIntensity: 0.4,
      ambientColor: '#8fa3d9',
      directionalIntensity: 0.55,
      directionalColor: '#b8c8ff',
      directionalPosition: [-8, 14, -10],
      backgroundColor: '#141b33',
      fogColor: '#1b2440',
      fogNear: 25,
      fogFar: 55,
      skySunPosition: [0, -10, -100],
      skyTurbidity: 2,
      skyRayleigh: 0.5,
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
