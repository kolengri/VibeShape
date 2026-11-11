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
   half-planes. The offset direction is fixed for one solve and follows the dragged handle when a
   handle is dragged, so other changes turn a join tangent by less than a quarter turn per solve.
   The slack parameters and the anchored separator add no freedom, so each join still removes
   exactly one degree of freedom.

After every solve, an ADR-0029-style check rejects a converged join whose handles are not
collinear with the through-point, point the same way (`dot <= 0`), or are shorter than one percent
of their segment chord. The solve then reports `failed` with that join's constraint ID. An
authored cusp seed and a collapsed handle therefore fail closed instead of solving as
`under-constrained`. The one-percent rule is deliberate: it also fails handles that a user makes
very short on purpose, and joins whose neighboring chords are stretched to more than a hundred
times a handle length; such geometry is near a cusp and is rejected rather than silently kept.

Three solve-time rules keep handle lengths stable when joins move:

- **Predictor solve.** Every solve of a sketch with joins first runs once with both handles of each
  join held at their current offsets from its through-point, but only for joins where neither
  handle is explicitly dragged or driven by any other constraint (fixed, dimensioned, coincident
  and so on), directly or through a curve that shares the handle point, such as a horizontal
  construction line from the through-point to the handle. Reference dimensions only measure, so
  they do not free a handle. Holding a driven handle would satisfy its constraint by moving the
  through-point, and holding only one handle would lock the tangent direction, so such joins keep
  their ordinary constraint. Held joins' own G1 constraints are implied and omitted, and every hold
  ties an otherwise unconstrained handle, so the holds never duplicate a user constraint. When the
  predictor converges without conflicts, its points seed the ordinary solve, which certifies
  status, freedom and the G1 check; when the sketch itself is over-constrained or does not converge,
  or no join is held, the ordinary solve runs unchanged for the whole sketch. A join that moves
  along its tangent through a dimension or a coincident point therefore translates with its
  handles instead of shrinking one.
- **Carried handles.** Dragging a through-point, or a point coincident with it, carries both
  adjacent handles rigidly as dragged points with the same displacement, unless a handle has a
  `fixed` constraint.
- **Mirrored seed.** Dragging exactly one handle of a join seeds the free opposite handle on the
  mirrored tangent at its own length, and the separator follows the dragged handle. A fast flick,
  even one that pushes the handle behind its through-point, turns the join while staying G1
  instead of stalling or forming a cusp.

Native capacity accounting counts five constraints, one entity and two parameters per join, plus
both projection axes. No WASM rebuild is required.

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
cannot be certified, periodic B-splines (whose knot vectors are unclamped), and hyperbola,
parabola, offset and other curves that have no exact rational form here, publish no chain and fail
closed. Capture only reads the adaptor curve: for an untransformed edge it is the edge's own shared
geometry, so opening a periodic curve in place would corrupt live feature output. A fixed sample
grid can miss an excursion entirely: for example, a degree-19 curve that vanishes with zero end
slopes at every 1/16 sample hides a 0.01 mm bulge from a 16-sample check. That curve still needs
about 2.1e-4 mm at 64 segments, so it is refused.

Published chain poles follow the curve parameterization, which a rebuild can reverse. Consumers
therefore never derive end identity from the published order.

A `model-spline` external reference persists the stable `EdgeTopoRef`, the sketch-local
`endpointAnchors` of its projected start and end, `N` projected curve IDs and `3N + 1` projected
point IDs, and nothing else. On every authoritative solve, the document worker resolves the
reference through the existing fail-closed `TopoRef` path, projects the chain, and pairs its
projected ends with the anchors, choosing the orientation with the smaller summed endpoint
displacement. End identity therefore follows the physical ends through small edits, large moves and
reversed parameterizations alike. Because the anchors live in the sketch frame, a support frame that
turns together with the referenced edge keeps the pairing however far both turn, for example a
sketch on a datum plane whose angle also turns the feature that owns the edge. Frames of origin
planes and of box or cylinder faces never turn, so there the anchors simply follow the edge.

