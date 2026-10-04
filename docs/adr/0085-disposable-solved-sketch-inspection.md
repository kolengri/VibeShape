# ADR-0085: Disposable solved sketch inspection

- Status: Accepted
- Date: 2026-10-04

## Context

Authored sketch records describe intended entities and constraints, but their coordinates do not
establish the current solved positions, remaining freedom, conflicting constraints, or usable
profiles. An agent needs the same native SolveSpace evidence as the editor before choosing a
stable profile selector, including sketches created only in an owned automation draft.

## Decision

Register `org.vibeshape.sketch.solution` version 1 and expose named `model_sketch_solution` and
`draft_sketch_solution` reads through the shared local and paired remote tool vocabulary. The
caller supplies the exact document or draft revision and sketch ID. The result includes solver
status, degrees of freedom, maximum residual and pinned solver hashes, plus bounded pages of
solved points, circle radii, conflicting authored constraint IDs, stable profile selectors with
area/perimeter/bounds, or profile diagnostics. Units are millimeters and square millimeters.

The application rebuilds a detached snapshot in an isolated document worker to resolve variables,
planes and external support, then solves the requested sketch. It validates the worker envelope,
document, revision, generation and sketch identity, projects serializable evidence, and terminates
the worker before returning. Cancellation terminates immediately and discards late results. The
domain validates complete unique coverage of authored points/circles and ownership of constraint,
profile-boundary and diagnostic IDs. Fixed external solver bindings are excluded from the public
authored entity lists. Native handles, meshes, actor data and persistent worker state are absent.

Each active browser automation session retains at most one committed sketch catalog with a 4 MiB
serialized limit. Draft inspection reuses the existing single 4 MiB detached draft catalog, so a
different draft geometry target can evict it. Sections share one opaque inspection UUID; cursors
bind that UUID, section and bounded offset. A page contains at most 200 items and stays within
128 KiB. Cold, evicted, cross-section or stale cursors fail closed; restart with a null cursor.

The host checks draft ownership, expiry and committed base before and after asynchronous work.
The committed reader checks the active document and revision before and after solving. A cancel
or disposal epoch prevents late results from repopulating a cache. Reads neither save authored
coordinates nor advance revisions, renew draft expiry or authorize an automatic commit.

## Consequences

Agents can select native-derived stable profile boundaries and diagnose under-constrained or
conflicting sketches before one ordinary reviewed commit. A successful solved page does not
establish that a subsequent solid operation is valid; exact draft preview remains required.
Large catalogs and ambiguous/open profiles return diagnostics or explicit unavailable/budget
failures rather than invented usable profiles. Callers must not persist profile indices or reuse
inspection cursors after edits or catalog eviction.
