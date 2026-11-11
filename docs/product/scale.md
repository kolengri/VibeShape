# Scale

Select a part, choose **Scale**, enter a factor, and choose the fixed center. The factor is unitless,
accepts expressions and `#variables`, and must be between 0.001 and 1000; volume changes by the factor
cubed. The center is the part's bounding-box center (the default), the world origin, or an explicit
point with unit-aware coordinates within ±100,000 mm. The center stays fixed while the part grows or
shrinks around it.

The disposable preview contains one valid solid. Apply replaces the current body of the same authored
part and retains its history; Apply is disabled while the preview evaluates and runs once per click.
If the source body's feature is deleted while Scale is retained, opening Scale offers an earlier
replacement body; the factor and center are kept.
Cancel discards the preview. Editing, Undo/Redo, native `.vshape` reopen, and exports use the
ordinary feature lifecycle. Scale works on named outputs such as Split or Pattern bodies.

Scale is uniform. Non-uniform scaling needs `BRepBuilderAPI_GTransform`, which the pinned
OpenCascade WASM build does not include. Scale results publish no semantic or lineage face
identities, so every downstream face reference to a scaled body is an exact signature match, and
changing the factor requires reselecting those faces.

Named local MCP `create_scale` and `update_scale` use the revision-bound draft command path with one
matching body dependency and no topology references.

The design is recorded in [ADR-0152](../adr/0152-draft-and-uniform-scale-features.md).
