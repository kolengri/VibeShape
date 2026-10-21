# ADR-0123: Parallel CI and reusable test inputs

Status: Accepted

Date: 2026-10-21

Supersedes the CI scheduling/archive decisions in [ADR-0105](0105-native-typescript-cache.md)
and the scheduling and selected shared-input decisions in
[ADR-0106](0106-ci-unit-test-cache-and-preflight.md). Their other guarantees remain.

## Context

Four successful hosted CI runs on 2026-10-21 spent 608–829 seconds in the unit-test
step. A 889-second run spent 800 seconds there. Its restored unit archive produced
28 misses and no hits; the heavy uncacheable Node batch took 568 seconds and the
uncacheable DOM batch took another 167 seconds. The 34 quick-WASM cases accounted
for 556 seconds of summed test duration. These are observed historical runs, not a
controlled before/after benchmark.

The public repository uses standard four-CPU Ubuntu runners, while the workflow
limited hosted tests to two workers. File-level Bun parallelism cannot subdivide
one expensive test file. The dependency analyzer also treated erased `Worker`
annotations as executable references, making the structural workspace uncacheable.

## Decision

Run static/integration checks and complete Node/DOM unit groups in independent
jobs. Use `os.availableParallelism()` for both hosted and self-hosted tests. Keep
the existing trusted-PR fallback-runner policy. Retain `Fast PR checks` as an
aggregate which always evaluates every required job result and succeeds only when
all succeed. The reusable workflow, deployment preflight, and verified-main
publication requirements remain intact.

`bun run test --group=node` and `--group=dom` each select a complete environment
corpus; omitted selection retains the local sequential run. Partial filters,
reporters, and unknown options still bypass caching. Each group snapshots and
validates its actual test entries and uses a separate immutable CI archive key.
Group selection does not permit one group's receipt to skip another group.
Each group restores and saves its archive explicitly, preserving successful
receipts even when another scope fails. Cancelled jobs do not save archives;
failed scopes still execute on the next run.

Split the quick-WASM corpus into cohesive files with isolated mutable Pyodide
runtimes. Preserve every scenario, parameter, assertion, timeout, and resource
receipt. Share fixture/runtime helpers and keep report writers independent.
Publish prepared assets and their metadata through atomic rename so simultaneous
suite preparation cannot expose truncated files and needs no persistent lock.

Ignore erased TypeScript type syntax during executable-boundary analysis, while
still visiting class heritage expressions. Hash every reached source/file input
in addition to workspace closures. Unrelated documentation is no longer a global
invalidation input; imported or read documentation still invalidates its consumers.
Exclude generated `artifacts/` outputs from inputs, and fail closed if a selected
test depends on those excluded contents.

Keep reviewed source pins for computed runtime loaders. The exact chamfer fixture
may use its installed OCCT loader only when the external-kernel environment
override is absent. External overrides and edited loaders remain uncacheable.
Report uncacheable source/dependency reasons separately from missing receipts,
without printing environment values. Existing runtime, installation-content,
platform, options, environment, failure, and atomic-publication rules remain.

Transport Turbo results and incremental outputs through one archive. Turbo's
declared outputs already restore successful compiler state. Remove the second
standalone build-info archive; a task without a reusable result still runs its
compiler normally.

## Consequences

- Independent jobs overlap Node, DOM, and static/integration work, with extra
  dependency installations and runner minutes.
- More workers and isolated Pyodide instances increase peak memory. Preserve the
  memory fixture and distinguish resource checks from throughput measurements.
- Warm compatible runs can reuse expensive structural/geometry results, but
  unsupported external inputs must still execute.
- Source pins retain an explicit review/maintenance cost after fixture edits.
- Record actual CI durations after publication. Local timings on a different
  machine are not a matched comparison with historical hosted runs.
