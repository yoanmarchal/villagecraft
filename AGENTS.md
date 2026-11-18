# Project Guidelines

VillageCraft — a Vite + React + TypeScript app that procedurally generates a 3D voxel village with Three.js (`@react-three/fiber`, `@react-three/drei`; `three-bvh-csg` for hollow wall shells). Functional spec (French): [spec.md](spec.md).

## Build and test

- `npm run dev` (Vite), `npm run build` (`tsc -b && vite build`, fails on type errors), `npm run typecheck`, `npm test` (Vitest; tests sit next to the code as `*.test.ts`; `npm run test:watch`); `npm run perf` measures build and click cost by grid size (`perf/`, not part of `npm test`).
- `npm run lint` — oxlint, type-aware, `--deny-warnings` ([.oxlintrc.json](.oxlintrc.json)). Fix findings rather than disabling rules; a justified `eslint-disable-next-line` with a comment is acceptable. `oxlint --fix` wrongly drops `` `${…}` as keyof … `` casts that `tsc` needs — use `as const` there.
- `npm run fmt` / `npm run fmt:check` — oxfmt ([.oxfmtrc.json](.oxfmtrc.json)): single quotes, 120 columns, LF everywhere. Format before committing: CI fails otherwise.
- CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs format check, lint, typecheck, tests and build on `dev` and on PRs; the Pages deploy (`deploy.yml`, on `main`) runs lint + tests first. Node 22.

## Core rules

- **Grid**: [src/villageGrid.ts](src/villageGrid.ts) owns the cells and reruns `recomputeProceduralLogic()` after any mutation — never patch `cell.type` directly. Then call `useGridControllerStore.getState().commit()` (undo snapshot + scene refresh), never the refresh callback. Keep the `import.meta.hot?.accept(() => window.location.reload())` line at the end of `villageGrid.ts`.
- **Neighbours**: query them through `getCell()` / `hasOccupiedCell()` on a `CellLookup` ([src/utils/cellUtils.ts](src/utils/cellUtils.ts)), never the raw grid array; the lookup is rebuilt per recompute, don't cache it across mutations.
- **Shape only**: procedural results depend on the shape of the village, never on click order (tested for windows and arches).
- **Builders are pure**: cells are not React meshes; each `BlockType` has a parts builder in `src/render/cells/` returning `Part[]`, merged per material by [src/render/buildVillage.ts](src/render/buildVillage.ts). Builders and `cellUtils` never read `useControlStore`: a new style value goes into the store slice, `RenderSettings` and `pickRenderSettings()`. Per-cell variation is deterministic (hash of coordinates), never `Math.random()`. The build runs in a Web Worker ([src/render/villageWorker.ts](src/render/villageWorker.ts)): nothing it imports may touch the DOM, React or a store.
- **Geometry**: every geometry comes from [src/render/geometryCache.ts](src/render/geometryCache.ts) and is shared — never mutate one. Keep small decorative parts cheap (a cell is ~1.8 k vertices). Parts are cached per building (`buildingSignature()`): a builder must not read cells outside its building and the ring around it. If `mergeParts` reads a new part field, add it to `hashParts`; the merged vertex format is also read by `growMaterial.ts` — change both together.
- **Flat path**: on flat ground `CellContext.groundAt` is null and builders must do exactly what they did before (most tests cover that path); never bake the building level into `toWorldPosition`.
- **Interiors are meant to be seen**: never hide or cull them. Parts lit by the room lamp are marked explicitly (`'room'` / `'shell'`, `asInterior()`), never guessed from position.
- **Shaders**: keep code that uses screen derivatives branch-free and NaN-free (one NaN pixel blacks out the frame through bloom); shader variants need distinct `customProgramCacheKey`s.
- **On-demand rendering**: the canvas uses `frameloop="demand"` — anything animated must keep calling `invalidate()`.
- **Persisted defaults**: a new default never reaches existing users by itself — bump the store `version` and extend `migrateControlState()` in [src/store/controlStore.ts](src/store/controlStore.ts) (tested).
- **Tests**: geometry tests intercept the real builders during `buildVillage` with `vi.mock` (see `furnitureParts.test.ts`).

## Do not reintroduce

User decisions and past bugs that no test guards — details in the linked docs.

- Stone relief stays real geometry: no shader bump or parallax for stones ([docs/exterior.md](docs/exterior.md)).
- No painted roof pattern: tiles and slates are geometry.
- Masonry beds must not run as straight lines (unequal courses, tall stones, `BED_SLACK`); joints as tight as possible (`MASONRY_JOINT`).
- Quoins: continuous chains at salient corners and grooves only; no trim strip on `Wall` cells.
- L stairs stay 0.3 wide (0.2 was too narrow) ([docs/interiors.md](docs/interiors.md)).
- Keep `ColorGrade` rather than `BrightnessContrast` + `HueSaturation`, and noise after tone mapping ([docs/rendering.md](docs/rendering.md)).
- Keep the `EffectComposer` key on the AO pass (Metal blit error) and `n8ao` out of the startup chunk.

## Where the rest lives

Read the file for the area you touch first: each one records how it works, and the approaches the user already rejected.

- [docs/tooling.md](docs/tooling.md) — lint setup, formatting, blame-ignore.
- [docs/rendering.md](docs/rendering.md) — rendering pipeline, chunk cache, render settings, geometry cache and vertex format, on-demand rendering, ambient occlusion and build chunks, sky, landscape, light, surface detail, post chain.
- [docs/exterior.md](docs/exterior.md) — stone facing, quoins, parapets and merlons, roofs and spires, joinery, openings.
- [docs/interiors.md](docs/interiors.md) — hollow blocks, rounded junctions, interior light, furniture, doors, fireplaces, stairs.
- [docs/terrain.md](docs/terrain.md) — sloping terrain, terrain shape, building levels, plinth.
- [docs/village-rules.md](docs/village-rules.md) — grid, `BlockType`s, towers, ramparts, roof ridges, arches, paving, windows, generation, grid size.
- [docs/app.md](docs/app.md) — grid controller and undo, share links, persistence, scene interaction and raycasting, loading screen, toolbar, control panel, the `window.villagecraft` API and the MCP server ([tools/mcp/](tools/mcp/README.md)).
- [docs/walk.md](docs/walk.md) — first-person walk mode: pure walker physics and collision world (`src/walk/`), pointer-lock controls, next steps (entering houses, stairs).
