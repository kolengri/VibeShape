---
name: vibeshape-verify-scope
description: Select and run the smallest correct deterministic verification scope for VibeShape changes. Use after edits, before reporting completion, when resolving CI failures, or when deciding which Bun workspace needs formatting, Biome lint, TypeScript typecheck, tests, production build, browser checks, documentation validation, or license checks.
---

# VibeShape Verify Scope

## Map Changes to Owners

1. Map every edited path to its `apps/<name>` or `packages/<name>` workspace and inspect that workspace's scripts.
2. Include downstream consumers when a public export, protocol, schema, generated type, token, or file format changed.
3. Prefer focused checks while iterating; run the full relevant gates before merge.
4. Re-run the same checks after fixes until they pass.

## Minimum Matrix

| Changed area | Minimum verification |
|---|---|
| Markdown or project skills only | English-language scan, local-link check, whitespace/diff check, skill validation when applicable |
| TypeScript or TSX | Biome check, owning-workspace typecheck, focused tests |
| CSS or tokens only | Biome check, production Vite build, both-theme visual review |
| Domain or public package API | Owning and consumer typechecks plus unit/property tests |
| Worker protocol | UI and worker typechecks, schema/contract tests, real worker smoke test |
| Geometry, solver, topology | Fixture corpus, property matrix, memory check, affected browser smoke tests |
| Persistence or native format | Migration/round-trip/recovery/corruption tests and old fixture corpus |
| STEP, STL, or 3MF | Format tests and independent interoperability checks |
| Vite, Tailwind, PWA, or assets | Production build, worker/WASM loading, offline/service-worker smoke test |
| Dependencies or lockfile | `bun ci`, audit, licenses/SBOM impact, affected build/typecheck/tests |

## Expected Commands After Scaffolding

Inspect `package.json` rather than assuming a script exists. The root contract should expose equivalents of:

```text
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

For one workspace, use its `--cwd` scripts or Bun workspace filter. Use path arguments to scope Biome from the repository root.

## Do Not

- Do not claim a check passed when it was not run.
- Do not run a monorepo-wide typecheck for Markdown-only work merely by habit.
- Do not stop at typecheck when runtime, geometry, browser, storage, or format behavior changed.
- Do not treat a successful Vite build as proof that WASM ownership, memory, or geometry results are correct.
- Do not hide unavailable tools or skipped external interoperability checks.

Report the exact commands, outcomes, and any unverified release gate.
