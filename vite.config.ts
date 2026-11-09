/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'

/**
 * Teste si un module appartient à l'un des `packages`, installé au premier
 * niveau de node_modules. r3f-perf (chargé à la demande) embarque ses propres
 * copies de drei/zustand dans un node_modules imbriqué : elles ne doivent pas
 * être aspirées dans les chunks chargés au démarrage.
 */
const vendor = (...packages: string[]) => (id: string) => {
  const parts = id.replace(/\\/g, '/').split('/node_modules/');
  if (parts.length !== 2) return false; // hors node_modules, ou imbriqué
  return packages.some((name) => parts[1].startsWith(`${name}/`));
};

export default defineConfig({
  base: '/villagecraft/',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [react()],
  build: {
    rolldownOptions: {
      treeshake: {
        // @react-three/postprocessing réexporte son effet N8AO, qui importe
        // `n8ao` ; ce paquet ne déclare pas `sideEffects: false`, donc l'import
        // restait dans le chunk "r3f" même inutilisé — et ~83 kB gzip étaient
        // préchargés et exécutés au démarrage. n8ao est un module unique sans
        // effet de bord : seul l'import dynamique d'AmbientOcclusion le charge.
        moduleSideEffects: [{ test: /[\\/]node_modules[\\/]n8ao[\\/]/, sideEffects: false }],
      },
      output: {
        // Dépendances lourdes et stables dans leurs propres chunks : elles
        // restent en cache navigateur quand seul le code de l'app change.
        codeSplitting: {
          groups: [
            { name: 'three', test: vendor('three', 'three-stdlib') },
            { name: 'react', test: vendor('react', 'react-dom', 'scheduler', 'zustand') },
            { name: 'r3f', test: vendor('@react-three', 'postprocessing', 'maath', 'camera-controls') },
            { name: 'tweakpane', test: vendor('tweakpane', '@tweakpane') },
            // Occlusion ambiante, chargée à la demande (AmbientOcclusion.tsx). Sans
            // groupe prioritaire, n8ao serait aspiré dans "r3f" comme dépendance
            // de @react-three/postprocessing, donc chargé au démarrage.
            { name: 'n8ao', test: vendor('n8ao'), priority: 10, includeDependenciesRecursively: false },
          ],
        },
      },
    },
    // three seul pèse ~700 kB minifié : l'avertissement par défaut (500 kB) n'apporte rien.
    chunkSizeWarningLimit: 800,
  },
  test: {
    // three-bvh-csg n'a pas de champ `exports` et son `main` est un build UMD
    // CommonJS, qui fait `require("three")` (THREE_CJS_DEPRECATED). Le build
    // navigateur prend son `module` (ESM) ; sous Vitest la résolution SSR prend
    // `main` : on pointe donc sur ce même point d'entrée ESM, et on fait traiter
    // le paquet par Vite (sans `"type": "module"`, Node lirait ses .js en CJS).
    alias: [{ find: /^three-bvh-csg$/, replacement: 'three-bvh-csg/src/index.js' }],
    server: {
      deps: {
        inline: ['three-bvh-csg'],
      },
    },
  },
});
