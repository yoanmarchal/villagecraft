# Tooling

Lint, formatting and CI details. The commands and the rules every task needs are in [AGENTS.md](../AGENTS.md).

- `npm run dev` — start Vite dev server
- `npm run build` — `tsc -b && vite build` (build fails on type errors)
- `npm run typecheck` — `tsc -b --pretty false`
- `npm test` — Vitest (`vitest run`); tests live next to the code as `*.test.ts` (grid logic, cell utils, `buildVillage`). `npm run test:watch` for watch mode.
- `npm run lint` — oxlint (`--deny-warnings`), config [.oxlintrc.json](../.oxlintrc.json): migrated from the former ESLint setup (`@eslint/js` + `typescript-eslint` recommended + `eslint-plugin-react-hooks` recommended, React Compiler rules such as `set-state-in-effect` included — oxlint has them natively as `react/*`). ESLint was dropped because `typescript-eslint` blocked TypeScript 7; oxlint doesn't use the `typescript` package. The lint is **type-aware** (`options.typeAware`, via `oxlint-tsgolint`, built on TypeScript 7): the `typescript-eslint` `recommended-type-checked` rules (`no-floating-promises`, `no-unsafe-*`, `no-unnecessary-type-assertion`…). Beware `oxlint --fix`: tsgolint flagged `` `${a ? 'front' : 'back'}${…}` as keyof … `` as unnecessary while `tsc` needs it — use `as const` there. Fix findings rather than disabling rules; a justified `eslint-disable-next-line` with a comment is acceptable — oxlint honours it (see `renderTick` in `App.tsx`).
- `npm run fmt` / `npm run fmt:check` — oxfmt (Prettier-compatible), config [.oxfmtrc.json](../.oxfmtrc.json): single quotes, 120 columns; `spec.md` is excluded (plain text that oxfmt would turn into lists). Format before committing — CI fails otherwise. Line endings are LF everywhere (`.gitattributes`), Windows included, so `fmt:check` passes locally. The bulk reformat commit is listed in `.git-blame-ignore-revs` (`git config blame.ignoreRevsFile .git-blame-ignore-revs`).
- CI: [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs format check, lint, typecheck, tests and build on pushes to `dev` and on PRs; the Pages deploy (`deploy.yml`, on `main`) runs lint + tests before building. Node 22.
