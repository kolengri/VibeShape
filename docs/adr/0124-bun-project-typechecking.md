# ADR-0124: Bun project typechecking with cached workspace results

Status: Accepted

Date: 2026-10-21

Supersedes the compiler and incremental-output decisions in
[ADR-0105](0105-native-typescript-cache.md). Its dependency graph, strict environment,
failure non-reuse and agent-guidance guarantees remain. The parallel verification
and independent native-test receipts in [ADR-0123](0123-parallel-ci-and-reusable-test-inputs.md)
also remain.

## Context

Bun 1.4.3 includes a built-in TypeScript checker based on TypeScript 7 semantics.
All 53 existing project configurations passed a direct checker evaluation without
changing their include/exclude patterns, strict options or environment presets.
A single local comparison of the web production project measured 0.682 seconds
for Bun against 3.567 seconds for the installed native TypeScript 7.0.2 compiler,
with approximately 76% lower reported peak RSS. Both used cold compiler state and
warm filesystem caches; this does not establish hosted speed or universal
diagnostic equivalence.

The installed stable CLI lets a package's `check` script shadow its built-in
checker. Current online documentation describes `--no-script`, but 1.4.3 rejects
that flag. The root `check` script must retain the complete verification contract.

## Decision

Run each existing configuration through Bun's built-in checker, keeping the same
26 executable workspace/root tasks and all 53 explicit configuration paths.
Retain separate browser, worker, library, test, Vite, desktop and root-script
options. Do not replace the corpus with a root scan or entry-point checking.

Use `scripts/check-types.ts` as a small CLI adapter. It resolves project paths
before starting children in an isolated temporary package with no `check` script.
Absolute `-p` paths preserve the original configuration and dependency resolution
while avoiding package-script dispatch and unsupported bypass flags. Projects
run sequentially within each task and stop at the first failure; temporary files
are removed after completion or a child error.

Keep `bun run typecheck` and the existing validated Turbo options. Turbo still
hashes source and dependency closures, dirty/untracked files, compiler settings,
root scripts and relevant environment inputs before reusing successful results.
Include Bun's revision as well as version, platform and architecture in the
compiler runtime fingerprint. Failed checks remain uncached.
`--force` disables local cache reads while retaining successful writes, without
enabling remote transport or combining incompatible Turbo flags.

Bun checks do not emit `.tsbuildinfo` or declarations. Declare no generated
typecheck outputs and transport validated task results in the existing Turbo
archive, with a new compiler compatibility namespace. Existing incremental
configuration remains available for explicit native TypeScript diagnostics; Bun
does not use its old build-info files.

Retain TypeScript 7.0.2 as a development dependency for the supported async/parser
APIs used by the unit-test input analyzer. Retain Biome formatting, linting and
icon verification. The stable Bun release has no built-in linter. Explicitly run
the site's Vite commands through Bun, matching the browser app's existing runtime
choice. Cloudflare's Node CLI/workerd and Electron retain their required engines.

## Verification and consequences

- Run the full project corpus and verify a subsequent unchanged Turbo result hit.
- Test actual strict optional/indexed-access failures, browser/worker ambient
  separation, missing projects, script-shadowing with spaced paths, no generated
  compiler state and failure short-circuiting.
- Preserve the existing transitive/cyclic dependency, configuration, dirty-source,
  failure non-reuse and declared-output cache regressions.
- Every uncached Bun check starts from source. Warm acceleration comes from
  validated task results rather than compiler incremental state.
- Report local and hosted timings separately. A faster compiler does not itself
  repair cross-host native-test receipt misses or expensive geometry computation.

Primary references: [Bun 1.4.3](https://bun.com/blog/bun-v1.4.3) and
[checker documentation](https://bun.com/docs/runtime/check). Installed CLI probes
and repository tests determine which invocation is supported by the pinned release.
