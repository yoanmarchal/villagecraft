import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react'
import path from 'node:path';

export default defineConfig({
  base: '/villagecraft/',
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [react()],
});