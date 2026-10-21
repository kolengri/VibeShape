---
name: vibeshape-verify-scope
description: Select and run the smallest correct deterministic verification scope for VibeShape changes. Use after edits, before reporting completion, when resolving CI failures, or when deciding which Bun workspace needs formatting, Biome lint, TypeScript typecheck, tests, production build, browser checks, documentation validation, or license checks.
---

# VibeShape Verify Scope

## Establish the Check Environment

Before executable checks, run `bun run check:bun` to verify the repository's pinned runtime and confirm the affected workspace dependencies are installed. Reuse valid environment evidence within the task. For authorized implementation, prepare missing dependencies with the pinned Bun and `bun ci`, preserving the lockfile. For read-only review, report unavailable dependencies or a runtime mismatch instead of changing the environment automatically. An import/setup failure is not an executed regression assertion.

## Map Changes to Owners

1. Map every edited path to its `apps/<name>` or `packages/<name>` workspace and inspect that workspace's scripts.
2. Include downstream consumers when a public export, protocol, schema, generated type, token, or file format changed.
3. Use existing import/export evidence (for example, Fallow inspect) to identify candidate consumer checks. Account separately for dynamic, generated, external, worker, and WASM boundaries; graph absence cannot waive a required gate.
4. Prefer focused checks while iterating; run the full relevant gates before merge.
5. Re-run affected checks after fixes. Reuse a passing result only while relevant source, dependencies, configuration, and environment are unchanged.

## Minimum Matrix

| Changed area | Minimum verification |
|---|---|
| Markdown or project skills only | English-language scan, local-link check, whitespace/diff check, skill validation when applicable |
| TypeScript or TSX | Biome check, owning-workspace typecheck, focused tests |
| CSS or tokens only | Biome check, production Vite build, both-theme visual review |
| Domain or public package API | Owning and consumer typechecks plus unit/property tests |
| MCP tool/resource contract or behavior available to agents | Focused schema/adapter checks and the operator contract check below |
| Worker protocol | UI and worker typechecks, schema/contract tests, real worker smoke test |
| Geometry, solver, topology | Fixture corpus, property matrix, memory check, affected browser smoke tests |
| Persistence or native format | Migration/round-trip/recovery/corruption tests and old fixture corpus |
| STEP, STL, or 3MF | Format tests and independent interoperability checks |
| Vite, Tailwind, PWA, or assets | Production build, worker/WASM loading, offline/service-worker smoke test |
| Dependencies or lockfile | `bun ci`, audit, licenses/SBOM impact, affected build/typecheck/tests |

## MCP Operator Contract Check

When an MCP tool/resource, exposed CAD behavior, or agent workflow changes, complete [MCP operator synchronization](../vibeshape-documentation-sync/SKILL.md#synchronize-mcp-operator-skills) before acceptance. Confirm the affected operator instructions describe the new behavior and local/remote availability, or record why existing instructions remain correct.

If operator Markdown changed, require its regenerated bundle and `bun run skills:validate` alongside the relevant runtime checks. If only developer instructions changed, use the Markdown/project-skill row. A passing stale-bundle check does not establish semantic coverage, and an unchanged bundled JSON file does not excuse a missing operator update.

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
