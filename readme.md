# VillageCraft

An interactive 3D voxel village builder in the browser. Click a grid cell to place a block, and the scene automatically figures out the right shape — wall, roof, arch, window, tower — based on what's around it.

**Live demo:** https://yoanmarchal.github.io/villagecraft/

## Controls

- **Left click** a cell: add a block
- **Right click** a column: remove its top block
- **Mouse drag / scroll**: orbit and zoom the camera
- **Backtick (`` ` ``)**: show/hide the control panel

The control panel (Tweakpane) lets you tweak lighting, sky/fog, camera, post-processing, materials, decorations, roof shape, and wall/tower geometry live, and persists your changes between sessions. The **Actions** section has buttons to clear the grid, generate a random terrain, and reset every setting back to its default.

## Tech stack

- [Vite](https://vite.dev/) + [React](https://react.dev/) + TypeScript
- [Three.js](https://threejs.org/) via [`@react-three/fiber`](https://github.com/pmndrs/react-three-fiber), [`@react-three/drei`](https://github.com/pmndrs/drei) and [`@react-three/csg`](https://github.com/pmndrs/react-three-csg)
- [`@react-three/postprocessing`](https://github.com/pmndrs/react-postprocessing) for bloom/vignette/noise
- [Tweakpane](https://tweakpane.github.io/docs/) for the control panel
- [Zustand](https://github.com/pmndrs/zustand) for state

## Getting started

```bash
npm install
npm run dev        # start the dev server
npm run build       # type-check and build to dist/
npm run typecheck   # type-check only
npm run preview      # preview the production build locally
```

There is no test suite or lint config yet.

## Deployment

Pushing to `main` triggers a GitHub Actions workflow ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) that builds the app and publishes `dist/` to GitHub Pages.

## Architecture

See [AGENTS.md](AGENTS.md) for the grid/procedural-generation model, the static-mesh rendering pipeline, and the control-panel module structure. See [spec.md](spec.md) for the original functional spec (French).
