# ADR-0155: Exact helix, Coil feature and helical Sweep path

- Status: Accepted
- Date: 2026-11-11
- Extends: [ADR-0064](0064-modeled-custom-threads.md), [ADR-0079](0079-exact-sweep-hollow-loft-and-sketch-corners.md)

## Context

Modeled threads were the only helical geometry. Springs, coils and helical channels required a
general helix, and Sweep accepted only planar sketch paths. A helical sweep must neither twist its
section nor silently produce overlapping turns.

## Decision

Extend the first-party Part Design owner. No new kernel, package or worker operation is added.

- **Shared helix intent** (`part-design-helix`): axis (`origin-axis`, `datum-axis`, stable
  `linear-edge` or `explicit-axis`, the same reference-axis contract as Pattern v2 and Thread v2),
  handedness, radius, pitch, extent as turns or height, and start angle. Every quantity is
  expression-capable. Height is the axial travel of the centerline; derived turns stay between
  0.05 and 50. The zero-angle radial direction uses the Thread phase convention (projected cyclic
  seed X→+Y, Y→+Z, Z→+X); the start angle rotates it about the axis. Right-handed helices advance
  counterclockwise about the axis direction.
- **Coil** (`org.vibeshape.feature.part-design.coil#1`): a circular or rectangular section, centered
  on the helix and normal to its start tangent, swept along the helix. Operation `new` produces an
  independent body; `add`, `remove` and `intersect` modify one exact named target body, as Revolve
  v7 and Extrude do. Dependencies are the target (when modifying) then any distinct axis producer;
  generic references stay empty because body-bound topology lives in `parameters.axis`.
- **Sweep v2** (`org.vibeshape.feature.part-design.sweep#2`): `{ profile, path: { kind: "helix", … } }`.
  Planar sketch paths keep writing version 1, so existing records replay unchanged. Dependencies
  are the profile sketch owners, then any distinct helix-axis producer (at most nine). The profile
  must already lie in a plane through the helix start, normal to its start tangent (tilted by the
  lead angle); nothing is repositioned. Helical profiles must be hole-free in this version.

### Self-intersection rule

The swept solid is the set of screw images of the start section. Every section point therefore
crosses the start meridian half-plane once per turn, at a height fixed by its own polar angle. In the
local helix frame (x radial, y tangential, a axial, origin on the axis) a point crosses at
`z = a − sign·(p / 2π)·atan2(y, x)`. For a section point `n` along the inward principal normal and `b`
along the binormal, with `c = 2πR` and `L = √(c² + p²)`, this is
`z = b·c/L + (p/2π)·atan(b·p / (L·(R − n)))`. Points nearer the axis climb faster than the centerline,
so the span exceeds the first-order estimate `s / cos α` (which accepted overlapping coils, for
example R = 5 mm, 8 × 2 mm rectangle, p = 2.02 mm, or R = 1 mm, ⌀1.9 mm, p = 1.994 mm).

The rule is: every section point stays off the axis (`R − n > 0`, i.e. `R − w/2 > 0`), and
**the pitch exceeds the exact meridian span** `max z − min z`. The rule is sufficient for every
section: `z` increases strictly with `b`, so interior points never exceed the boundary; with `x > 0`
a screw orbit meets the section half-plane at most once within ±½ turn, so any self-contact must
appear as two meridian points one pitch apart, which the span rule excludes.

It is also necessary, and therefore exact, for Coil sections. A circle or rectangle centered on the
helix is symmetric in the binormal, so its highest and lowest crossings come from points `(n, ±b)`
at the same radius and the binormal segment between them lies in the section. A pitch at or below
the span therefore places the next turn's lowest point on that segment. A helical Sweep profile
need not have that symmetry, so for it the rule is conservative: a profile whose meridian image
nests with its own one-pitch translate (for example a chevron opening along the axis) is rejected
even when its turns would not touch. At the computed minimum Coil pitch the
⌀1.9 mm case touches exactly where the centerline's far self-distance equals the section diameter (the
tube-thickness criterion), and the tests check this agreement independently for several circular
sections, plus a real-kernel overlap oracle on both reproductions.

- Rectangle: `z_max = (h/2)·c/L + (p/2π)·atan(h·p / (2L·(R − w/2)))`, span `2·z_max`.
- Circle: `z_max` maximized over the boundary angle by dense sampling and golden-section refinement.
- Helical Sweep: the kernel samples each profile boundary edge in the start frame and refines the
  extremes of `z` and of `x` (which must stay positive).
- The reported minimum pitch is found by bisection and rounded up to 0.001 mm.

The Coil functions live in the worker protocol and, mirrored, in the domain (which cannot import the
protocol). A parity test in the document worker, which depends on both, compares their spans and
minimum pitches over several circular and rectangular sections. The geometry worker reuses the
protocol's meridian mapping and interval maximizer for helical Sweep profiles instead of a third
copy. Checks run in the domain and protocol schemas and again in the geometry worker, so invalid
content fails closed.

### Geometry

The document worker resolves the axis against current geometry. The geometry worker builds the helix
as straight PCurves on a cylinder, chained in edges of at most four turns because one approximated 3D
curve degrades beyond about twenty turns, and sweeps a single section wire with
`BRepOffsetAPI_MakePipeShell` in Frenet mode, then `MakeSolid`. For a helix the Frenet frame is a
rigid screw motion of the start frame, so the section does not twist; the default corrected-Frenet
(rotation-minimizing) frame would rotate the section relative to the helix by its torsion. Every
native temporary is released on success and failure through a shared ownership scope.

## Consequences

Coil results are ordinary exact solids that downstream features, STEP export, `.vshape`
persistence and undo/redo already handle. The UI and the named MCP tools (`create_coil`,
`update_coil`, and helix paths on `create_sweep`/`update_sweep`) stage the same validated records
through owned drafts and disposable preview.

Changing a helical Sweep's radius, pitch, start angle, handedness or axis moves its start point and
tangent; the profile plane is not moved automatically, so the profile sketch's support must be
re-oriented (preview fails closed until it is).

Out of scope: flat/ground spring ends (ends are planar cuts normal to the helix), variable pitch or
radius, conical helices, multi-start coils and holed helical sweep profiles.

## Verification

Domain tests cover bounds, handedness, turns versus height, self-intersection diagnostics,
expressions, dependency order and Sweep v1 compatibility. Real-kernel tests verify that a
circular-section coil matches π·r²·L, that handedness flips a sampled point, single valid solids,
Add/Remove/Intersect on a named target, a 50-turn bound, that a helical sweep of the same circle
matches the coil volume, untwisted end caps (each end vertex is the screw image of a start vertex),
fail-closed inputs and wrapper disposal. Task panel, MCP schema/adapter and Chromium workflows
cover authoring, Apply, undo and reopen.
