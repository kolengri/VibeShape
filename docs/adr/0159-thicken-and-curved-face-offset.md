# ADR-0159: Thicken and curved-face offset

- Status: Accepted
- Date: 2026-11-11

## Context

Faces of an existing solid could be moved only through planar Press Pull, which sweeps a planar face
along its normal and fuses or cuts the swept prism. There was no way to build a solid of uniform
thickness from a patch of faces, and curved faces (cylinders, cones, spheres, tori) could not be
offset directly. Both operations need the established body-bound face reference, worker, preview,
history and MCP contracts rather than a parallel path.

The pinned `replicad-opencascadejs` 0.23.0 WASM build exposes `BRepOffsetAPI_MakeOffsetShape`
(`PerformBySimple`, `PerformByJoin`), `BRepOffsetAPI_MakeThickSolid` (`MakeThickSolidBySimple`,
`MakeThickSolidByJoin`), `BRepBuilderAPI_Sewing`, `BRepBuilderAPI_MakeSolid`, `ShapeFix_Solid`,
`ShapeUpgrade_UnifySameDomain`, `BRepLib::OrientClosedSolid`, `BRepAdaptor_Surface` (with second
derivatives), `TopoDS_Builder` and the Boolean builders. It does not bind `BRepOffset_MakeOffset`
(the `MakeOffset()` accessor returns an unbound type), `BRepOffset_MakeSimpleOffset`,
`BRepAlgoAPI_Defeaturing`, `BRepTools_ReShape`, `BRep_Builder`, `LocOpe`, `BRepFeat_MakePrism`,
`ShapeAnalysis_FreeBounds` or `BRepClass3d_SolidClassifier`.

## Investigation

Throwaway kernel probes against the pinned build established the following before any feature code
was written. Volumes are compared with analytic values.

1. **Simple thick solid of the selected faces** (`MakeThickSolidBySimple` on one face, or on a shell
   of the selected faces assembled with `TopoDS_Builder`). Exact for single planar and cylindrical
   faces (10 × 20 face by 2 mm: 400; radius 5 cylinder side by ±2 mm: 753.98 and 502.65) and close
   for a hemispherical cap (relative error about 6e-6). The solid comes back inside-out for offsets
   along a forward face's normal, so it is reoriented with `BRepLib::OrientClosedSolid`. Across a
   sharp edge between selected faces it reports a "valid" solid whose gap is hidden by an edge
   tolerance of about 2.8 mm for a 2 mm offset; an edge-tolerance bound rejects it. A complete sphere
   face with degenerate pole edges fails.
2. **Joined thick solid of the body** (`MakeThickSolidByJoin` on the source with every non-selected
   face as a closing face, `GeomAbs_Intersection`). Exact across sharp edges (box top and side
   thickened 2 mm outward: 680 = 400 + 200 + the 80 corner extension) and for the conical face of a
   frustum, whose planar caps extend to the offset cone. It fails ("not done") when one face is kept
   and its neighbours are themselves adjacent closing faces: a box top alone, a cylindrical boss on a
   plate, a hole wall, a dome on a plate. For an inward offset larger than a cylinder's radius it
   returned a *valid* solid with the unchanged source volume, and for a hole wall it returned an
   invalid solid. Neither result may be trusted without a curvature guard and validity checks.
3. **Topology sharing.** A slab that shares the selected face's TShape with the body, or with the other
   half of a symmetric slab, breaks the Boolean that combines them (fuse produced no solid). Copies
   through `BRepBuilderAPI_Transform(copy=true)` fix this, but `ModifiedShape` returns the copied face
   as FORWARD, so a REVERSED face (a hole wall) silently offset into the material until its body
   orientation was restored.
4. **Curved-face offset by slab and Boolean.** Adding (positive distance) or cutting (negative) the
   slab between a face and its offset reproduces an exact offset whenever the neighbouring faces
   continue along the slab's side walls. The simple slab has walls along the boundary normals, which
   coincide with neighbours that meet the face at right angles: boss radius 5 → 6, 4 and 0.5; a hole
   narrowed by 1 mm; a hemispherical dome on a plate grown by 1 mm. The joined slab has walls on the
   extended neighbour surfaces, which covers neighbours that extend along their own surfaces: the
   frustum cone offset by ±0.5 mm matches the analytic frustum. When neither holds, the Boolean leaves
   a step: the unified face count of the result differs from the source (frustum cone with the simple
   slab: 3 → 5 faces; a cylinder blending tangentially into a hemisphere: no accepted slab).

