# ADR-0105: Native TypeScript and dependency-aware typecheck caching

Status: Accepted

CI archive distribution is superseded by [ADR-0123](0123-parallel-ci-and-reusable-test-inputs.md).

## Context

The repository already pins TypeScript 7.0.2 and uses its native compiler.
The complete typecheck still repeats work for production, test, worker, Vite,
and root script configurations. Repeated runs recheck unchanged workspace
sources and their dependencies without incremental state or result caching.

## Decision

Retain TypeScript 7.0.2 directly as the root development dependency, verified
as the latest stable release on 2026-10-08. Its `tsc`
command runs the native Go compiler; existing JavaScript tooling uses the
package's supported API exports. Keep explicit Bun invocation of the CLI
wrapper and preserve every existing compiler configuration and strictness rule.

Enable incremental checking in the shared base configuration. Each configuration
uses its own default `.tsbuildinfo` filename, keeping production, test, and worker
state separate. Build information is ignored by Git and restored independently
in CI. It accelerates compilation; it does not authorize skipping a check.

Run typechecks through Turbo with two concurrent workspace tasks. Build the
cache graph from all workspace dependency fields, including peers, development
dependencies, optional dependencies, and cycles. Command-free source leaves
include every dependency's inputs without requiring cyclic task execution.
The root scripts task conservatively depends on every workspace source leaf.
Malformed manifests or missing workspace dependencies fail the launcher.

Turbo validates each successful result against its source and dependency hashes.
Root manifests, the lockfile, shared compiler configurations, root scripts,
unit-test support, CI configuration, and relevant runtime environment values
invalidate cached results. Include Bun's version, platform, and architecture
in the runtime fingerprint. Use only the local Turbo cache; GitHub Actions
archives distribute it between compatible runs without a separate cache service.
Disable Turbo's automatic agent-guidance maintenance so running typechecks
does not append instructions to the repository's `AGENTS.md`.

CI restores result archives and incremental state separately, with OS,
architecture, dependency, and compiler-configuration compatibility keys.
Older archives may be restored, but Turbo still validates each individual task
before reusing its result. Preserve all existing CI gates and runner selection.

## Consequences

- First runs still perform complete checking. Warm runs can reuse unchanged
  tasks, and dependency changes invalidate their consumers.
- Dirty and untracked source edits remain validation inputs; a stale successful
  result must never hide a type error.
- Compiler upgrades, shared configuration changes, and cross-architecture runs
  cannot reuse incompatible results.
- Typecheck caching does not cache unit, WASM, workerd, or browser tests.
- Report measured cold and warm durations separately; do not compare different
  hosts as if they were a matched benchmark.

## Validation

On the development Mac, a clean result cache and cleared compiler build info
produced 23 successful executable tasks in 28.894 seconds. An immediate repeat
reused all 23 results in 0.082 seconds. This is a cold/warm comparison on the
same source, host, and two-workspace concurrency setting, not a comparison
against the previous compiler or a claim about GitHub-hosted duration.

Eight native tests with 55 assertions exercise real Turbo cache behavior,
including transitive and cyclic dependency changes, peer/development/optional
dependencies, dirty and untracked files, unrelated workspace reuse, incremental
output restoration, root support/lockfile/config invalidation, and failure
non-reuse. Agent-session checks also preserve existing `AGENTS.md`, prevent
automatic creation when absent, and retain the disabled guidance setting in
generated configuration. All 46 workerd integration tests and the browser build also passed
with TypeScript 7.0.2 installed directly.
