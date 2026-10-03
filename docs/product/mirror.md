# Origin-plane Mirror

Mirror v1 reflects one exact named body across the XY, XZ or YZ world-origin plane.
Select an available visible part in Parts, then choose Mirror. The task panel previews a disposable
candidate. Apply adds one feature and one Undo entry; Cancel leaves document intent unchanged.
Click the Mirror feature in History to edit its plane.

The reflected result replaces the current authored part while preserving its PartId, name, visibility
and source body history. Source features remain available to rebuild dependents. Mirror does not
keep a second source part or fuse source and reflection. Suppression or removal restores the prior
body binding through the existing modifier policy.

The persisted feature has exactly one `targetBody` (`BodyReference`) and one matching producer
dependency, no topology references, and a canonical plane. Its result role is `result` and contains
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
