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
      output: {
        // Dépendances lourdes et stables dans leurs propres chunks : elles
        // restent en cache navigateur quand seul le code de l'app change.
        codeSplitting: {
          groups: [
            { name: 'three', test: vendor('three', 'three-stdlib') },
            { name: 'react', test: vendor('react', 'react-dom', 'scheduler', 'zustand') },
            { name: 'r3f', test: vendor('@react-three', 'postprocessing', 'maath', 'camera-controls') },
            { name: 'tweakpane', test: vendor('tweakpane', '@tweakpane') },
          ],
        },
      },
    },
    // three seul pèse ~700 kB minifié : l'avertissement par défaut (500 kB) n'apporte rien.
    chunkSizeWarningLimit: 800,
  },
});
