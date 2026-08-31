# ADR-0033: Selector-backed saved profile picking

- Status: Accepted
- Date: 2026-08-31
- Extends: [ADR-0018](0018-deterministic-sketch-profile-extraction.md), [ADR-0019](0019-selector-backed-new-body-extrusion.md)

## Context

Saved sketches are visible in the 3D model viewport, but their closed regions are passive line displays.
After finishing a sketch, a user must recover the intended region through task-panel controls before
starting Extrude or Revolve. That breaks the direct CAD interaction where visible geometry is the primary
selection surface.

The worker already extracts deterministic analytical profiles and feature commands already persist
`SketchProfileSelector`. The missing boundary is a disposable render representation that can return the
same selector without treating solver loop indices, sampled coordinates, or Three.js objects as design
intent.

## Decision

Document protocol v16 extends each saved-sketch display record with:

- the exact resolved sketch support frame;
- a bounded list of display-only profile regions;
- one canonical `SketchProfileSelector` per region;
- sampled local two-dimensional outer and hole loops used only for triangulation and hit testing.

The document worker derives these records from the successful saved-revision solve. Profile extraction,
loop ordering, and selector construction remain owned by the sketch solver and domain contracts. A failed,
ambiguous, unsupported, or over-budget profile is omitted without failing the solid rebuild. The document,
history, archive, and feature parameters never store the support-frame copy, samples, triangles, profile
index, loop index, renderer object identity, or pointer coordinates.

The Three.js viewer triangulates the bounded local loops with holes, maps them through the supplied support
frame, and owns the resulting disposable meshes. Saved-profile hover and click are separate interaction
channels from B-Rep face selection. Preselection and selection are keyed by the canonical selector, and
overlapping hits use a deterministic bounded candidate stack rather than insertion order.

Selecting a visible saved profile keeps the application in Model, activates its source sketch as context,
selects that stable profile, and enables the shared Extrude and Revolve commands. It does not enter sketch
edit mode. Activating the sketch in History continues to enter edit mode. Hiding the sketch removes both
its display and hit regions and clears a now-invalid saved-profile selection. The existing accessible
profile controls remain the keyboard equivalent and use the same selector.

## Consequences

- Finish sketch → click region → Extrude or Revolve becomes a direct visual workflow.
- Multiple profiles and holes retain semantic identity across solve order and tessellation changes.
- The worker response is larger, so profile loops and aggregate transferred coordinates are strictly
  bounded and validated.
- Viewer triangulation can change without a document migration because triangles are derived presentation.
- Multi-profile feature input remains deferred; this decision selects one profile at a time.

## References

- [Onshape Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm)
- [Onshape selection](https://cad.onshape.com/help/Content/Home/selection.htm)
- [Three.js ShapeUtils](https://threejs.org/docs/#ShapeUtils.triangulateShape)
