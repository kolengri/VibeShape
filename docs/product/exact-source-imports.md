# Source geometry imports

Import opens a local STEP/BREP/STL/3MF workflow next to Export. Choose a source file, inspect it,
and review the detached preview before Apply. The browser hashes the retained bytes with SHA-256
and sends the retained source to the existing worker. No source URL or remote upload is used.
Local triangle-mesh sources have no fixed geometry-byte or vertex/triangle admission ceiling;
128 inspected outputs and format-specific validity rules remain. Exact-source kernel policies and
public MCP transfer budgets remain separate. See
[ADR-0134](../adr/0134-local-geometry-resource-policy.md).

The detached preview displays inspected geometry with camera navigation only. Its display keys never
become topology references or authored body identities. Apply requires valid inspection and a rendered
preview. Cancel closes the dialog without adding assets, features, or Parts. A changed document requires
inspection again. Inspection and Apply prevent duplicate activation; failed saves preserve the source
for retry, and pending Apply blocks dismissal.

## Exact solids

STEP (`.step`/`.stp`) and BREP (`.brep`) require explicit known source-unit metadata. This metadata is
supplied by the user, not measured file units. STEP reader policy 1 converts declared STEP units to
millimeters; the metadata scale is not applied again. BREP reader policy 1 applies the recorded
source-to-millimeter scale once. The UI preserves this distinction instead of claiming to probe STEP
`FileUnits`.

Exact sources must contain closed positive-volume solids. Open shells, loose faces, malformed
sources, ambiguous coincident solids, and out-of-workspace geometry fail without publishing authority.
Each captured exact output gets a fresh UUID and geometric signature. The domain allocates an
independently owned Part at `import.<output UUID>`. Rebuild matches the immutable manifest without
an enumeration-index fallback. Selected exact imported Parts use ordinary Placement, exact solid
operations, and STEP export.

## Triangle meshes

STL (`.stl`) has no declared units and requires an explicit source unit. The worker scales its
coordinates to millimeters once. 3MF (`.3mf`) uses its declared source units and component transforms;
the UI exposes no unit override. Degenerate triangles omitted by the reader appear as counted warnings.
Empty, malformed and unsupported mesh sources fail before Apply; explicit caller parser budgets
remain enforceable.

Each captured mesh output gets a fresh UUID pinned to its source node key. Its Part uses
`mesh.<output UUID>` and retains triangle-mesh representation through rebuild and native Save/Open.
Imported triangles have no exact solid volume or persistent exact face/edge topology. Display,
selection, names, visibility, print preparation, and STL/3MF export remain available. Placement and
exact solid operations are disabled with an explanation; STEP export reports that an exact solid
is required. Import does not turn meshes into BREP solids.

## Source authority

Apply publishes one ordinary transaction: an explicit V3 texture and V4 source upgrades when needed, the complete source
descriptor and bytes, and an independent imported feature. Undo/Redo restores the whole import, and
native Save/Open carries its source closure. Export and print preparation do not modify the authored
model.

SVG/DXF sketch authoring, assembly inference, standard-parts libraries, physical fit, and independent
external interchange are separate capabilities. See [ADR-0067](../adr/0067-captured-exact-source-imports.md)
for exact reader policies and ownership, and [ADR-0062](../adr/0062-durable-source-assets-and-portable-closure.md)
for portable source authority. Browser acceptance and integrated review are separate from form and
contract test evidence.
