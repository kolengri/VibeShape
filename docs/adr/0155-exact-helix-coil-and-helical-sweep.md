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

A section of axial size `s`, normal to the tangent, spans `s / cos α` in the meridian plane, where
`tan α = p / (2πR)`. Adjacent turns stay apart only when `p > s / cos α`, which gives the minimum
pitch `s·2πR / √((2πR)² − s²)`. Coil applies this to its analytic section and reports the minimum
pitch; helical Sweep measures the profile's axial extent in the local helix frame (its meridian span
is that extent divided by `cos² α`). Sections reaching the axis are rejected. Both checks run in the
domain/protocol schemas and again in the geometry worker, so invalid content fails closed.

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
