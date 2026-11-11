# ADR-0156: Pattern along a sketch path

- Status: Accepted
- Date: 2026-11-11

## Context

Body Pattern placed copies only along a straight axis (Linear) or around one (Circular). Rails,
chains, rims and cable guides need copies distributed along a curve. Sweep already resolves exact
sketch paths with stable selectors, explicit start points and fail-closed G1 validation
([ADR-0079](0079-exact-sweep-hollow-loft-and-sketch-corners.md)), and Pattern already turns one exact
body into named `pattern.instance.N` outputs that downstream features consume. The pinned
`replicad-opencascadejs` 0.23.0 WASM build exposes `BRepAdaptor_Curve` and `BRepGProp`, but not
`GCPnts_AbscissaPoint` or `GCPnts_UniformAbscissa`, so OCCT cannot place points at an arc length
directly. Its `BRepGProp.LinearProperties` length is a fixed low-order quadrature: it disagrees with
the exact length of a cubic Bezier by 0.078 mm out of 126 mm.

## Decision

Pattern gains schema version 3 (`org.vibeshape.feature.part-design.pattern#3`) with `kind: "path"`.
Versions 1 and 2 stay unchanged, replay as before, and keep their version on edit unless the Path
kind is chosen. Version 3 persists:

- the exact `targetBody` (any named output, including earlier pattern instances);
- an expression-capable scalar `count` from 2 to 256 including the seed;
- the shared `sketchPathSelector` (sketch ID, sorted entity IDs, start point ID);
- `spacing`: `equal`, or `fixed` with a positive expression-capable arc-length `distance`;
- a non-negative expression-capable `startOffset`;
- `orientation`: `translate` or `follow`;
- `reverse`.

**Path.** The path reuses Sweep's selector and materializer, which this feature extends with an
opt-in closed-loop mode. A path is one connected G1 chain of lines, circular arcs, cubic Beziers or
elliptical arcs, open or closed, or a single sketch circle. Branches, revisited joints, corners
(including a closed loop's seam), missing curves and zero-length curves fail preparation. An open
path starts at its named endpoint. A closed chain starts at its named joint. A circle starts at the
sketch +X direction from its center when the start point is the center point, or at a named solved
point that lies on the circle. Closed paths run counterclockwise about the sketch normal; the signed
loop area decides the traversal direction of a chain regardless of authored curve order.

**Seed reference.** As in mainstream CAD path patterns, the seed body is not moved. The path point at
`startOffset` (measured from the path start) is the seed's reference. Instance *i* sits at path
distance *s<sub>i</sub>*, and its placement maps the reference point to the path point at
*s<sub>i</sub>*, so every copy keeps the seed's offset from the path. Instance zero is the identity.

**Spacing.** `equal` on an open path places the instances from the offset to the path end, end
included. On a closed path it divides the length by the count, so the last instance does not
duplicate the seed. `fixed` steps by the distance from the offset. Fixed spacing that runs past an
open path's end, fixed spacing whose span reaches a closed path's length, and an offset at least the
path length fail with a message that gives the required and available lengths. `reverse` starts an
open path at its other end and runs a closed path clockwise.

**Orientation frame.** A sketch path is planar. `follow` uses the frame (T, N × T, N), where T is the
unit tangent in the direction of travel and N is the sketch normal. Each copy rotates about N through
the reference point by the signed angle from T at the reference to T at its station, then
translates. On a planar curve this frame is the rotation-minimizing frame. Unlike the Frenet frame
it does not flip at inflection points or become undefined on straight segments. G1 continuity makes
T defined at every station. `translate` applies only the translation.

**Arc length.** The worker builds each directed curve as an exact OCCT edge, reusing the Sweep and
Loft analytical edge builder. It integrates |C′(u)| over each `BRepAdaptor_Curve` with a ten-point
Gauss–Legendre rule, bisecting each panel until the whole-panel and two-half estimates agree within
1e-12 relative. It inverts arc length with a Newton iteration bracketed by bisection to 1e-10 mm.
Lines and circular arcs integrate exactly. Tests compare a cubic Bezier against an independent
dense-polyline measurement to 1e-3 mm. They also compare line, arc and circle stations with
analytic positions to 1e-6 mm. `BRepGProp` is not used as a cross-check because it is less accurate
than this integration for Beziers.

**Ownership and outputs.** The target producer is the first dependency. The path sketch's support
and external owners follow in first-occurrence order and only schedule the path; the worker never
validates them as bodies. References are empty, and the sketch is a semantic input. The document
worker resolves the solved path into directed analytical content. The geometry worker turns it into
rigid placements and builds every copy with one `BRepBuilderAPI_Transform` through the existing
Pattern kernel. That kernel validates each instance as one positive-volume solid of the seed volume
and releases every copy if any instance fails. Sampling releases each adaptor, point, vector and
edge on success and on failure. Outputs, part bindings, count fan-out and History repair are those
of versions 1 and 2: `pattern.instance.0` continues the seed part, and later instances own
independent parts.

**Surfaces.** The Pattern task panel gains a Path kind. It reuses Sweep's keyboard path fields with
circles added. Choosing a path sketch enables viewport toggling of its non-construction lines,
arcs, circles and Beziers, with the viewport's keyboard picker as a fallback. Elliptical arcs are
chosen from the panel list. MCP extends `create_reference_body_pattern` and
`update_reference_body_pattern` with the strict path variant, selected by `kind`.

## Consequences

- Model-edge chains are not accepted as paths. A user projects or draws the path in a sketch.
  Edge chains need stable chain references and a non-planar frame, which this decision does not
  define.
- Corners are rejected even for `translate`, which keeps one validation rule with Sweep and a defined
  frame for `follow`. A rectangle path therefore needs tangent fillets.
- Path patterns are not associative to their instances' later edits; each copy is an independent
  part, as for other patterns.
- An arc-length change of the path, such as a sketch edit, moves the copies. Fixed spacing that no
  longer fits fails preview and rebuild instead of dropping instances.

## Evidence

Real-kernel tests check instance positions against analytic arc-length stations on a straight line,
a quarter arc and a full circle. They also cover a clockwise-authored closed loop traversed
counterclockwise, follow orientation turning copies by the analytic tangent angle, start offset,
reverse on open and closed paths, and a cubic Bezier against an independent measurement. Overrun and
wrap failures, native temporary release on rejection, copy release on a failed placement, and engine
evaluation with named instances consumed by a downstream Scale are covered too. Domain, document
preparation, form, MCP schema/adapter and Chromium end-to-end tests cover bounds, expressions,
dependencies, closed and circle paths, picking, Apply, Undo and reopen.
