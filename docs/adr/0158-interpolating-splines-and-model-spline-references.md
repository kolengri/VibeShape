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
2. One auxiliary separator point held at a fixed sketch-axis offset from the moving through-point
   (two projected-distance constraints set to the initial join normal times the longer handle),
   plus two private `POINT_IN_ORIENTED_CHORD_HALF_PLANE` constraints (ADR-0029). The half-planes
   keep the two handles on opposite sides of the line from the through-point to the separator.
   Because the separator translates with the join, a large join move cannot flip or vacate the
   half-planes. The offset direction is fixed for one solve, so the join tangent turns by less than
   a quarter turn per solve. The slack parameters and the anchored separator add no freedom, so
   each join still removes exactly one degree of freedom.

After every solve, an ADR-0029-style check rejects a converged join whose handles are not
collinear with the through-point, point the same way (`dot <= 0`), or are shorter than one percent
of their segment chord. The solve then reports `failed` with that join's constraint ID. A handle
pushed through its join, an authored cusp seed and a collapsed handle therefore fail closed
instead of solving as `under-constrained`. Dragging a through-point carries both adjacent handles
rigidly by adding them as dragged points with the same displacement, unless a handle has a
`fixed` constraint, so the tangent direction survives direct manipulation. Native capacity
accounting counts five constraints, one entity and two parameters per join, plus both projection
axes. No WASM rebuild is required.

### Spline tool

`Spline` (default of a new `Spline tools` family) places through-points and commits nothing until
completion, which produces one draft change and one undo entry. A pick that repeats the last
through-point (the second press of a double-click) or `Enter` finishes an open spline; a pick on
the first through-point (from three points) or `Shift+Enter` closes it; `Escape` cancels. Handles
are derived once at creation: each through-point tangent bisects its unit chord directions (a free
end mirrors its neighbor across the end chord) and each handle is one third of its chord. The
four-click control-point tool is renamed `Bezier curve` and keeps its command ID.

### Non-analytical model-edge references

Topology capture publishes `bezier-chain-edge` reference geometry for `BEZIER_CURVE` and
`BSPLINE_CURVE` edges, polynomial or rational. Their exact OCCT poles, weights and knots are
decomposed into rational Bezier pieces (Boehm knot insertion in homogeneous coordinates), trimmed
to the edge range. The fit is cubic Hermite interpolation on the knot spans, refined uniformly by
powers of two; each segment matches the edge position and first derivative at both ends.

The tolerance is proven, never sampled. Over one segment, the error is `(N − w·H) / w`, where `N`
is the homogeneous numerator, `w` the positive weight and `H` the Hermite cubic. Both are written
in the degree `p + 3` Bernstein basis, so the largest numerator coefficient divided by the smallest
weight coefficient bounds the error. De Casteljau subdivision of that error polynomial (up to
4,096 sub-intervals per segment) tightens the bound until it proves **1e-4 mm**. A fit is
published only when every segment is certified within at most **64 segments**, and the published
`maxDeviation` is that certified bound. Snapshots also cap the aggregate pole count. Edges that
cannot be certified, and hyperbola, parabola, offset and other curves that have no exact rational
form here, publish no chain and fail closed. A fixed sample grid can miss an excursion entirely:
for example, a degree-19 curve that vanishes with zero end slopes at every 1/16 sample hides a
0.01 mm bulge from a 16-sample check. That curve still needs about 2.1e-4 mm at 64 segments, so it
is refused.

Published chains are oriented independently of the source parameterization: an open chain starts
at its lexicographically smaller end, and a closed chain leaves its seam toward the smaller
neighbor pole. A rebuild that reverses the edge parameterization therefore keeps both end
identities.

A `model-spline` external reference persists the stable `EdgeTopoRef`, `N` projected curve IDs and
`3N + 1` projected point IDs, and nothing else. On every authoritative solve, the document worker
resolves the reference through the existing fail-closed `TopoRef` path and checks that every
published pole lies within 1e-4 mm of one plane parallel to the sketch support. That makes the
orthogonal projection an isometry that preserves the fitting tolerance. The worker projects the
chain and, when the current fit needs fewer segments than persisted, subdivides it exactly with de
Casteljau splits until the persisted count is reached. The solver receives the result as fixed
external curve chains.

Only the two chain ends are stable. Interior projected points are fit nodes and poles that move
along the edge when the published segment count changes, so domain and protocol validation reject
constraints on interior projected points or projected curves. The sketch view does not offer
interior poles for selection or snapping.

The following cases fail closed with an actionable message and keep the reference for repair:

- a tilted or spatial edge;
- a fit that needs more segments than the persisted identities;
- an edge that cannot be fitted;
- a missing or ambiguous `TopoRef`.

Deleting the producing feature orphans the reference as defined in ADR-0027. Repair keeps every
projected identity, so it offers only edges whose current fit needs no more segments than the
stored identities. Transient candidate IDs, OCCT indices and poles are never persisted.

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
- Topology capture costs one bounded, certified fit per B-spline or Bezier edge.
- One solve cannot rotate a join tangent by a quarter turn or more; streamed drags and later
  solves continue from the new orientation.

## Verification

- Domain tests: chain construction, shared through-points, closed seams, collinear opposite
  handles, join validation, removal, model-spline schema, orphaning and repair.
- Solver tests: G1 continuity while a through-point is dragged in streamed steps, rigid joins under
  perpendicular dimension edits larger than the handle length, closed failure for a single-step
  drag through the join and an authored cusp seed, unmoved fixed handles, exact DOF accounting with
  closing joins, conflict sets and closed-spline profile detection.
- Fitting tests: the grid-invisible degree-19 counterexample is refused at 0.01 mm and certified at
  0.001 mm with a bound covering the measured deviation, plus rational arcs, knot insertion and a
  reversed parameterization.
- Real-kernel tests: dense independent verification of B-spline fits within 1e-4 mm, chains
  published for solid edges and recomputed after a source change, preserved non-planar evidence,
  the degree-19 counterexample on an OCCT edge, a reversed edge, and an exact closed-spline
  extrusion volume against a Green-integral area.
- Application and document-worker tests: exact subdivision, the parallel-plane rule, stable
  identities on recompute and every fail-closed path.
- Component tests and a Chromium scenario: the tool lifecycle, extrusion, reopen, and Use of a
  spline model edge.
