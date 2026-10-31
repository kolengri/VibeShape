# Connect Mounts

**Connect Mounts** builds one editable exact CAD solid between 2–16 mounting locations. It is a
geometric starting shape, not a load-aware topology optimizer or a structural-strength assessment.
The existing Generative Design and Lightweighting workflows remain the owners of numerical analysis.

## Editor workflow

Open **Connect Mounts** from the Part Design toolbar or command palette. Enter point coordinates,
add or remove rows, or select an existing exact body's face center to copy into a point row. The
picker copies coordinates; changing the source face later does not move the connection point.
All numeric inputs, including radii and expressions using variables, are captured as evaluated
millimeter values. Formulas and variable dependencies are not retained.
Set radii and connection mode, inspect the disposable preview, then Apply. Cancel leaves the
saved model unchanged. Open the saved feature from History to edit the same parameter record.

## Construction

Set each point in model millimeters, the spherical node radius, the cylindrical strut radius, and
one connection mode:

- **Tree:** a deterministic Euclidean minimum spanning tree connects all points with the minimum
  total centerline length among trees over those points. This does not minimize solid volume or
  optimize stiffness.
- **Complete:** every pair of points is connected. This adds bracing but does not establish strength.

Node radius must be at least strut radius. Radii and point separation must be at least 0.001 mm;
node extents must fit within ±99999.999 mm on every axis, reserving 0.001 mm for kernel tolerance
inside the ±100000 mm workspace.
Preview uses the geometry worker and must produce one valid positive-volume solid before Apply.
Changing inputs invalidates the disposable preview. Apply creates one authored feature and one Undo
entry; editing that feature recomputes its geometry and ordinary downstream operations.

Point coordinates are captured values, not associative references to source mounting faces. The
feature does not union existing mounting bodies, preserve their interfaces, infer hole diameters,
avoid neighboring parts, add tangential surface blends, or route around obstacles. Spherical nodes
and straight struts may intersect other geometry. Add actual mounting holes, interface bodies,
clearance cuts, or fillets through the existing CAD tools, then inspect the final solid.

The exact solid supports ordinary downstream modeling, native project persistence, and STEP/STL/3MF
export. Manufacturing settings and physical-fit acceptance remain separate.

## Agent workflow

Local and paired remote MCP share `create_connect_mounts` and `update_connect_mounts`. Both accept
an owned draft's ID/revision, fresh command ID, feature ID, label, explicit suppression, and the same
validated parameters as the editor. The feature accepts no caller-supplied actor, document, dependency,
or topology-reference arrays. Preview and commit retain the session's ordinary CAD approval policy.

Example `parameters` (all lengths and coordinates are millimeters):

```json
{
  "points": [[0, 0, 0], [40, 0, 0], [20, 30, 10]],
  "nodeRadius": 5,
  "strutRadius": 2,
  "connectionMode": "tree"
}
```

Read mounting geometry with current inspection tools before choosing coordinates. Inspect exact
preview bounds, volume and body count before committing. Update the existing feature ID for a
correction; do not append a replacement. Re-read the saved feature and model state after commit.
Live MCP discovery is authoritative: running an older editor/server does not expose these tools.
