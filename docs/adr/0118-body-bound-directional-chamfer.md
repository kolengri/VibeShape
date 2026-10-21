# ADR-0118: Body-bound directional Chamfer

- Status: Accepted with bounded planar measurement support
- Date: 2026-10-20
- Extends: [ADR-0040](0040-selected-edge-treatments.md) and
  [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md)
- Measurement boundary superseded in part by:
  [ADR-0121](0121-circular-offset-chamfer.md)

## Decision

Extend the existing Part Design Chamfer type with feature schema version 3. Keep V1 all-edge and V2
explicit legacy edge sets unchanged, with no implicit migration. Fillet retains its current versions.
UI and local/paired remote MCP use the same registered feature commands, quantities, exact preview
and revision-safe persistence.

V3 stores an exact named `targetBody`, ordered typed edge/face targets, equal-distance/two-distance/
distance-angle mode, Offset/Tangent measurement, tangent propagation, global flip and per-edge
direction overrides in parameters. Its only dependency is the target body's producing feature;
generic feature references are empty. Canonical worker content retains output-role identity and
numeric resolved quantities without nested source UUIDs. Existing protocol envelopes remain valid.
Native topology acquisition is private to the exact source shape and content hash.

An asymmetric edge target requires an explicit adjacent side face. A face target supplies that side
and expands to its current exact native boundary. Catalogue adjacency classes cannot identify exact
adjacent faces; neither UI nor MCP may guess a side. Native incidence validation fails closed. The
first distance/angle is relative to that side; global flip XOR an edge override chooses the opposite
side. Equal-distance mode rejects meaningless direction controls.

OCCT constructs tangent contours. Propagation enabled uses that native behavior; disabled requires
complete explicit coverage of each contour. Conflicting directions within one contour are rejected.
Independent contours and uniformly overridden full contours retain independent side intent.

## Measurement boundary

[Onshape's Chamfer help](https://cad.onshape.com/help/Content/PartStudio/chamfer.htm) distinguishes
starting-edge Offset from tangent-intersection Tangent on non-planar supports, while specifying equal
behavior for planar adjacent faces. OCCT Classic/ConstThroat names do not prove equivalence. V3
therefore supports both measurement choices only on proven planar supports and rejects curved
supports explicitly. Legacy V1/V2 circular-rim equal-distance geometry keeps its original builder.
This is a material limitation, not a claim of complete Onshape parity.

## Interaction and failures

Graphical edge/face fields own transient selections, infer exact target bodies, and keep Section
clipping active. Idle CAD edge selection is captured before starting Fillet/Chamfer. Missing,
ambiguous or undisplayable candidates remain explicit repair/keyboard feedback; tessellation edges
and native enumeration positions never become authored topology identity.

A resolved but unbuildable treatment reports sanitized geometric guidance to reduce its size or
choose another edge. Missing or ambiguous references request explicit reselection. No raw native
exception escapes the worker, no automatic all-edge broadening occurs, and oversized geometry does
not imply automatic traversal across neighboring surfaces.

## Required evidence

Domain/protocol/adapter tests cover strict modes, quantities, references, dependencies and content
identity. Production-engine cases verify measured setbacks/angle convention, flip/overrides,
face-boundary expansion, exact named outputs, unchanged borrowed sources, specific failures and
native disposal. A split-edge contour fixture verifies actual propagation and direction conflicts.
Browser acceptance covers graphical circular-edge clicks, Section retention, preselection transfer,
preview/Apply/Cancel, and reopening the saved feature. Operator instructions and their generated
bundle describe the same bounded contract.