A general per-face offset in which arbitrary neighbours extend or trim (OCCT's `BRepOffset_MakeOffset`
with per-face offsets, or a remove-and-rebuild through `BRepAlgoAPI_Defeaturing`/`BRepTools_ReShape`)
is not possible with the bound modules.

## Decision

**Thicken** (`org.vibeshape.feature.part-design.thicken` schema 1) is a first-party Part Design solid
feature. It persists the exact target body, 1–256 unique body-bound faces of that body in selection
order, an expression-capable thickness from 0.001 to 10,000 mm, a side (`outward` along the outward
face normals, `inward`, or `symmetric` with half on each side) and an operation. `new` keeps the
source body visible and unconsumed and adds a separate body, like Mirror with a preserved source;
`add` and `remove` fuse or cut the thickened region with the source and replace that part. An Add
whose region lies inside the body, or a Remove whose region lies outside it, fails instead of
producing an unchanged body.

The worker resolves each face through the shared exact/durable body-face resolver (now shared with
Draft) and then:

- requires one edge-connected patch and names the first detached face;
- rejects an offset that reaches the smallest principal curvature radius on the concave side, sampled
  on a 9 × 9 parameter grid of every selected curved face from `BRepAdaptor_Surface::D2`;
- builds each signed offset slab from its own deep copy, trying the simple thick solid first (walls
  along the boundary normals, accepted only within an edge-tolerance bound) and the joined thick solid
  second (faces meeting at sharp edges extend to intersect; free walls follow the neighbouring
  faces);
- fuses the two halves of a symmetric slab, applies the operation, and requires one valid
  positive-volume solid.

Every selected face is thickened or the feature fails with an actionable message; none is skipped.

**Press Pull version 2** (`org.vibeshape.feature.part-design.press-pull` schema 2) keeps the version 1
parameters and lifts the planar-only restriction. Planar faces use the unchanged version 1 prism path,
so results are identical. A curved face is moved by adding or cutting the simple or joined slab, and
the result is accepted only when the unified face count is unchanged, i.e. every neighbour stays
attached; otherwise the feature fails closed with a message that suggests Thicken. The same concave
curvature guard applies. Saved version 1 features stay planar-only; new UI and MCP features are
version 2.

Thicken and Press Pull version 2 forward their kernel messages to the task panel. Thicken has a task
panel with shared Draft/Shell face picking, a new colored icon, toolbar, context-menu and palette
commands, History icon and missing-body repair (faces must be picked again on a replacement body, as
for Draft). MCP gains `create_thicken`/`update_thicken` and `create_press_pull`/`update_press_pull`
over the ordinary draft path.

## Consequences

- Native face indices, hashes and candidate IDs are never persisted; a lost face requires
  reselection. Thicken and curved Press Pull results publish no semantic roles, so downstream face
  references to them are exact signature matches.
- Sharp-edged Thicken selections use the joined construction, whose free walls follow the
  neighbouring body faces instead of the boundary normals. For neighbours perpendicular to the
  selection the two coincide.
- Curved Press Pull covers neighbours that meet the face at right angles or extend along their own
  surfaces. Tangent neighbours (for example fillets and blends around the face) are rejected; Thicken
  with Add or Remove is the alternative. Curvature sampling can miss a sharp local peak on a freeform
  face; OCCT validity checks remain the final guard.
- Binding `BRepOffset_MakeOffset` (with `SetOffsetOnFace` and the thickening flag) or
  `BRepAlgoAPI_Defeaturing` in a future WASM build would allow a general offset-face operation and
  should supersede the face-count rule.

## Evidence

Real-kernel tests cover thickening a planar face on each side (area × thickness and the expected
extents), the analytic annular volume of a cylindrical face outward, inward and symmetric, a
spherical cap shell, a reversed hole wall, Add and Remove including the rejected no-op, a sharp-edged
two-face patch, the concave-radius failure, disconnected and missing faces, a cylindrical boss radius
change of +1, −1 and −4.5 mm, a narrowed hole, a grown dome, an offset frustum cone, the fail-closed
tangent neighbour and parity with planar Press Pull. Engine tests cover face resolution, a named
Pattern output, forwarded diagnostics with balanced shape ownership on failure, and version 1 versus
version 2 Press Pull. Domain, form, repair, MCP schema/adapter and Chromium end-to-end tests cover
bounds, side and operation modes, expressions, content identity, picking, single-flight Apply, undo and
reopen.
