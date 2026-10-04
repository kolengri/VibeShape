# ADR-0081: Constrained Loft native patch networks

- Status: Accepted bounded kernel and authored-data contract
- Date: 2026-10-04
- Extends: [ADR-0079](0079-exact-sweep-hollow-loft-and-sketch-corners.md)

## Context

OCCT ThruSections accepts ordered section wires and one global continuity setting. It cannot express
independent start/end support faces or named interior guide curves. Persisting those fields while
ignoring them in geometry would misrepresent authored intent. Existing Loft versions must replay with
their established section and hole correspondence semantics.

## Decision

Add Loft version 3 to the existing Part Design owner. Keep versions 1 and 2 unchanged. Use the existing
OCCT BRepOffsetAPI_MakeFilling, exact analytical sketch edges, sewing, and solid construction. Do not
introduce a second geometry solver or replace a B-Rep with a sampled mesh.

The bounded contract accepts 2–24 hole-free sections with 3–64 matching open outer segments. Every
segment track explicitly names its entity and directed start-point UUID in every ordered section.
Matching uses authored identity, never native edge indices, proximity, or sorted positional pairing.
Closed circles and ellipses need an explicit seam contract and are excluded from version 3. Version 2
continues to handle profiles with holes.

Named C0 guides constrain one segment patch. Optional rails connect explicitly matched vertex tracks;
otherwise exact straight rails connect the first and last vertices. Intermediate section curves are
native C0 constraints. Each patch spans the first and last sections so independent end conditions
constrain the same generated surface. Duplicate, missing, unused, or out-of-range tracks fail closed.
The combined analytical curve budget is 2,000 and the producer dependency budget is 128.

Each optional start/end condition supplies its segment track, G1 or G2 order, and an exact BodyFaceRef.
The document worker schedules section, rail, and guide sketch owners and support-body owners. Prepared
end conditions replace the producer UUID with a canonical input slot and retain the named body role and
stable topology signature. One producer may select one body role under this contract. Support bodies
are borrowed dependencies and remain independently owned outputs.

Resolve support faces through the existing strict application body-face resolver and the current
native topology snapshot. Copy support faces before native pcurve operations. An entire section edge
must lie on its bounded support face. Planar supports receive OCCT's exact plane pcurve; curved supports
require one uniquely matching full existing native boundary edge with a stored pcurve. Missing,
ambiguous, changed, partial, or unavailable support topology fails construction.

## Native continuity and validation

MakeFilling uses bounded resolution (50 points, five iterations), degree 3 for G1 or degree 4 for G2,
and approximation limits of degree 12 and 128 segments. A planar or cylindrical support supplies its
exact native initial surface when available; those analytic surfaces have the orthogonal local UV
derivatives required by LoadInitSurface. Other supports retain the bounded planar initialization.
Construction distance tolerances are 1e-9 mm; acceptance
remains 1e-7 mm C0, 1e-5 radians G1, and 1e-4 inverse millimeters G2.

Native filling error reports are necessary but insufficient: an independent probe found guide
residuals between the builder's samples even when its reported G0 error passed. Each authored section,
rail, and guide edge therefore receives nine native curve samples. Native nearest surface projection
and trimmed-face distance enforce C0. Native D2 derivatives enforce end normals and normal curvature in
three common tangent directions, without assuming equal surface parameters. This is bounded numerical
validation of OCCT geometry, not a replacement construction algorithm. Continuous whole-curve error
certification is not claimed.

The published replicad-opencascadejs 0.23.0 binding throws for public GeomAbs_G2 (enum value 3) in
MakeFilling. The official OCCT source forwards that enum to a GeomPlate derivative-order argument that
accepts only 0–2. The observed package behavior is consistent with that source path; the published
package does not expose its precise OCCT revision. A kernel-scoped mapping sends integer order 2 via
its enum carrier GeomAbs_C1. The application contract remains geometric G2, verified against the real
support's native curvature. The mapping requires exactly the pinned package version and expected enum
values. Controlled or changed builds fail this G2 mapping until independently verified; they must not
silently downgrade the requested order.

Sewing must produce a closed manifold shell without free or multiple edges. Orientation and native
validity must yield one positive-volume solid. All temporary native objects, surface jets, projections,
support copies, and acquired face wrappers are released on success and failure. Native failures retain
an actionable geometry diagnostic. Nonconverging constraints are rejected: the tested 1 mm guide
excursion does not satisfy this pinned builder's strict residual policy, while smaller guide and mixed
G1/G2 end constraints produce a measurable changed solid.

Positive G2 evidence covers planar faces and a radius-2 mm quarter-cylinder with matching complete
native boundary pcurves and independent G2 at both ends. The cylinder's exact initial surface resolves
the former planar-initialization failure without changing resolution or acceptance tolerances. Native
nearest projection and independent D2 principal curvature checks verify 0.5 inverse millimeters at
both ends, and the resulting closed solid has volume 10π cubic millimeters. OCCT's LocalAnalysis G2
error also measures curvature in inverse-length units. This evidence does not guarantee convergence
for arbitrary curved supports or certify continuous whole-edge curvature agreement.

## Evidence and integration boundary

Contract and document-worker tests cover explicit correspondence, dependency slots, named support
roles, semantic inputs, and source immutability. Real kernel tests check guide positions through native
nearest projection, end normals and curvature through native D2, manifold validity, volume change,
independent G1/G2 ends, missing-face failure/retry, cache reuse, and native ownership/disposal.

The Loft task panel and named local/paired remote create_loft/update_loft adapters expose the complete
version-3 contract. Directed correspondence and current support faces require explicit selection;
unmatched authored supports retain visible repair controls. Optional bounded native diagnostics pass
through the evaluation port to disposable preview. Existing version-1/version-2 replay and hollow
version-2 editing retain their established behavior. Operator instructions and their generated bundle
share these contracts.

## Primary sources

- [OCCT MakeFilling API](https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_filling.html)
- [OCCT nearest surface projection API](https://occt3d.com/dev/doc/refman/html/class_geom_a_p_i___project_point_on_surf.html)
- [OCCT BRepAdaptor_Surface derivatives](https://occt3d.com/dev/doc/refman/html/class_b_rep_adaptor___surface.html)
- [OCCT V7_9_2 BRepFill_Filling AddConstraints](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_9_2/src/BRepFill/BRepFill_Filling.cxx)
- [OCCT V7_9_2 BRepFill_CurveConstraint derivative-order contract](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_9_2/src/BRepFill/BRepFill_CurveConstraint.cxx)
- [OCCT V7_9_2 MakeFilling initial-surface requirements](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_9_2/src/BRepOffsetAPI/BRepOffsetAPI_MakeFilling.hxx)
- [OCCT V7_9_2 LocalAnalysis G2 curvature metric](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_9_2/src/LocalAnalysis/LocalAnalysis_SurfaceContinuity.cxx)
