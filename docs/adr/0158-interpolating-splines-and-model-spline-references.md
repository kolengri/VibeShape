# ADR-0158: Interpolating sketch splines and non-analytical model-edge references

- Status: Accepted
- Date: 2026-11-11
- Extends: [ADR-0014](0014-solvespace-flat-wasm-solver.md), [ADR-0068](0068-exact-cubic-bezier-sketch-curves.md), [ADR-0027](0027-typed-orphan-model-reference-intent.md)

## Context

The sketch had one exact free-form curve: a single cubic Bezier placed by four control-point clicks.
Designers expect a Spline that passes through picked points and stays smooth while they edit it.
Separately, Use could project only analytical model edges (lines, circles, ellipses and their
arcs). Edges produced by extruding or sweeping Bezier sketches, imported B-splines and other
non-analytical OCCT curves could not be referenced, although they are common in shaped parts.

## Decision

### Spline representation and continuity

A spline is an ordinary chain of `cubic-bezier` entities. Consecutive segments share the
through-point entity: segment `i` ends at the point where segment `i + 1` starts, and a closed
spline ends at its first through-point. No new entity type is introduced, so profiles, Extrude,
Revolve, Sweep, Loft, rigid edits, persistence and export reuse the exact ADR-0068 Bezier path.

A new driving constraint, `tangent-join { incomingCurveId, outgoingCurveId }`, requires both
targets to be cubic Beziers whose incoming end point is the outgoing start point. It means G1
continuity: the incoming end handle, the shared through-point and the outgoing start handle are
collinear with the through-point strictly between the handles.

The solver adapter compiles one join as:

1. SolveSpace `CURVE_CURVE_TANGENT` (100032, finish tangent of the incoming curve, start tangent of
   the outgoing curve). This removes one degree of freedom but also admits a cusp, where both
   handles lie on the same side.
2. One auxiliary point pinned on the current join normal and two private
   `POINT_IN_ORIENTED_CHORD_HALF_PLANE` constraints (ADR-0029) that keep the two handles on
   opposite sides of the line from the moving through-point to that pinned point. Their slack
   parameters add no freedom, so each join still removes exactly one degree of freedom.

Pushing a handle through its through-point therefore collapses the handle onto the join (the
closed boundary) instead of flipping it. Dragging a through-point of a join carries both adjacent
handles rigidly by adding them as dragged points with the same displacement, so the tangent
direction survives direct manipulation. Native capacity accounting counts four constraints, one
entity and two parameters per join. No WASM rebuild is required.

### Spline tool

`Spline` (default of a new `Spline tools` family) places through-points and commits nothing until
completion, which produces one draft change and one undo entry. A pick that repeats the last
through-point (the second press of a double-click) or `Enter` finishes an open spline; a pick on
the first through-point (from three points) or `Shift+Enter` closes it; `Escape` cancels. Handles
are derived once at creation: each through-point tangent bisects its unit chord directions (a free
end mirrors its neighbor across the end chord) and each handle is one third of its chord. The
four-click control-point tool is renamed `Bezier curve` and keeps its command ID.

### Non-analytical model-edge references

Topology capture publishes `bezier-chain-edge` reference geometry for every `BEZIER_CURVE`,
`BSPLINE_CURVE`, `HYPERBOLA`, `PARABOLA`, `OFFSET_CURVE` and `OTHER_CURVE` edge. The fit is cubic
Hermite interpolation on the OCCT C3 continuity intervals, refined uniformly by powers of two. Each
segment matches the edge position and first derivative at both ends, so polynomial pieces of degree
three or less are reproduced exactly. The fit is accepted only when 15 interior samples per
segment stay within **1e-4 mm** of the edge at matching parameters (an upper bound for the
geometric distance), using at most **64 segments**. Snapshots also cap the aggregate pole count.
Edges that do not fit publish no chain.

A `model-spline` external reference persists the stable `EdgeTopoRef`, `N` projected curve IDs and
`3N + 1` projected point IDs, and nothing else. On every authoritative solve, the document worker
resolves the reference through the existing fail-closed `TopoRef` path and checks that every
published pole lies within 1e-4 mm of one plane parallel to the sketch support. That makes the
orthogonal projection an isometry that preserves the fitting tolerance. The worker projects the
chain and, when the current fit needs fewer segments than persisted, subdivides it exactly with de
Casteljau splits until the persisted count is reached. The solver receives the result as fixed
external curve chains. Constraints may reference the projected points.

The following cases fail closed with an actionable message and keep the reference for repair:

- a tilted or spatial edge;
- a fit that needs more segments than the persisted identities;
- an edge that cannot be fitted;
- a missing or ambiguous `TopoRef`.

Deleting the producing feature orphans the reference as defined in ADR-0027. Repair keeps every
projected identity. Transient candidate IDs, OCCT indices and poles are never persisted.

## Consequences

- Splines need no new geometry kernel path, persistence format or MCP tool. `create_sketch` and
  `update_sketch` accept the chain convention, `tangent-join` constraints and `model-spline`
  references through the existing sketch schema.
- G1 continuity is real solver intent rather than a display convention. Curvature (G2) continuity,
  free-form NURBS editing and spline Trim, Split, Extend and Offset remain unsupported. ADR-0068
  rejection continues for those modifiers.
- Normal-view Use and repair accept spline edges. The orbit-view picker and passive wake-up
  inference do not offer them yet.
- Non-planar edges and edges in planes not parallel to the sketch are not projected. Tilted
  projection of such curves remains future work.
- Topology capture costs one bounded fit per non-analytical edge.

## Verification

- Domain tests: chain construction, shared through-points, closed seams, collinear opposite
  handles, join validation, removal, model-spline schema, orphaning and repair.
- Solver tests: G1 continuity while a through-point is dragged in streamed steps, no reversal when a
  handle is pushed through its join, exact DOF accounting with closing joins, conflict reporting
  and closed-spline profile detection.
- Real-kernel tests: dense independent verification of B-spline fits within 1e-4 mm, chains
  published for solid edges and recomputed after a source change, preserved non-planar evidence,
  and an exact closed-spline extrusion volume against a Green-integral area.
- Application and document-worker tests: exact subdivision, the parallel-plane rule, stable
  identities on recompute and every fail-closed path.
- Component tests and a Chromium scenario: the tool lifecycle, extrusion, reopen, and Use of a
  spline model edge.
