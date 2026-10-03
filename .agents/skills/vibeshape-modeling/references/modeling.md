# Modeling contracts and recipes

## Sketches and profiles

Use the advertised entity/constraint schema. Coordinate values are mm and solver seeds, not persistent dimensional constraints. Preserve unaffected entity and constraint IDs when replacing a sketch. Fully constrain geometry when the requested parametric intent requires it; report remaining freedom or conflicts when relevant.

Horizontal/vertical distance constraints are signed: the first point's coordinate minus the second point's coordinate equals the specified value. For a positive X offset from an origin anchor, the positive point is `firstPointId` and the anchor is `secondPointId`. XY coordinates map to world X/Y; preview bounds confirm placement on other planes.

Extrude/Revolve profiles identify the sketch and its boundary entity IDs. Boundary ID arrays must be unique and sorted as required by the schema; polygon winding or storage order is not an identity contract. For an existing complex sketch, full profile/face discovery is not exposed through MCP. Obtain a known authored profile or use visible editor selection rather than guessing one from arbitrary edges.

## Extrude and Revolve

For New/Add/Remove/Intersect, retain explicit dependencies and support references; modifying operations put the target first. Use typed length quantities for extrusion depths and typed radians for Revolve angles. Revolve supports an origin axis, sketch line, or supported stable model-edge reference; check its live schema and preview axis placement.

Independent Extrude extents use the `profiles` contract (even for one profile), `distance`, `secondDistance`, `reversed`, `symmetric`, and `operation`. This selects schema v5. With 10 mm first depth, 3 mm second depth, no reversal, and no symmetry, the solid spans -3 to +10 mm along the normal. Reversal spans -10 to +3 mm. `secondDistance: null` selects one direction. Symmetric requires a null second depth and stores the **total** span split equally about the plane. Enabled depths are at least 0.001 mm; total span is at most 100,000 mm. No starting offset or arbitrary direction is supported by this contract.

## Hole

Use 1–256 stable point IDs from an inspected sketch, a positive typed diameter, and the schema's forward/reverse direction and blind/through-all extent. Supply the target first and, where needed, one distinct sketch-support dependency with its exact support reference.

`parameters.targetBody` selects an exact output role from `model_body_measurements` and must match the first dependency. Preserve it when updating a v2 Hole; omitting it requests legacy whole-feature scope. A newly authored single-solid Extrude has role `result`; there is currently no draft body-measurement tool. For other new draft bodies, do not invent output roles. A through-all cut still has a direction; exact preview must show it reaching the intended body.

## Fillet and Chamfer

Obtain durable resolved selections from `model_edges` or `draft_edges`. `edges` omission means **all edges**; preserve the entire array for a selected treatment. Body topology inspection references are not accepted as treatment selections. Radii/distances are positive mm fields; optional expressions are authoritative. Preserve an existing expression unless the request changes it.

If exact preview fails, inspect diagnostics and the complete treatment record. Correct the requested radius/distance or repair a missing selection through supported inspection; do not silently broaden to all edges. Sequential treatments usually target the prior treatment result, rather than an already consumed upstream solid.

## Variables

Use `model_variables`/`draft_variables` to read names, expressions, evaluated values, and diagnostics. Use `create_variable`, `set_variable_expression`, or `rename_variable` for a targeted edit. Preserve the stable variable ID. A name change must respect the application's expression/dependency rules. Do not overwrite the entire table to change one value. `remove_variable` and `replace_variable_table` need the corresponding requested scope and dependency checks; ordinary CAD auto-apply does not establish approval for every destructive operation.

## Useful construction paths

- **Editable plate:** create a thickness variable; author a constrained rectangular sketch; Extrude New using `#thickness`; create a point sketch for mounting centers; add Hole with the solid as the first dependency. Preview the plate dimensions, thickness, and hole positions before one commit. The local `vibeshape://authoring-guide` contains a complete schema-backed 40 × 24 × 4 mm example; replace its example IDs and revisions with fresh session state.
- **L bracket:** a closed six-line outline through `(0,0), (40,0), (40,4), (4,4), (4,30), (0,30)` gives an L section; extrude to the requested width. Put mounting-point sketches on suitable supported planes and preview each cutting direction. Two sketch-backed Extrudes, with the second Add and target-first dependencies, are another supported construction when appropriate.
- **Change thickness or diameter:** change the existing variable expression or feature parameter, retaining IDs, profiles, scopes, and support. Preview all dependent features; do not rebuild a parallel replacement.

A recipe is design guidance, not a batch tool. Execute actual discovered tools sequentially and use their returned revisions.
