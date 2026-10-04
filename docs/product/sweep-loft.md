# Sweep and Loft

Finish the source sketches before opening **Loft** or **Sweep** from the Model toolbar or command
palette. The task panel selects stable profile boundaries and authored path entities from the current
solved sketch display. It also includes profiles from hidden sketches without changing their visibility.
Editing excludes sketches after the feature in History to prevent forward dependencies.

Use **Create sketch** with an XY, XZ, or YZ origin plane, or select an existing datum plane's face in the
viewport before creating the sketch. Its History row opens the plane's edit task. A datum plane's
signed offset gives each section its explicit support frame.
Neither feature moves or rotates the source sketches to make a preview succeed.

## Loft

Add two to twenty-four distinct closed sections within the 2,000-curve aggregate budget. The list
order defines the loft; use the explicit earlier, later, and removal actions to change it. **Ruled**
selects straight interpolation between sections.

For profiles with holes, add an explicit hole track and select one stable hole boundary in every
ordered section. Every section must have the same number of holes, and every hole must occur exactly
once. Reordering sections preserves their chosen track columns. Version 2 stores this correspondence;
version 1 retains its hole-free replay. Editing version 2 to hole-free sections clears its tracks and
preserves version 2 with an empty correspondence array.

Holes must remain entirely inside the outer solid and must not cross other tracks. Degenerate or
incompatible sections fail native preview. Enable **Curve constraints (Loft v3)** for the separate
[exact native patch contract](../adr/0081-constrained-loft-native-patch-networks.md). Add one track for
every outer segment and explicitly select its directed start vertex in every section. Reordering
sections preserves their cells; inserted sections remain unassigned. Optional rails select a vertex
track and saved path. Named guides select a segment track and a saved C0 path. Independent start/end
constraints select a segment track, G1 or G2, and an exact face from a named earlier body. Unavailable
authored faces remain visible and require explicit reselection.

Version 3 requires matching hole-free open-segment boundaries, three to sixty-four tracks and a smooth
(non-ruled) surface. Complete circles/ellipses need a separate seam contract and remain available
through version 1/2. Native convergence is bounded. Planar and cylindrical G2 supports have positive
native derivative checks, including nonzero cylinder curvature at both ends. Curved supports require
matching complete native boundary pcurves; arbitrary curved-surface convergence is not guaranteed.
Larger guide excursions can also fail.
The task panel exposes the native support or residual failure and retains the input for repair;
constraints are never silently removed to make a preview succeed.

## Sweep

Choose one closed profile, including its authored holes, then a saved path sketch and its analytical
line, circular-arc, cubic Bezier, or bounded elliptical-arc entities. Select the path start point explicitly. Changing path sketches clears
the selected curves and direction. The chosen entities persist in canonical ID order; the start point
owns traversal direction independently of that ordering.

The selected curves must form one open, connected, G1-continuous path. The profile origin must already
coincide with its start and the profile plane must be normal to the start tangent. The start picker
lists selected curve endpoints; an interior endpoint or the wrong end fails exact native preview.
Construction curves and unsupported curve types are excluded from the path picker.

## Lifecycle and automation

The preview is disposable and Apply remains disabled until the complete exact native preview is ready.
A failed preview leaves the task open for repair. Cancel removes the preview and preserves the committed
document. Apply creates one ordinary transaction; editing a History row retains the feature identity,
section order, profile boundaries, path direction, and authored part allocation. Undo/Redo and native
Save/Open use the shared document lifecycle. Each successful feature produces one independently owned
part available for selected-part STEP export and downstream features.

The paired local MCP tools `create_loft`, `update_loft`, `create_sweep`, and `update_sweep` stage the same
strict schema-backed records in an owned draft. Local and paired remote Loft adapters accept v1
`sections`/`ruled`, v2 `holeCorrespondence`, and v3 `outerCorrespondence`, `rails`, `guides`, `start`,
and `end`. Version 3 includes support body owners after the section/rail/guide sketch owners, within
its 128-producer budget; v1/v2 remain limited to 24 producers. Sweep
supplies `profile` and a durable `path` with its sketch ID, sorted unique entity IDs, and explicit start
point ID. Sketch support and external-reference owners must match the authoritative dependency and
topology-reference order. Fresh command IDs and current draft revisions, preview, and ordinary commit
are required; these tools add no document authority or automatic profile repositioning.
