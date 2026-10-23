# ADR 0129: Revision-scoped assembly inspection

- Status: Accepted
- Date: 2026-10-23
- Supersedes: the per-pose worker/source rebuild policy in [ADR 0113](0113-assembly-motion-studies.md)

## Decision

The document controller owns one serialized assembly inspection worker for its current authored
project and revision. Switching geometry workspaces can reuse that worker. A revision change,
project close, request cancellation or worker failure releases it. Cancelled queued requests never
terminate an unrelated active request, and results from a released ownership epoch cannot publish.
The inspection hook aborts unfinished work on revision changes and unmount.

The worker reuses the existing bounded `AssemblyMaterializationCache` for display inspections.
Cache keys include frozen semantic input, mesh policy and engine environment. The cache retains
only verified derived buffers, within its existing 4096-node and 64 MiB limits. Every pose still
solves the exact constraints and transforms the verified source geometry. No authored command,
solver approximation or persisted cache is introduced.

Native aliases remain disposable after every operation. Exact interference and export rebuild
their own native sources instead of consuming display-only cache entries. Document disposal or a
different request document/revision/generation clears the worker's assembly cache. Existing worker
wire schemas, MCP contracts, study sample budgets and manual pose Apply semantics remain intact.

## Consequences

- Distinct playback samples reuse WASM initialization and frozen feature rebuilds.
- Leaving a workspace cancels unfinished inspection instead of only ignoring its eventual result.
- A completed inspection worker can stay resident until the document revision or project changes.
- Tests cover worker reuse/replacement, queued cancellation, stale epochs, real cached geometry,
  exact interference after a cache hit, and browser playback without new geometry workers.
