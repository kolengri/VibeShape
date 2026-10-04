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

The local MCP tools `create_body_pattern` and `update_body_pattern` stage the same strict records in
an owned draft. Supply the exact `targetBody`, its sole matching dependency, empty topology references,
`kind`, `axis`, scalar quantity `count`, and either length quantity `spacing` or angle quantity `angle`
with explicit length-quantity `center`. Fresh command IDs, current draft revisions, exact preview,
and ordinary commit remain required. MCP adds no document authority or instance-fusion behavior.