Use records the anchors from the chosen edge's current ends, so the first resolution is exact;
reload reads the persisted anchors, so a reopened sketch pairs identically; repair re-anchors on the
replacement edge. MCP clients cannot see a support frame, so `create_sketch` and `update_sketch`
accept a model-spline reference without anchors. Before the sketch becomes a command, the automation
session rebuilds the owned draft once, disposably, and fills each omitted anchor from the current
projected chain ends with the same frame, `TopoRef` and projection rules as a solve; supplied
anchors are kept. Persisted records and commands always carry anchors.

A closed chain needs no pairing because both ends are its seam. When the two pairings differ by no
more than one thousandth of the chord (at least 1e-6 mm), for example after sliding the edge along
its own chord by more than its length, the correspondence is ambiguous and the reference fails
closed until it is repaired. Anchors are not refreshed by ordinary rebuilds, so an edge that
eventually turns by more than a quarter turn relative to its sketch frame can pair with the nearer
physical ends rather than the original ones; repair re-anchors it.

The worker then checks that every published pole lies within 1e-4 mm of one plane parallel to the
sketch support. That makes the orthogonal projection an isometry that preserves the fitting
tolerance. The worker projects the chain and, when the current fit needs fewer segments than
persisted, subdivides it exactly with de Casteljau splits until the persisted count is reached. The
solver receives the result as fixed external curve chains.

Only the two chain ends are stable. Interior projected points are fit nodes and poles that move
along the edge when the published segment count changes, so domain and protocol validation reject
constraints on interior projected points or projected curves. The sketch view does not offer
interior poles for selection or snapping.

The following cases fail closed with an actionable message and keep the reference for repair:

- a tilted or spatial edge;
- a fit that needs more segments than the persisted identities;
- ambiguous endpoint correspondence with the stored anchors;
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
- Except when a handle is dragged, one solve cannot rotate a join tangent by a quarter turn or
  more; streamed drags and later solves continue from the new orientation.
- Splines need two native solves per solve request when the predictor applies.

## Verification

- Domain tests: chain construction, shared through-points, closed seams, collinear opposite
  handles, join validation, removal, model-spline schema, orphaning and repair.
- Solver tests: G1 continuity while a through-point is dragged in streamed steps, rigid joins under
  perpendicular dimension edits larger than the handle length, a single-step drag through the join
  that turns it while staying G1, closed failure for an authored cusp seed, unmoved fixed handles,
  exact DOF accounting with closing joins, conflict sets and closed-spline profile detection.
- Profile tests: open 18- and 30-segment splines and a 30-segment zigzag polyline report an open
  chain instead of an out-and-back loop within a bounded time, while a 30-point closed spline and a
  boundary with a dangling spur still form one profile.
- Predictor and seed tests: tangent-sliding dimensions of 15, 18, 40 and 100 mm and a coincident
  drag keep both handle lengths, also beside an unchanged handle dimension on another join; a
  handle dimension and a coincident handle drag reshape the tangent instead of moving the join;
  sliding joins keep their handles beside a horizontal construction line on another join's handle
  and beside a reference dimension, and dragging a line attached to a handle moves its join exactly
  as a solve without holds does; a 120-degree handle flick and a streamed push-through converge at
  every step and stay G1.
- Fitting tests: the grid-invisible degree-19 counterexample is refused at 0.01 mm and certified at
  0.001 mm with a bound covering the measured deviation, plus rational arcs, knot insertion and a
  reversed parameterization.
- Real-kernel tests: dense independent verification of B-spline fits within 1e-4 mm, chains
  published for solid edges and recomputed after a source change, preserved non-planar evidence,
  the degree-19 counterexample on an OCCT edge, a reversed edge, an untouched periodic curve trimmed
  across its seam, and an exact closed-spline extrusion volume against a Green-integral area.
- Application and document-worker tests: exact subdivision, the parallel-plane rule, stable
  identities on recompute, end pairing through a lexicographic flip, a large move, a rotation, a
  reversed edge and reload, end identity kept when the support frame turns 120 degrees with the
  edge, and every fail-closed path.
- Automation tests: model-spline references may omit anchors only in automation input; the session
  fills them from a rebuilt draft edge, keeps supplied anchors without rebuilding, and fails closed
  for unavailable geometry, a tilted edge and a stale draft revision.
- Component tests and a Chromium scenario: the tool lifecycle, extrusion, reopen, and Use of a
  spline model edge.
