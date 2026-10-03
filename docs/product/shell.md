# Shell v1

Select a part, choose **Shell**, enter a positive wall thickness, and select the faces to remove from the catalog. Face areas and world-space centers identify the opening faces. **Inward** preserves the original outer surface; **Outward** preserves the original inner surface. Sharp intersection joins form the wall corners.

The disposable preview contains one valid solid. Apply replaces the current body of the same authored part and retains the source history. Cancel discards the preview. Editing, undo/redo, local reopen, native `.vshape` archives, and ordinary body exports use the existing feature lifecycle.

Each opening is a stable BodyTopoRef v1 bound to an exact feature output role. Shell stores the source content hash with those references. Any source-content change invalidates the openings; Shell never silently rebinds them. Edit the Shell and explicitly reselect all opening faces against current exact source geometry. Missing, ambiguous, changed, or duplicated faces fail closed. Repair the source first when its geometry is unavailable.

Shell v1 accepts 1–64 removed faces, one exact source solid, and a thickness up to 100,000 mm. OCCT may reject a thickness or topology that cannot produce one valid positive-volume solid. This is reported as a failed preview and cannot be applied. Native face indices and candidate IDs are never persisted. Viewport face picking and automatic topology repair are outside this version.

Named local MCP `create_shell` and `update_shell` use the revision-bound draft command path. Call `model_body_topology` for the selected exact output, project stable BodyTopoRef v1 face references, and supply the returned source content hash. Stale evidence requires explicit reselection.

The persistence and ownership contract is recorded in [ADR 0058](../adr/0060-persisted-body-bound-shell-openings.md), building on [body-bound inspection](../adr/0051-body-bound-topology-inspection.md) and [constituent body identity](../adr/0049-constituent-body-identity-and-solid-patterns.md).
