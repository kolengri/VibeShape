# ADR-0018: Deterministic sketch profile extraction

- Status: Accepted
- Date: 2026-08-09

## Context

Extrude, pocket, revolve, region fill, and profile selection need bounded regions derived from solved analytical sketch geometry. A solver result alone contains coordinates and radii, not planar topology. Treating entity order, native handles, sampled polylines, or a transient loop number as persistent design intent would make results unstable across replay, worker replacement, and parameter edits.

General planar arrangements also require splitting entities at interior intersections. Silently guessing around unsplit crossings, overlapping entities, invalid solves, or open chains can select the wrong material region and create an incorrect solid.

## Decision

Run a pure deterministic profile extractor in `@vibeshape/sketch-solver` after every `fully-constrained` or `under-constrained` production solve. The extractor consumes only the semantic sketch and stable-ID solved point and circle values. An `over-constrained` or `failed` solve returns no profiles and an `invalid-solution` diagnostic.

The initial schema-version-0 extractor:

- ignores construction curves;
- supports line segments, circular arcs, and circles;
- sorts curves by stable entity ID, snaps compatible endpoints with a `1e-7 mm` tolerance, builds a planar half-edge graph, and extracts positive bounded faces;
- computes line, arc, and circle area and perimeter analytically while using bounded sampling only for containment and presentation bounds;
- determines deterministic parent/depth nesting, outer loops, holes, and islands;
- reports missing or degenerate solved values, coincident or overlapping entities, unsplit interior intersections, and open chains instead of guessing;
- caps one extraction at 2,000 non-construction curves and 2,000 diagnostics, with at most 64 stable entity IDs attached to one diagnostic;
- emits only serializable derived data: transient output indices, analytical source segments, stable source entity IDs, bounds, area, perimeter, nesting, and diagnostics.

Document protocol version 5 carries the result through an independent strict Zod schema. The protocol rejects non-finite values, invalid bounds, forward parent references, broken loop references, unknown fields, and oversized arrays.

`loopIndex` and `profileIndex` are response-local ordering aids. They MUST NOT be stored as persistent model references. Domain selector schema v0 instead stores the owning stable `SketchId`, one canonical sorted outer-boundary entity-ID set, and canonical sorted hole-boundary entity-ID sets. The pure resolver matches those sets against the latest result and returns `resolved`, `missing`, or `ambiguous`; it never falls back to a transient index. A future sketch-driven feature persists this selector as its profile intent.

The initial extractor deliberately does not split curves at interior intersections. Every affected curve is excluded and receives an `intersecting-entities` diagnostic. Interior splitting, feature integration of the selector, OCCT wire/face construction, and interactive fill are separate increments with their own invariant tests.

## Consequences

- Variable-driven dimensions can now produce deterministic closed regions without exposing SolveSpace or OCCT handles.
- Worker replacement and entity-array reordering produce the same profile result for the same stable solved geometry.
- A malformed or ambiguous sketch cannot block the worker or become an authoritative feature input.
- Shapes that rely on crossing entities remain unsupported until the arrangement splitter is implemented.
- Profile indices are intentionally disposable; the stable boundary selector is ready for a sketch-driven feature to persist before extrusion is evaluated.

## Rejected alternatives

- **Build profiles inside OCCT first:** couples planar topology discovery to native lifetime and makes diagnostics and deterministic tests harder to isolate.
- **Convert every entity to a polyline:** loses analytical area and perimeter, introduces tessellation-dependent topology, and cannot be the semantic boundary for exact modeling.
- **Persist the detected loop number:** changes when unrelated loops are added, removed, or reordered.
- **Guess through intersections and overlaps:** risks selecting or extruding the wrong region.
- **Implement the complete arrangement splitter in the first increment:** broadens the correctness surface before endpoint-connected analytical loops, nesting, limits, and failure behavior are proven.
