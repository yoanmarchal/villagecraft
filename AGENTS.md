# Project Guidelines

VillageCraft — a Vite + React + TypeScript app that procedurally generates a 3D voxel village using Three.js (`@react-three/fiber`, `@react-three/drei`, `@react-three/csg`). See [spec.md](spec.md) for the original functional spec (French).

## Build and Test

- `npm run dev` — start Vite dev server
- `npm run build` — `tsc -b && vite build` (build fails on type errors)
- `npm run typecheck` — `tsc -b --pretty false`
- No test suite and no lint config exist yet — don't invent references to them.

## Architecture

- **Grid state & procedural generation**: [src/villageGrid.ts](src/villageGrid.ts) owns the 3D `GridCell[][][]` and `recomputeProceduralLogic()`, which assigns each cell's `BlockType` (`Empty`, `Foundation`, `Wall`, `WallWithWindow`, `Roof`, `Arch`) by inspecting neighbours. **Always go through this recompute after any grid mutation** — never patch `cell.type` directly.
- **Neighbour/shape queries**: [src/utils/cellUtils.ts](src/utils/cellUtils.ts) — always query neighbours via `getCell()`/`hasOccupiedCell()` on a `CellLookup`, never index the raw grid array directly. The lookup is rebuilt per recompute; don't cache it across mutations.
- **Property inheritance**: [src/propertyInheritanceSystem.ts](src/propertyInheritanceSystem.ts) assigns deterministic building IDs, per-cell color variation, and `mergeFlags` (quoins/trim/cornice suppression) — building-level, not per-cell hardcoded.
- **Rendering pipeline (static merge)**: cells are NOT rendered as individual React meshes. Each `BlockType` has a pure *parts builder* in `src/render/cells/` (`standardCellParts`, `wallWindowCellParts`, `roofCellParts`, `archCellParts`) that returns `Part[]` — { cached geometry, local matrix, color, material spec } (see [src/render/parts.ts](src/render/parts.ts)). [src/render/buildVillage.ts](src/render/buildVillage.ts) computes one `CellContext` per cell (exposed faces, corner radii, isolation), dispatches to the builder, groups parts by material key and merges each group into a single vertex-colored BufferGeometry → ~10 draw calls for the whole village. [src/components/VillageMeshes.tsx](src/components/VillageMeshes.tsx) memoizes the merge on `cells` and disposes replaced geometries. Rebuild happens only on grid mutations, never per frame.
- **Geometry cache**: [src/render/geometryCache.ts](src/render/geometryCache.ts) — every geometry (box, rounded box, cylinder, extruded cell contour, window frame-with-hole, gable…) is built once per parameter combination and shared. Never mutate a cached geometry; the merge copies its attributes. Window frames use a shape-with-hole extrusion, not runtime CSG.
- **Scene/interaction**: [src/components/VoxelScene.tsx](src/components/VoxelScene.tsx) (R3F canvas, OrbitControls, click-to-add/remove on the ground plane), reading scene/lighting/postFX values from [src/store/controlStore.ts](src/store/controlStore.ts). `App.tsx` memoizes `cells` on the render tick so pointer-move re-renders never trigger a merge rebuild.
- **Control panel**: [src/components/TweakpanePanel.tsx](src/components/TweakpanePanel.tsx) owns the Tweakpane `Pane` lifecycle and composes one `register*Controls(pane)` module per domain from `src/controls/` (grid, lighting, sky/fog, camera, post-FX, debug, actions) — each is a plain function (not a hook/component) that binds Tweakpane to a local mirror of a `src/store/controlStore.ts` slice and returns a disposer. Add a new control domain by adding one new module file + one line in `TweakpanePanel.tsx`'s `disposers` array. The imperative `VillageGrid` instance is bridged to the Actions module via [src/store/gridControllerStore.ts](src/store/gridControllerStore.ts) (non-persisted) rather than prop-drilled.
- **Decorations & protected zones**: [src/config/protectedAreasConfig.ts](src/config/protectedAreasConfig.ts) defines window/door/arrow-slit exclusion zones; [src/render/cells/stoneParts.ts](src/render/cells/stoneParts.ts) and [src/render/cells/decorations.ts](src/render/cells/decorations.ts) must respect these zones when placing decorative stone/quoins — the `isInProtectedZone` callback stays per-cell-type, don't centralize that logic.

## Conventions

- **Adding a new `BlockType`**: add the enum value in [src/types.ts](src/types.ts), create a parts builder under `src/render/cells/` (return `Part[]` with cell-local matrices; use `geometryCache` helpers), dispatch it in `buildVillage.ts`, and extend `recomputeProceduralLogic()` in `villageGrid.ts` to assign it.
- **Tower propagation is intentional**: `isTowerColumn()` in `cellUtils.ts` propagates upward — if a block is isolated (no horizontal neighbours), all blocks below it in the column become cylindrical too. Don't simplify this to a per-block check; it's what makes towers look right. `isIsolatedBlock()` (used for roofs) is a separate, non-propagating check — this asymmetry is deliberate.
- **Colors**: `src/colorPalettes.ts` groups cells into 2×2 "buildings" via `getBuildingId(x, z, gridWidth)` and applies deterministic seeded color variation — don't assign random colors per cell.
- **Terrain generation** (`generateTerrain()` in `villageGrid.ts`) currently only produces a flat single-layer grid; the seeded Perlin noise generator exists but is unused.
