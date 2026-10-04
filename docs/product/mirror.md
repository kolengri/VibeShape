# Mirror

Mirror v1 reflects one exact named body across the XY, XZ or YZ world-origin plane.
Select an available visible part in Parts, then choose Mirror. The task panel previews a disposable
candidate. Apply adds one feature and one Undo entry; Cancel leaves document intent unchanged.
Click the Mirror feature in History to edit its plane.

Version 2 adds a signed plane offset and **Keep source part**. The offset follows +Z for XY, +Y
for XZ, and +X for YZ. Keeping the source creates an independent reflected part and retains the
original for further modeling. Version 3 retains these options and also supports an authored Datum Plane, a stable planar face on an exact named body,
or an explicit world origin and normal. **Reference source** lists current earlier supports;
**Use selected planar face** binds the viewport selection. Explicit coordinates use millimeters
and the direction fields are normalized. Invalid or ambiguous supports block Apply. The supporting
body remains available; a replacing operation consumes only the exact target part. Version 1 origin-plane records retain their
existing semantics. See [ADR-0084](../adr/0084-body-reference-planes-and-axes.md).

The reflected result replaces the current authored part while preserving its PartId, name, visibility
and source body history. Source features remain available to rebuild dependents. **Keep source part** instead leaves the original available and allocates a new part for the reflected
result. Source and reflection remain separate until an explicit Union. Suppression or removal restores the prior
body binding through the existing modifier policy.

The persisted feature has exactly one `targetBody` (`BodyReference`), its matching producer dependency,
and any distinct reference support producer in that order. Stable body topology stays in parameters;
generic topology references remain empty. Version 3 content carries a resolved numeric plane, signed offset, and source-retention intent. Its result role is `result` and contains
one valid positive-volume solid. Dependency hashes and exact output roles own source identity;
document-local UUIDs do not enter canonical parameters. Missing roles and stale source content fail
closed. Ordinary local save, reopen, native project import/export, STEP and STL export reuse the
registered feature and existing document paths.

The local MCP tools `create_mirror` and `update_mirror` author the same registered feature in an
owned draft at its current revision. Read the exact body role, preview the draft, then use the existing
browser Apply/Discard commit workflow. They grant no additional document or filesystem access.

Native evaluation uses the pinned OCCT `gp_Ax2_3`, `gp_Trsf.SetMirror_3` and
`BRepBuilderAPI_Transform_2(source, transform, true)` copy path. Replicad's receiver-consuming
`Shape3D.mirror()` is deliberately avoided. All acquired temporary native bindings are disposed and
the source cache entry is preserved. This extends the contracts in
[ADR-0055](../adr/0055-trusted-exact-body-placement.md),
[ADR-0057](../adr/0057-trusted-body-compound-and-union.md) and
[ADR-0051](../adr/0051-body-bound-topology-inspection.md).

Focused tests cover strict schemas, canonical body identity, PartId continuity and suppression,
all three asymmetric reflected bounds, volume, source isolation, upstream rebuild, missing-role and
stale-hash rejection, native failure cleanup, exact preview, Apply/Cancel, pending submission, retry,
MCP discovery and STEP/STL export. The browser workflow also covers Undo/Redo, reload and native
archive reopen; its execution is a separate acceptance check from unit/kernel results.
