# Modeling contracts and recipes

## Choose a construction

Recover design intent rather than tracing tessellation. Identify straight, circular and rotational regions, repeated geometry, openings and protected interfaces. Use a small number of dimensioned profiles and features when they reproduce the requested shape. Prefer line/arc profiles over dense sampled boundaries for analytical geometry; use additional Loft sections only where the shape or an agreed error bound requires them.

For an elongated enclosure, consider Extrude for the straight section, Revolve for rotational ends, and Mirror for genuinely symmetric regions. Join the exterior into one solid, then use Shell when the intended interior is a constant-thickness offset with selected openings. Model holes, lips, reinforcements and asymmetric ends separately. A simple planar capsule may need only one outline Extrude and Shell. Neither recipe establishes that an arbitrary source mesh has constant thickness or symmetric ends.

Compare outer and inner sections before choosing Shell for a reconstruction. Use explicit inner profiles and subtraction when variable thickness, mating surfaces or exact source geometry cannot be reproduced by Shell, or when exact Shell preview demonstrates a kernel limitation. Preserve an authored interior instead of replacing it with a convenient uniform wall. State the specific reason for a more complex construction; a missing tool at an earlier connection is not evidence that it remains unavailable after an update.

Check a representative section and one end before duplicating the construction. Keep the plan proportional to the geometry: repeated independently authored profiles, mirrored numeric coordinates and many support planes are signals to reconsider reuse, symmetry or a simpler feature. A Boolean or solver failure requires inspecting the failing operation and diagnostics before adding more geometry. Report a demonstrated tool/kernel limitation rather than silently accepting a different shape.

## Sketches and profiles

Use the advertised entity/constraint schema. Coordinate values are mm and solver seeds, not persistent dimensional constraints. Preserve unaffected entity and constraint IDs when replacing a sketch. Fully constrain geometry when the requested parametric intent requires it; report remaining freedom or conflicts when relevant.

Constrain relationships and driving dimensions without redundantly fixing the same degrees of freedom. Do not pin every endpoint and then add dimensions or arc constraints that restate those fixed coordinates. For a conflict, inspect the solver's identified constraints and correct redundancy while preserving the intended dimensions.

Horizontal/vertical distance constraints are signed: the first point's coordinate minus the second point's coordinate equals the specified value. For a positive X offset from an origin anchor, the positive point is `firstPointId` and the anchor is `secondPointId`. XY coordinates map to world X/Y; preview bounds confirm placement on other planes.

Extrude/Revolve profiles identify the sketch and its boundary entity IDs. Boundary ID arrays must be unique and sorted as required by the schema; polygon winding or storage order is not an identity contract. For an existing complex sketch, full profile/face discovery is not exposed through MCP. Obtain a known authored profile or use visible editor selection rather than guessing one from arbitrary edges.

## Extrude and Revolve

For New/Add/Remove/Intersect, retain explicit dependencies and support references; modifying operations put the target first. Use typed length quantities for extrusion depths and typed radians for Revolve angles. Revolve supports an origin axis, sketch line, or supported stable model-edge reference; check its live schema and preview axis placement.

Independent Extrude extents use the `profiles` contract (even for one profile), `distance`, `secondDistance`, `reversed`, `symmetric`, and `operation`. This selects schema v5. With 10 mm first depth, 3 mm second depth, no reversal, and no symmetry, the solid spans -3 to +10 mm along the normal. Reversal spans -10 to +3 mm. `secondDistance: null` selects one direction. Symmetric requires a null second depth and stores the **total** span split equally about the plane. Enabled depths are at least 0.001 mm; total span is at most 100,000 mm. No starting offset or arbitrary direction is supported by this contract.

## Datum Plane and body combinations

`create_datum_plane`/`update_datum_plane` use the existing offset mode with a signed typed length. Origin support is `{ kind: "origin-plane", plane: "xy" | "xz" | "yz" }` with empty dependencies and references. Face support uses an existing planar face v0 TopoRef, exactly its owner dependency and exactly that persisted reference. Body-topology v1 references cannot be substituted. Preserve the support and offset expression when editing. Preview downstream sketches and features to verify placement; arbitrary tilted or three-point planes are not exposed.

`create_boolean`/`update_boolean` perform legacy whole-result subtraction with `operation: "subtract"`, optional `keepTools`, exactly two distinct dependencies ordered target before tool, and empty references. They do not accept exact body selectors. Use a selected-body feature operation when the requested scope is one constituent output rather than a whole producer result.

`create_union`/`update_union` and `create_compound`/`update_compound` use schema v2: two to eight distinct exact bodies selected by `{ schemaVersion: 0, featureId, outputRole }`. Multiple roles from the same producer are supported; dependencies list each producer once in first-occurrence order, and references are empty. Use inspected roles for saved bodies. Known newly authored single-solid Box/Extrude/Revolve/Union outputs use `result`; do not invent roles for arbitrary multi-body features.

