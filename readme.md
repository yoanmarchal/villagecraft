# VillageCraft

An interactive 3D voxel village builder in the browser. Click a grid cell to place a block, and the scene automatically figures out the right shape — wall, roof, arch, window, tower — based on what's around it.

**Live demo:** https://yoanmarchal.github.io/villagecraft/

## Controls

- **Left click** (or tap) a cell: add a block — or remove the top block when the **Demolish** tool is selected
- **Right click** a column: remove its top block
- **Mouse drag / scroll** (or drag / pinch): orbit and zoom the camera
- **Ctrl+Z / Ctrl+Y** (or Ctrl+Shift+Z): undo / redo
- **Ctrl+O**: show/hide the advanced settings panel

The toolbar at the bottom of the screen has the Build/Demolish tools, undo/redo, random generation, clear, preset ambiences (day, morning, sunset, mist, night — windows light up in the evening), a share-link button, a PNG screenshot button and the help card. On first launch a small random village is generated so you don't start from an empty grid. Grids go up to 12×12; **Generate** builds a procedural village (noise-based clusters of houses with streets and a few towers).

Your village is saved in the browser automatically and restored on reload. The advanced settings panel (Tweakpane, collapsed by default) lets you tweak lighting, sky/fog, camera, post-processing, materials, decorations, roof shape, and wall/tower geometry live, and persists your changes between sessions. Share links encode the whole village in the URL — opening one loads that village, asking first if it would replace yours. **Reset to Defaults** (in the panel's Actions section) restores every setting.

## Tech stack

- [Vite](https://vite.dev/) + [React](https://react.dev/) + TypeScript
- [Three.js](https://threejs.org/) via [`@react-three/fiber`](https://github.com/pmndrs/react-three-fiber) and [`@react-three/drei`](https://github.com/pmndrs/drei)
- [`@react-three/postprocessing`](https://github.com/pmndrs/react-postprocessing) for bloom/vignette/noise, and [N8AO](https://github.com/N8python/n8ao) ambient occlusion (loaded on demand)
- [Tweakpane](https://tweakpane.github.io/docs/) for the control panel
- [Zustand](https://github.com/pmndrs/zustand) for state

## Getting started

```bash
npm install
npm run dev        # start the dev server
npm run build       # type-check and build to dist/
npm run typecheck   # type-check only
npm run preview      # preview the production build locally
npm test            # run the Vitest suite
npm run lint        # ESLint
```

CI (GitHub Actions) runs lint, type-check, tests and build on every push to `dev` and on pull requests.

## Deployment

Pushing to `main` triggers a GitHub Actions workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) that builds the app and publishes `dist/` to GitHub Pages.

## Architecture

See [AGENTS.md](AGENTS.md) for the grid/procedural-generation model, the static-mesh rendering pipeline, and the control-panel module structure. See [spec.md](spec.md) for the original functional spec (French).
