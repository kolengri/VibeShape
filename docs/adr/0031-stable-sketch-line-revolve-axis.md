# ADR-0031: Stable sketch-line Revolve axis

- Status: Accepted
- Date: 2026-08-31
- Extends: [ADR-0028](0028-selector-backed-origin-axis-revolve.md) and [ADR-0030](0030-explicit-target-revolve-operations.md)

## Context

The origin-axis Revolve contract proves exact replay around sketch-local X or Y, but it cannot express
the common CAD workflow where the author clicks a line in the profile sketch. Persisting the displayed
line coordinates, a renderer object, or a candidate ordinal would detach the feature from sketch solving
and make deletion or reordering ambiguous.

Onshape's Revolve workflow accepts graphical axis selection and supports lines, cylindrical edges, arcs,
and Mate connector axes. This decision opens only the stable same-sketch line boundary. Model topology,
curved axes, and connector frames require separate identity and repair contracts.

## Decision

Introduce `org.vibeshape.feature.part-design.revolve#3`. Its axis intent is one of:

- an origin axis with sketch-local `x` or `y`; or
- a sketch-line reference containing the selected profile sketch ID and stable line entity ID.

The referenced line must belong to the same sketch as the selected profile. Both construction and regular
line entities are eligible. The feature stores no solved points or world coordinates, and the same-sketch
axis adds no feature dependency.

During rebuild, the document worker resolves the line's exact solved endpoints, rejects missing,
wrong-type, unsolved, or degenerate entities, and transforms the resulting line through the current sketch
support frame. The transient geometry content contains the semantic axis intent plus one normalized
world-space axis. The geometry protocol independently checks that a selected line belongs to the prepared
sketch and lies in its support plane.

The geometry worker tests the analytical profile against the selected line with an exact linear projection
of line, arc, circle, ellipse, and elliptical-arc bounds. A profile may touch the axis but may not strictly
span it. OCCT receives the resolved line as `gp_Ax1` only after these checks.

While Revolve is open, exact solved lines from the profile sketch are highlighted and selectable in the 3D
viewport. Hover, overlap cycling, and the keyboard picker use stable human-readable labels. The parameter
panel keeps explicit X/Y alternatives and shows the selected line label; a graphical choice updates the
same preview and save path as any other parameter edit.

Schema versions 1 and 2 remain registered for read and rebuild compatibility. Their string X/Y axes are
normalized to version-3 origin-axis intent in memory. Editing either legacy version writes version 3 while
preserving feature identity, selected profile, angle, operation, target, support reference, and dependency
order.

## Deferred gates

- stable linear or cylindrical model-edge axes;
- arc or circular-curve axes;
- implicit or explicit connector axes;
- cross-sketch line axes and their document-graph dependencies;
- axis repair and replacement after a referenced line is deleted;
- two-direction, symmetric, and additional Revolve end conditions.

## Consequences

- A Revolve follows later constraint and support-frame edits to its selected line without persisting
  derived geometry.
- Deleting or changing the line fails the feature closed instead of silently selecting a replacement.
- Axis selection is visual and accessible without weakening the authoritative document/worker boundary.
- Model-edge and connector selection remain unavailable until they have stable identity, dependency, and
  repair semantics.

## References

- [Onshape Revolve](https://cad.onshape.com/help/Content/PartStudio/revolve.htm)
- [Onshape selection](https://cad.onshape.com/help/Content/Home/selection.htm)
- [Onshape Select Other](https://cad.onshape.com/help/Content/Home/select_other.htm)
