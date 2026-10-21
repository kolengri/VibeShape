# ADR-0121: Bounded circular Offset Chamfer

- Status: Accepted with bounded circular-rim support
- Date: 2026-10-21
- Supersedes: the curved-support rejection in the measurement boundary of
  [ADR-0118](0118-body-bound-directional-chamfer.md)

## Decision

Chamfer V3 additionally permits equal-distance Offset on an exact closed circular edge with exactly
two distinct adjacent native faces: one plane and one cylinder. Their circular intersection is an
orthogonal rim. The same check applies to selected and propagated edges, including face-boundary
expansion. Inner and outer rims and arbitrary rigid placement share this contract.

Keep planar measurement behavior, exact body ownership, semantic reference resolution, contour
coverage, conflict checks, result validity and native disposal unchanged. Native hashes and catalogue
ordinals remain evaluation-local acquisition data, never persisted intent. Legacy V1/V2 builders
remain unchanged; selecting a named body does not justify rejecting this proven circular subset.

Curved Tangent, curved directional modes, open circular arcs, cone/cylinder transitions and all other
curved support pairs remain unproved in V3 and fail explicitly. Seams, degenerate and non-manifold
edges still require two distinct adjacent faces and fail before construction. This decision does not
promise automatic traversal across a small neighboring face or success for oversized distances.

## Evidence

The installed Replicad 0.23.1 / replicad-opencascadejs 0.23.0 native WASM build produces valid conical
chamfers with distance `d` along the cylindrical axis and distance `d` radially along the plane.
The circular-rim kernel matrix covers inner/outer and top/bottom rims of a tilted, translated annulus
at two distances. Independent analytic removed volumes are:

- outer radius `R`: `pi * (R * d² - d³ / 3)`;
- inner radius `r`: `pi * (r * d² + d³ / 3)`.

Tests assert both resulting circular boundaries, native validity, volume and unchanged source
topology. Engine cases retain exact body-bound references, check three distances and selected-face
expansion, and reject curved Tangent/directional modes and periodic seams. Fault-injection tests
verify disposal on native Add, Build and incomplete-result failures for both planar and circular
paths. Existing planar directional and native contour tests remain required.

## Consequences

UI and MCP may admit this exact subset without relabeling another measurement mode or silently
downgrading authored intent. Catalogue geometry classes can reject clearly unsupported pairs; exact
native incidence and closedness remain authoritative in the worker. Other curved cases need their
own measured setbacks and failure corpus before this boundary expands.
