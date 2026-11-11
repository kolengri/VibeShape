# Body Pattern

Select an available part in Parts and choose **Pattern**. The task retains that exact current body
reference, including its semantic output role. Choose Linear or Circular, an X, Y, or Z axis, and a
scalar instance count from two to 256, including the seed. Count accepts expressions and document
variables. Switching kinds preserves the buffered spacing, angle, and center values.

Version 2 additionally accepts a Datum Plane frame axis, a stable straight edge on an exact named
body, or an explicit world axis. **Reference source** lists current earlier geometry. Datum frames
offer X, Y and normal axes. Explicit origins use millimeters and direction fields are normalized.
Circular Pattern uses the chosen axis origin as its center; linear placement uses its direction.
Missing or ambiguous edge references and zero directions block Apply. Supporting bodies remain
available, and version 1 axis and variable-driven circular-center semantics are preserved.

Version 3 adds the **Path** kind ([ADR-0156](../adr/0156-path-pattern.md)). Choose a saved path
sketch, its curves and a start point, or toggle curves by clicking them in the viewport; the
viewport's keyboard picker and the panel's curve list are equivalent. A path is one connected
tangent-continuous chain of lines, circular arcs, cubic Beziers or elliptical arcs, open or closed,
or a single circle. Elliptical arcs are chosen from the panel list. An open path starts at the
chosen endpoint, a closed chain at the chosen joint, and a circle at the sketch +X direction from its
center. Closed paths run counterclockwise about the sketch normal; **Reverse direction** starts an
open path from its other end and runs a closed path clockwise. Corners, branches and disconnected
curves fail preview.

The seed stays where it is. The path point at **Start offset**, an arc length from the path start,
is the seed's reference, and every instance keeps the seed's offset from its own path point.
**Fit to path** spreads open-path instances from the offset to the path end, end included, and
divides a closed path's length by the count. **Fixed distance** steps by an arc-length distance;
spacing that runs past an open path's end, wraps a closed path back onto the seed, or an offset at
least the path length fails with the required and available lengths. **Keep seed orientation**
translates copies. **Follow path** also turns each copy about the sketch normal by the tangent
turn from the reference point, a rotation-minimizing frame for planar paths. Count, distance and
offset accept expressions and variables. Editing a version 1 or 2 pattern keeps its version unless
Path is chosen.

Linear Pattern uses a signed nonzero spacing between instances. Spacing and total displacement are
bounded to 100,000 mm. Circular Pattern uses a signed nonzero total angle of at most one revolution
and explicit X, Y, and Z center coordinates. Partial patterns include the angular endpoint. A full
revolution divides the turn by the count and excludes the duplicate endpoint. Centers are authored
positions; choosing a center never repositions the seed. Length and angle expressions use project
display units when entered without a suffix. Count remains dimensionless.

Preview is disposable and requires one valid exact source solid. Invalid counts, dimensions, zero
spacing or angle, and out-of-range extents block Apply with repairable field diagnostics. Failed native
preview leaves the task open. Cancel preserves the committed document, and Apply makes one ordinary
transaction. A rejected save releases its submission lock so the same intent can be retried.

Output roles are `pattern.instance.0` through `pattern.instance.{count - 1}`. Instance zero continues
the seed part with its name, visibility, and preceding body history. Every additional instance owns a
stable independent part ID and root history. Editing preserves instance roles and surviving metadata;
count changes allocate or remove parts atomically through domain authority. A variable edit that cannot
produce a valid integer count is rejected without leaving a partial document update. Historical seeds
fork rather than consuming a later current body. A selected instance can be placed or exported
independently. Feature-only modifying pickers exclude Pattern because it has several named outputs.

Open the Pattern's History row to edit it. Count source expressions, signed spacing, axis, angle, and
center survive edit, Undo/Redo, reload, and native Save/Open. Selected-part STEP export uses the chosen
instance's current exact body reference.

The local and paired remote MCP tools `create_body_pattern` and `update_body_pattern` retain version 1 in
an owned draft. Supply the exact `targetBody`, its sole matching dependency, empty topology references,
`kind`, `axis`, scalar quantity `count`, and either length quantity `spacing` or angle quantity `angle`
with explicit length-quantity `center`. Fresh command IDs, current draft revisions, exact preview,
and ordinary commit remain required. MCP adds no document authority or instance-fusion behavior.

The additive `create_reference_body_pattern` and `update_reference_body_pattern` author version 2
with the shared reference-axis contract. Circular center comes from the axis; legacy center fields
are omitted. Declare the target producer first followed by any distinct support owner, with empty
generic references. Stable body-bound LINE references come from current body topology inspection;
caller content hashes and native indices are not accepted. Missing or ambiguous supports fail closed.

The same two tools author version 3 when `kind` is `path`: supply the path selector, `spacing`,
`startOffset`, `orientation` and `reverse`, and declare the target producer first, followed by the
path sketch's support and external owners. Preview reports missing curves, corners and overruns.