Union takes ordered `bodies`, requires one connected positive-volume solid and keeps the first selected PartId while consuming the other selected parts. Compound takes ordered `slots`, each with a unique UUIDv7 `slotId` and `targetBody`; it retains separate solids and exposes `body.<slotId>`. Preserve slot IDs on edit to retain output and part identities. Missing roles fail exact preview; they never fall back to another body. An explicit update can upgrade saved v1 Union/Compound intent to v2. Manual Apply is the default; a matching explicit browser session grant permits Union v2 and Loft v1 creation and same-version edits. Compound and schema-upgrade edits still require manual review.

## Hole

Use 1–256 stable point IDs from an inspected sketch, a positive typed diameter, and the schema's forward/reverse direction and blind/through-all extent. Supply the target first and, where needed, one distinct sketch-support dependency with its exact support reference.

`parameters.targetBody` selects an exact output role from `model_body_measurements` or `draft_body_measurements` and must match the first dependency. Preserve it when updating a v2 Hole; omitting it requests legacy whole-feature scope. A newly authored single-solid Extrude has role `result`; inspect other draft producers instead of inventing their output roles. A through-all cut still has a direction; exact preview must show it reaching the intended body.

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

## Body operations and section features

Use `model_body_measurements` or `draft_body_measurements` to select the exact feature/output-role pair for Mirror, body Pattern, Split, Shell and Thread. Never infer a transient OCCT index or widen a body selection to its entire feature. Preserve the matching dependency and stable feature ID on update. Linear/circular body patterns produce independently addressable copies; inspect the live count and spacing/angle limits. Split takes an origin plane and signed offset and requires one connected solid per side.

Shell create/update authors version 2 with explicit inward/outward direction and positive thickness. Use `openings: []` for a closed cavity. For an open cavity, obtain exact body-bound opening references and the source content hash from `model_body_topology` or `draft_body_topology`. For a new enclosure, create its exterior, inspect the current draft body and opening faces, create Shell in the same draft, then preview before one commit. A save solely to discover opening faces is unnecessary. After source edits, restart stale topology discovery; unique durable face identities can preserve existing v2 openings within the same exact body. Missing, ambiguous or unsupported identity requires inspecting and reselecting faces. For modifying Extrude targets, omit inferred `semanticRole` values from opening references; only native history permits automatic retention there. Existing version 1 features retain their conservative stale-source behavior until explicitly updated.

Mirror plane-only parameters preserve the v1 replacement behavior. For v2, supply both a signed typed length `offset` and `preserveSource`. XY offset follows +Z, XZ follows +Y and YZ follows +X; absolute offset is at most 100,000 mm. `preserveSource: true` keeps the original part and creates a separately selectable reflected part under the Mirror feature's `result` role. Join source and reflected bodies explicitly through Union when one connected solid is intended. `false` replaces the source part. Preserve the full v2 parameters and offset expression on update; a schema upgrade retains ordinary review rules.

Sweep uses one solved profile and an open connected tangent-continuous line, circular arc, cubic Bezier, or bounded elliptical arc path with sorted unique entity IDs and an explicit start point. The profile must already lie at the path start normal to its tangent; the tool does not reposition it. Loft v1 uses two to twenty-four ordered, unique, hole-free profile selectors. Loft v2 adds explicit durable hole correspondence: match each hole once across every ordered section, retain those stable boundary IDs on edit, and inspect exact preview for crossing or escaping hole tracks. Both use at most 2,000 aggregate outer/hole boundary entities and an explicit ruled setting. Use v2 only when the advertised tool schema supports `holeCorrespondence`; UI support does not imply transport support. Guide curves and independent end continuity are outside v2. It allows up to twenty-four deduplicated support/external producer dependencies; Sweep keeps its separate eight-dependency limit. Preserve profile-before-path or section-order support/external dependencies and their references. Inspect exact preview for continuity and intended orientation.

Thread creates custom 60-degree V-groove geometry, without ISO/DIN fit certification. Specify external/internal, axis and origin, nominal diameter, pitch, length, depth, clearance, handedness, one to four starts, phase and unthreaded run-in/run-out allowances. The authored band is bounded to sixteen total turns and depth to 0.75 times pitch. Preview and measure the intended cylindrical band before commit; kernel failures must not silently fall back to an unthreaded body.

Geometry/planar file import, text generation, assembly authoring, library management and surface texture authoring are editor workflows, not named MCP construction tools. Source-backed features can be inspected and survive supported upstream edits. Use the visible editor for those workflows; discovery remains authoritative for each transport. Local stdio and paired remote MCP share the named feature schemas and ordinary draft preview/review/commit path.

Sketch fillet/chamfer are sketch edits, separate from solid Fillet/Chamfer features. In the editor, select two authored non-construction lines sharing a corner, enter the radius or two setbacks, review the disposable preview and Apply once. Construction guides preserve the original virtual-corner dimensions; the added radius/tangent or distance constraints remain editable. Branched, collinear and oversized corners fail closed. Use a named transport tool only when its live schema advertises this edit; do not emulate it with a 3D edge treatment.
