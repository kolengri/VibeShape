# ADR-0032: Stable linear model-edge Revolve axis

- Status: Accepted
- Date: 2026-08-31
- Extends: [ADR-0031](0031-stable-sketch-line-revolve-axis.md)

## Context

Revolve already supports sketch-local origin axes and stable lines from the selected profile sketch.
Production CAD workflows also start Revolve by clicking a visible straight model edge. Persisting a
viewport candidate ID, B-Rep edge index, or evaluated world coordinates would make that selection
unstable across rebuilds and would violate the existing `TopoRef` boundary.

Onshape also accepts cylindrical edges, arcs, and Mate connector axes. This decision opens only the
smallest exact model-topology boundary: a straight edge that lies in the selected profile plane.

## Decision

Introduce `org.vibeshape.feature.part-design.revolve#4`. Its axis intent adds:

- a `model-edge` variant containing one stable `EdgeTopoRef` for the producing feature.

The document stores semantic role, lineage or signature fallback, and optional selection intent. It does
not store the rebuild-local topology candidate ID, renderer object, B-Rep ordinal, or evaluated endpoints.
Schema versions 1 through 3 remain registered for read and rebuild compatibility. Editing a legacy
Revolve writes version 4 without changing its existing origin or sketch-line intent.

The model-edge owner is an evaluation dependency, not a body dependency. Canonical dependency order is
the modifying target first when present, followed by the distinct profile-support owner and then the
distinct model-edge source. `feature.references` remains reserved for the profile sketch support. New-body
Revolve therefore does not consume or replace the body that supplies its axis.

Only feature geometry earlier than the Revolve is eligible. The graphical picker exposes exact straight
edges that are coplanar with the selected profile frame, alongside the existing same-sketch lines and X/Y
alternatives. Hover, overlap cycling, pointer selection, and keyboard selection use localized
`Feature · Edge N` labels while the saved axis uses only stable topology intent.

During rebuild, the document worker resolves the `EdgeTopoRef` against the source feature's current
topology candidates. The resolved candidate must still be a finite, non-degenerate `LINE` edge with exact
line reference geometry in the profile plane. Missing, ambiguous, wrong-type, degenerate, unavailable, or
noncoplanar sources fail closed. The geometry protocol independently validates the normalized transient
world axis and its coplanarity before OCCT receives it.

Source deletion remains blocked by the ordinary feature dependency graph. This slice does not add silent
retargeting or a feature-axis repair protocol.

## Deferred gates

- cylindrical, circular, arc, elliptical, and spline-derived model axes;
- connector, datum-axis, and cross-sketch axes;
- replacement and repair UI for broken feature-axis references;
- additional Revolve end conditions.

## Consequences

- A Revolve follows topology-preserving upstream edits even when evaluation-local candidate IDs change.
- Ambiguous topology changes remain visible failures instead of selecting the nearest edge.
- Axis sources participate in scheduling and invalidation without becoming Boolean targets or exported
  bodies.
- The existing viewer selection broker can present sketch and model candidates through one accessible
  workflow while authority remains in the document worker.

## References

- [Onshape Revolve](https://cad.onshape.com/help/Content/PartStudio/revolve.htm)
- [Onshape selection](https://cad.onshape.com/help/Content/Home/selection.htm)
- [Onshape Select Other](https://cad.onshape.com/help/Content/Home/select_other.htm)
