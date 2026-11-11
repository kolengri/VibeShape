# ADR-0149: Rounded-opening edge treatments

- Status: Accepted
- Date: 2026-11-04
- Partially supersedes: the open-arc restriction in [ADR-0121](0121-circular-offset-chamfer.md)
- Compatibility-route bound and scope-switch defaults superseded by:
  [ADR-0150](0150-chamfer-authoring-route.md)
- Fillet schema note superseded by: [ADR-0151](0151-body-bound-variable-radius-fillet.md)

## Decision

Extend equal-distance Offset Chamfer V3 to exact circular edges between one plane and one cylinder,
including trimmed corner arcs. The existing exact two-face incidence check remains authoritative.
A circular plane/cylinder intersection is orthogonal whether the edge is closed or trimmed.
Curved Tangent measurement, asymmetric curved modes and other curved face pairs remain unsupported.

New UI chamfers with body-bound topology enable native tangent propagation by default. One selected
edge seeds its complete tangent contour, including the straight and circular sections of a rounded
opening. Users can disable propagation explicitly; an incomplete native contour is then rejected.
Existing saved V1/V2 features and V3 propagation choices retain their authored semantics. MCP callers
continue to supply their explicit propagation choice through the existing contract.

Preserve new selected-edge chamfers on verified single-result bodies with a closed circular
cone/cylinder transition through the existing V2 path. This compatibility route requires enabled
native propagation, equal-distance Offset, losslessly represented edge selections and no side-face
or directional intent. Mixed selections may include the supported planar and plane/cylinder subset.
Choose the route before validation; never retry a failed V3 operation through V2. Saved edits,
named or multiple outputs, face targets and explicit propagation opt-out remain on their existing
routes. This does not broaden V3 measurement support to cone/cylinder transitions.

Fillet already follows native tangent contours from one selected edge. No Fillet schema or kernel
behavior changes are required. Neither operation broadens selection to unrelated contours or all
body edges, and neither substitutes a smaller size for an unbuildable requested size.

## Evidence

Real-kernel rounded-opening fixtures cover one straight seed, one circular-arc seed and two straight
seeds. They verify valid single solids, independently calculated full-perimeter removed volumes for
3 mm chamfers and fillets, and unchanged source topology. Existing partial-contour rejection,
unsupported cone/cylinder transitions, directional controls and temporary-resource tests remain
required. UI tests cover the new default, explicit opt-out, retained saved intent and exact references.
