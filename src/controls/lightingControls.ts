import type { Pane } from 'tweakpane';
import { registerStoreFolder } from './storeFolder';

export const registerLightingControls = (pane: Pane) =>
  registerStoreFolder(pane, {
    title: 'Lighting',
    fields: [
      ['ambientIntensity', { min: 0, max: 5, step: 0.05 }],
      ['ambientColor'],
      ['directionalIntensity', { min: 0, max: 5, step: 0.05 }],
      ['directionalColor'],
      [
        'directionalPosition',
        {
          label: 'sun position',
          x: { min: -50, max: 50, step: 0.5 },
          y: { min: -50, max: 50, step: 0.5 },
          z: { min: -50, max: 50, step: 0.5 },
        },
      ],
      ['shadowMapSize', { min: 256, max: 4096, step: 256 }],
      ['shadowRadius', { min: 0, max: 10, step: 0.5 }],
      ['shadowBias', { min: -0.01, max: 0.01, step: 0.0001 }],
      ['windowGlow', { label: 'window glow', min: 0, max: 1, step: 0.01 }],
    ],
  });
