import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../vite.config.ts';

// Banc de mesure (`npm run perf`) : hors de `npm test`, qui n'inclut que les *.test.ts.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['perf/**/*.perf.ts'],
      testTimeout: 600_000,
      // Une seule exécution à la fois : les mesures ne se gênent pas.
      fileParallelism: false,
    },
  }),
);
