# Modeling contracts and recipes

Model-write approval follows the [session policy](../../vibeshape-use/references/session.md).
The built-in chat commits validated changes to its current project without another Apply action;
manual review requirements below describe external MCP clients. Publishing or updating the reusable
local library remains separately reviewed for every connection.

## Choose a construction

Recover design intent rather than tracing tessellation. Identify straight, circular and rotational regions, repeated geometry, openings and protected interfaces. Use a small number of dimensioned profiles and features when they reproduce the requested shape. Prefer line/arc profiles over dense sampled boundaries for analytical geometry; use additional Loft sections only where the shape or an agreed error bound requires them.

For an elongated enclosure, consider Extrude for the straight section, Revolve for rotational ends, and Mirror for genuinely symmetric regions. Join the exterior into one solid, then use Shell when the intended interior is a constant-thickness offset with selected openings. Model holes, lips, reinforcements and asymmetric ends separately. A simple planar capsule may need only one outline Extrude and Shell. Neither recipe establishes that an arbitrary source mesh has constant thickness or symmetric ends.

Compare outer and inner sections before choosing Shell for a reconstruction. Use explicit inner profiles and subtraction when variable thickness, mating surfaces or exact source geometry cannot be reproduced by Shell, or when exact Shell preview demonstrates a kernel limitation. Preserve an authored interior instead of replacing it with a convenient uniform wall. State the specific reason for a more complex construction; a missing tool at an earlier connection is not evidence that it remains unavailable after an update.

Check a representative section and one end before duplicating the construction. Keep the plan proportional to the geometry: repeated independently authored profiles, mirrored numeric coordinates and many support planes are signals to reconsider reuse, symmetry or a simpler feature. A Boolean or solver failure requires inspecting the failing operation and diagnostics before adding more geometry. Report a demonstrated tool/kernel limitation rather than silently accepting a different shape.

### Decide sketch symmetry before placing points

Before creating a sketch, state whether the intended profile is symmetric, its axis and which half owns the dimensions. Use symmetry only when the source or requested design supports it; photographs alone do not establish a mating interface's symmetry. If independent halves are necessary, identify the asymmetric detail or demonstrated capability limitation before duplicating their dimensions.

For a symmetric outline, dimension one half and add a stable construction line as the symmetry axis. Keep the reflected geometry associative with `symmetric` constraints linking corresponding point pairs to that line. Include both cubic Bezier control points as well as endpoints, since symmetric endpoints alone do not make a symmetric curve. Reuse points on the axis or constrain them to it, and retain a closed connected profile. Do not also give the reflected points independent X/Y dimensions that duplicate the symmetry equations. The reflected half still contains point and curve entities; its positions are derived rather than independently dimensioned.

The editor's sketch Mirror creates reflected entities with symmetry constraints. Named MCP `create_mirror` and `create_reference_mirror` operate on bodies, not sketch entities. When a named sketch Mirror is absent, inspect the live `create_sketch`/`update_sketch` schema: a complete sketch record accepting `symmetric` can express the same point relationships. Use a body Mirror only when the feature plan calls for a reflected solid. A missing convenience tool is not evidence that associative sketch symmetry is unavailable.

Inspect the solved profile and editability before committing: changing a source-side dimension must update its paired points and Bezier controls while preserving the intended single closed profile. For an existing model, read constraints and dependent features first; replacing duplicate dimensions with symmetry is a separate authorized CAD edit, not an automatic instruction upgrade.


Choose one model coordinate frame before authoring: identify the origin, principal axes, symmetry planes and feature offsets. Prefer centering a new standalone part about an appropriate origin or symmetry axis unless the user requires another frame. For a reconstruction, preserve the source frame only when alignment, mating or another acceptance requirement depends on it; matching an arbitrary mesh bounding-box minimum is not itself a reason to translate every body.

Author sketches, primitive origins and feature axes in their intended locations when the advertised contracts support them. Add Placement only for a real downstream positioning or orientation requirement, and explain that purpose in the feature label. Check a sketch-line axis, supported datum or explicit primitive origin before creating geometry at zero and immediately moving it. Do not add repeated Placement features to make the model sit beside the origin or improve its viewport composition; use camera Fit instead. Do not remove an existing Placement until inspecting its consumers, references and exact before/after bounds proves that the design intent is preserved.

## Registered primitives

Box keeps its existing `create_box` millimeter shorthand and adds `update_box` with a complete
typed `parameters` record. Cylinder, pointed Cone, Sphere, ring Torus and regular Pyramid each
have named create/update tools using their registered domain schemas. Supply quantity dimensions,
quantity `{ x, y, z }` origin, applicable `centered`, explicit `suppressed`, the label to retain,
stable feature ID, fresh command ID and current owned draft revision. These independent primitives
accept no dependencies or topology references. Read the full existing feature before updating;
preserve its identity and raw expressions. The live schemas define bounds and required fields.
Torus requires major radius greater than minor radius; Pyramid takes 3–64 integer sides and a
circumradius. Wedge and truncated Cone are not registered primitive contracts.

Inspect exact preview volume, bounds and body count before commit. A valid matching CAD auto-apply
grant covers all shipped first-party primitive families and supported feature versions, including
Extrusion v6/v7, Mirror and Shell. Unsupported versions, extensions and import feature targets
remain outside the grant.

## Feature and sketch lifecycle

`remove_feature` and `remove_sketch` stage ordinary destructive removal by stable ID.
Dependencies block removal with `feature-in-use` or `sketch-in-use`; the rejected command does
not advance the draft revision. Inspect the owning records and explicitly remove or retarget
their consumers first. These tools never cascade or discard model-reference intent. The editor's History Delete can disconnect affected inputs and retain downstream repair recipes, but this is not the removal contract of these MCP tools. Do not infer MCP support from the visible editor action.

`set_feature_suppressed` takes an explicit boolean, preserving the remaining authored record.
Suppression can block downstream geometry; exact preview exposes that failure and must be repaired
before Apply. `rename_project` stages the registered document rename with a normalized nonempty
name of at most 120 characters. It preserves feature/sketch IDs and geometry.

All four lifecycle tools use fresh command IDs and the current owned draft revision. Supported CAD
removal and suppression use an existing auto-apply grant; `rename_project` retains manual browser
review. Stage a coherent
edit, run exact preview, then `commit_draft`; the accepted transaction persists once and creates
one normal Undo entry. Reuse the returned revision and inspect affected intent after Apply.
These lifecycle tools stage authored changes; they do not navigate saved-change History or execute generic commands. For committed Undo/Redo, follow the [organization workflow](../../vibeshape-organization/SKILL.md).

## Sketches and profiles

Use the advertised entity/constraint schema. Coordinate values are mm and solver seeds, not persistent dimensional constraints. Preserve unaffected entity and constraint IDs when replacing a sketch. Fully constrain geometry when the requested parametric intent requires it; report remaining freedom or conflicts when relevant.

Constrain relationships and driving dimensions without redundantly fixing the same degrees of freedom. Do not pin every endpoint and then add dimensions or arc constraints that restate those fixed coordinates. For a conflict, inspect the solver's identified constraints and correct redundancy while preserving the intended dimensions.

Horizontal/vertical distance constraints are signed: the first point's coordinate minus the second point's coordinate equals the specified value. For a positive X offset from an origin anchor, the positive point is `firstPointId` and the anchor is `secondPointId`. XY coordinates map to world X/Y; preview bounds confirm placement on other planes.

Extrude/Revolve profiles identify the sketch and its boundary entity IDs. Boundary ID arrays must be unique and sorted as required by the schema; polygon winding or storage order is not an identity contract. Discover solved profile selectors with `model_sketch_solution` or `draft_sketch_solution` at the exact revision. Discover exact body faces separately with `model_body_topology` or `draft_body_topology`; use the returned selectors and durable references rather than arbitrary edge order.

## Extrude and Revolve

For New/Add/Remove/Intersect, retain explicit dependencies and support references; modifying operations put the target first. Use typed length quantities for extrusion depths and typed radians for Revolve angles. Revolve supports an origin axis, sketch line, or supported stable model-edge reference; check its live schema and preview axis placement.

Independent Extrude extents use the `profiles` contract (even for one profile), `distance`, `secondDistance`, `reversed`, `symmetric`, and `operation`. This selects schema v5. With 10 mm first depth, 3 mm second depth, no reversal, and no symmetry, the solid spans -3 to +10 mm along the normal. Reversal spans -10 to +3 mm. `secondDistance: null` selects one direction. Symmetric requires a null second depth and stores the **total** span split equally about the plane. Enabled depths are at least 0.001 mm; total span is at most 100,000 mm. No starting offset or arbitrary direction is supported by this contract.

## Datum Plane and body combinations

`create_datum_plane`/`update_datum_plane` use offset mode with a signed typed length and optional `rotation: { axis: "x" | "y", angle: AngleQuantity }`. Origin support is `{ kind: "origin-plane", plane: "xy" | "xz" | "yz" }` with empty dependencies and references. Face support uses an existing planar face v0 TopoRef, exactly its owner dependency and exactly that persisted reference. Body-topology v1 references cannot be substituted. Preserve support, offset, rotation and quantity expressions when editing. Both local and paired remote MCP expose the same contract. Creation and explicit updates write datum-plane feature schema v2. Offset-only v1 remains strictly registered and is preserved on read/rebuild; updating a legacy plane explicitly upgrades its version while preserving its feature ID. Do not attach rotation to a v1 record or rewrite its version during inspection.

Rotation uses the support's local X or Y axis and the right-hand positive direction. First offset the origin along the unrotated support normal; then rotate the basis about the selected local axis through that translated origin. For XY support, positive X tilts its normal toward -Y; positive Y tilts it toward +X. Angle quantities retain `deg` or `rad` source units and variable expressions, use canonical radians, and must resolve within inclusive ±360 degrees (±2π radians). For a variable-driven plane, define an angle-valued `tilt` variable, retain `#tilt` in `rotation.angle.source.expression`, and supply matching evaluated numeric/source values; the expression is authoritative during rebuild. Missing or zero rotation preserves the parallel offset plane. Preview downstream sketches and features to verify placement. Three-point, tangent and line-at-angle construction modes remain unavailable.

Changing the orientation of an already referenced Datum Plane, including through an angle variable, can require explicit support repair for dependent sketches or datums. Their persisted oriented face references retain the selected direction, as when changing an origin support from XY to XZ. Inspect downstream support diagnostics after preview and explicitly reselect the support when requested; a moved logical frame alone does not establish valid support.

`create_boolean`/`update_boolean` perform legacy whole-result subtraction with `operation: "subtract"`, optional `keepTools`, exactly two distinct dependencies ordered target before tool, and empty references. They do not accept exact body selectors. Use a selected-body feature operation when the requested scope is one constituent output rather than a whole producer result.

For a selected constituent body, use additive `create_body_subtract`/`update_body_subtract` (Subtract v2):
select exact `targetBody` and `toolBody`, including distinct roles of one producer. Declare each
producer once in target/tool order and keep `references: []`. `keepTools` retains the tool Part;
siblings remain available. Use `create_body_revolve`/`update_body_revolve` (Revolve v7) for exact-body
Add/Remove/Intersect with a canonical same-sketch `profiles` set, typed angle, and existing origin,
sketch-line, or stable model-edge axis. Its dependencies are target first, then distinct sketch-support
and model-edge owners, with existing sketch-support references. New Revolve remains on `create_revolve`.
Get roles from current `model_body_measurements` or `draft_body_measurements`, preserve selectors on
update, and repair missing roles explicitly. These tools accept no caller content hashes or native
indices. Local and paired remote transports use ordinary owned draft preview, review and Apply.


`create_union`/`update_union` and `create_compound`/`update_compound` use schema v2: two to eight distinct exact bodies selected by `{ schemaVersion: 0, featureId, outputRole }`. Multiple roles from the same producer are supported; dependencies list each producer once in first-occurrence order, and references are empty. Use inspected roles for saved bodies. Known newly authored single-solid Box/Extrude/Revolve/Union outputs use `result`; do not invent roles for arbitrary multi-body features.

Union takes ordered `bodies`, requires one connected positive-volume solid and keeps the first selected PartId while consuming the other selected parts. Compound takes ordered `slots`, each with a unique UUIDv7 `slotId` and `targetBody`; it retains separate solids and exposes `body.<slotId>`. Preserve slot IDs on edit to retain output and part identities. Missing roles fail exact preview; they never fall back to another body. An explicit update can upgrade saved v1 Union/Compound intent to v2. Manual Apply is the default; a matching explicit browser session grant permits Union v2 and Loft v1/v2/v3 creation and same-version edits. Compound and schema-upgrade edits still require manual review.

## Hole

Use 1–256 stable point IDs from an inspected sketch, a positive typed diameter, and the schema's forward/reverse direction and blind/through-all extent. Supply the target first and, where needed, one distinct sketch-support dependency with its exact support reference.

`parameters.targetBody` selects an exact output role from `model_body_measurements` or `draft_body_measurements` and must match the first dependency. Preserve it when updating a v2 Hole; omitting it requests legacy whole-feature scope. A newly authored single-solid Extrude has role `result`; inspect other draft producers instead of inventing their output roles. A through-all cut still has a direction; exact preview must show it reaching the intended body.

Adding `treatment` selects Hole v3 and requires `targetBody`: `{kind:"simple"}`, `{kind:"counterbore",diameter,depth}`, or `{kind:"countersink",diameter,angle}`. Recess dimensions are length quantities; countersink angle is the included angle quantity between 10 and 170 degrees. The recess diameter exceeds the hole diameter, and a blind recess must leave positive cylindrical depth. Preserve treatment and quantity expressions when updating. Preview the actual recess before committing.

## Extrusion endpoints and body scope

`create_extrude` and `update_extrude` retain their legacy profile contracts. V6 adds required `targetBody` (null for New, exact role for Add/Remove/Intersect), signed `startOffset`, signed `draftAngle` within 45 degrees, and `endCondition`. `{kind:"distance"}` uses the authored depths. Through-all and up-to-body require `{kind,targetBody,sourceContentHash}`; planar up-to-face also requires a stable body-bound `face` from current topology inspection. Capture the support's current content hash and role together. Changed or unresolved support requires explicit repair; never invent a face index or silently refresh the hash.

Dependencies retain the modifying target first, optional sketch support second, and a distinct end producer last, with duplicate producers listed once. A shared sketch support uses the whole `result` slot; it cannot share a producer slot with a constituent target or endpoint. Dynamic endpoints require `symmetric:false` and `secondDistance:null`. Through-all reaches beyond current support bounds, up-to-body stops at the first uniquely covering body boundary, and up-to-face requires the complete end cap to lie on the selected finite planar face. Unreachable, ambiguous, stale and partially covering endpoints fail closed. V6 remains limited to planar faces.

Cross-sketch Extrude uses v8 through the same named tools: supply the complete advanced fields above,
a canonical selector set, and every selected sketch's actual support reference in canonical selector
order (deduplicated by full reference identity). List the exact modifying target first, distinct sketch
support producers next, and a distinct end producer last. Each sketch uses its own plane normal;
depth, reverse, symmetry and offset apply relative to that normal. Parallel offset and nonparallel
planes are supported without projecting or sampling profiles. Dynamic endpoints resolve independently
for every profile and fail the whole feature if any endpoint is unreachable or incomplete. Preview
bounds, volume and solid count for the complete selection before Apply. Revolve still requires all
profiles to come from one sketch.

`create_face_extent_extrude` and `update_face_extent_extrude` author v7 up-to-face for one-sketch selections, or v8 for cross-sketch selections, with the same typed advanced fields and exact target/body dependency rules. Obtain a current finite planar or curved `BodyFaceRef` from `model_body_topology` or `draft_body_topology` and retain its captured support hash. Curved termination requires one complete reachable cap; every new cap face must lie on the selected finite face. Partial patches, neighboring boundaries, an inside start, unreachable extents and stale or ambiguous support fail closed. No implicit surface extension is performed. Explicitly upgrading a legacy feature uses this named update tool and manual browser review; editing a saved v7 feature through it remains v7 when the endpoint becomes planar. Preview downstream geometry before committing. These additive tools are shared by local stdio and paired remote MCP.

## Fillet and Chamfer

Obtain durable resolved selections from `model_edges` or `draft_edges`. A unique identical full edge signature resolves before approximate matching, including nearby circular rims; coincident identical candidates remain ambiguous and require explicit repair. `edges` omission means **all edges**; preserve the entire array for a selected treatment. Body topology inspection references are not accepted as treatment selections. Radii/distances are positive mm fields; optional expressions are authoritative. Preserve an existing expression unless the request changes it.

In the visible editor, a current model edge can be selected directly in the idle 3D viewport,
including through its keyboard edge selector. Starting Fillet or Chamfer with an eligible selected
edge seeds that exact reference; a body or face selection seeds only the source body. Hidden,
occluded, clipped, or preview-only edges do not intercept pointer picking. This is UI preselection,
not an MCP session selection API: named MCP treatment tools still require explicit durable `edges`.

If exact preview fails, inspect diagnostics and the complete treatment record. Correct the requested radius/distance or repair a missing selection through supported inspection; do not silently broaden to all edges. Sequential treatments usually target the prior treatment result, rather than an already consumed upstream solid.

## Variables

Use named document variables for all editable design dimensions and numeric controls by default, including profile lengths, wall thickness, hole diameter, treatment radius, clearance, spacing, placement/support offsets, angles, and counts where the live schema accepts scalar expressions. Reuse existing variables that represent the same design intent; equal numeric values alone do not make two independent dimensions the same parameter. Give independent inputs meaningful English names, and express dependent dimensions through formulas such as `#outer_width - 2 * #wall_thickness`. Keep units explicit in variable definitions, for example `wall_thickness = "2 mm"`, `draft_angle = "5 deg"`, and a dimensionless `hole_count = "4"`.

Create variables before their consuming sketches/features in the same owned draft. Retain authored expressions in the supported quantity or dedicated expression fields: reference `#wall_thickness` in the extrusion quantity, for example, or supply `radiusExpression: "#edge_radius"` for Fillet. If a tool also requires a numeric value, supply the correct evaluated value while retaining the authoritative expression. Never substitute that number for the expression or assume that creating an unused variable makes geometry parametric.

Sketch coordinates are solver seeds. Drive editable profile dimensions and positions with variable-backed dimensional constraints and geometric relationships; changing a variable must change the solved geometry, not merely its table entry. Fixed origin anchors, unit directions, booleans, IDs, and topology selectors do not need artificial variables. When a required input has no expression-capable MCP field or constraint, use an authorized editor route that preserves the expression if available; otherwise identify that specific editability gap rather than claiming a literal is variable-driven. Do not invent expression fields.

Use `model_variables`/`draft_variables` to read names, expressions, evaluated values, and diagnostics. Use `create_variable`, `set_variable_expression`, or `rename_variable` for a targeted edit. Preserve the stable variable ID. A name change must respect the application's expression/dependency rules. Do not overwrite the entire table to change one value. `remove_variable` and `replace_variable_table` need the corresponding requested scope and dependency checks; ordinary CAD auto-apply does not establish approval for every destructive operation.

Before acceptance, inspect the current draft definitions and consuming sketch/feature records to confirm that the expressions are retained and dimensional diagnostics are clear. For a newly constructed model, temporarily change a representative driving variable in the private draft, run exact preview, and confirm the expected dependent dimension changes; restore the intended value and preview again before commit. After Apply, read the committed variables and affected records to confirm that the saved model retains its editable intent. Report the main variable names and any literal-only controls at handoff.

## Useful construction paths

- **Editable plate:** create length, width, thickness, mounting-offset, and hole-diameter variables as needed; author a rectangular sketch with variable-backed dimensions; Extrude New using `#thickness`; constrain a point sketch for mounting centers through the offset variables; add Hole with the solid as the first dependency and a variable-backed diameter. Preview the plate dimensions, thickness, and hole positions before one commit. The local `vibeshape://authoring-guide` contains a complete schema-backed 40 × 24 × 4 mm example; replace its example IDs and revisions with fresh session state and parameterize all editable dimensions under the variable contract above.
- **L bracket:** create leg-length, height, wall-thickness, and width variables; constrain a closed six-line L outline through those dimensions and geometric relationships, then extrude using the width variable. Put mounting-point sketches on suitable supported planes with variable-backed offsets and hole sizes, and preview each cutting direction. Two sketch-backed Extrudes, with the second Add and target-first dependencies, are another supported construction when appropriate.
- **Change thickness or diameter:** change the existing variable expression or feature parameter, retaining IDs, profiles, scopes, and support. Preview all dependent features; do not rebuild a parallel replacement.

A recipe is design guidance, not a batch tool. Execute actual discovered tools sequentially and use their returned revisions.

## Body operations and section features

Use `model_body_measurements` or `draft_body_measurements` to select the exact feature/output-role pair for Mirror, body Pattern, Split, Shell and Thread. Never infer a transient OCCT index or widen a body selection to its entire feature. Preserve the matching dependency and stable feature ID on update. Linear/circular body patterns produce independently addressable copies; inspect the live count and spacing/angle limits. Legacy Split takes an origin plane and signed offset; reference Split accepts arbitrary supported planes. Both require one connected solid per side.

Shell create/update authors version 2 with explicit inward/outward direction and positive thickness. Use `openings: []` for a closed cavity. For an open cavity, obtain exact body-bound opening references and the source content hash from `model_body_topology` or `draft_body_topology`. For a new enclosure, create its exterior, inspect the current draft body and opening faces, create Shell in the same draft, then preview before one commit. A save solely to discover opening faces is unnecessary. After source edits, restart stale topology discovery; unique durable face identities can preserve existing v2 openings within the same exact body. Missing, ambiguous or unsupported identity requires inspecting and reselecting faces. For modifying Extrude targets, omit inferred `semanticRole` values from opening references; only native history permits automatic retention there. Existing version 1 features retain their conservative stale-source behavior until explicitly updated.

The legacy `create_mirror`/`update_mirror` tools retain v1/v2 contracts. Mirror plane-only parameters preserve the v1 replacement behavior. For v2, supply both a signed typed length `offset` and `preserveSource`. XY offset follows +Z, XZ follows +Y and YZ follows +X; absolute offset is at most 100,000 mm. `preserveSource: true` keeps the original part and creates a separately selectable reflected part under the Mirror feature's `result` role. Join source and reflected bodies explicitly through Union when one connected solid is intended. `false` replaces the source part. Preserve the full v2 parameters and offset expression on update; a schema upgrade retains ordinary review rules.

The additive `create_reference_mirror`/`update_reference_mirror` tools author Mirror v3; `create_reference_split`/`update_reference_split` author Split v2; `create_reference_body_pattern`/`update_reference_body_pattern` author Pattern v2. Their parameters select one exact `targetBody` and a reference plane or axis. Declare dependencies as the target producer first, then a distinct support producer; deduplicate support on the same producer and keep generic `references: []`.

Reference planes accept `origin-plane` (XY/XZ/YZ), `datum-plane` with the authored Datum Plane feature ID, `planar-face` with a stable body-bound face reference, or `explicit-plane` with world origin in canonical millimeters and a unit normal. Mirror v3 preserves typed offset and `preserveSource`; Split offset follows the selected normal. Reference axes accept `origin-axis` (X/Y/Z), `datum-axis` with a Datum Plane feature ID and x/y/normal axis, `linear-edge` with a stable body-bound LINE reference carrying its authored unit direction, or `explicit-axis` with world origin in millimeters and unit direction. Pattern circular center comes from that axis; omit legacy center quantities. Count, spacing, angle and plane offset retain typed quantities and supported variable expressions.

Obtain exact body-bound references from `model_body_topology` or `draft_body_topology` at the current revision. For plane support choose an oriented PLANE face with direction; for axis support choose a LINE edge with direction. Pass its stable `reference` unchanged, including the exact `outputRole`; native candidate IDs and indices are inspection-local. These tools do not accept caller source content hashes. Current document/worker resolution binds support content internally and fails closed on missing, stale or ambiguous support. The supporting body remains available; only the exact target is consumed, unless Mirror retains its source. Read existing intent before upgrading a legacy feature, then preview and use ordinary browser review/commit. Local and paired remote MCP expose the same additive contracts when present in discovery.

Sweep uses one solved profile and an open connected tangent-continuous line, circular arc, cubic Bezier, or bounded elliptical arc path with sorted unique entity IDs and an explicit start point. The profile must already lie at the path start normal to its tangent; the tool does not reposition it. Preserve profile-before-path support/external dependencies and references, with at most eight deduplicated producers.

Loft v1 uses two to twenty-four ordered, unique, hole-free profile selectors. Loft v2 adds explicit durable hole correspondence: match each hole once across every ordered section, retain those stable boundary IDs on edit, and inspect exact preview for crossing or escaping hole tracks. Both use at most 2,000 aggregate outer/hole boundary entities, twenty-four deduplicated support/external producers, and an explicit ruled setting. Preserve section-order dependencies and references. Use v2 only when the advertised tool schema supports `holeCorrespondence`; guide curves and independent end continuity are outside v2.

Named `create_loft`/`update_loft` also accept v3. Explicit `outerCorrespondence` rows match each directed segment and start vertex across all sections. Rails select `vertexTrack` plus an authored open path; guides select a unique name, `segmentTrack`, C0 and an authored path. Independently select start/end `segmentTrack`, G1 or G2 and a current exact BodyFaceRef from `model_body_topology` or `draft_body_topology`. V3 requires `ruled:false`, two to twenty-four matching hole-free sections, three to sixty-four open-segment tracks, at most 2,000 curves and 128 deduplicated producers. Declare section/rail/guide sketch support and external owners first, then end support body owners, retaining authoritative sketch-reference order. Full-circle/ellipse seams and holes use other schema versions.

Missing, ambiguous or changed support faces require explicit repair. Guides and end constraints affect exact native geometry; unconverged constraints return a measured diagnostic and never become an unconstrained fallback. Planar and cylindrical G2 supports have positive native derivative evidence, including nonzero cylinder curvature at both ends. Curved supports require matching complete native boundary pcurves; arbitrary curved-surface convergence is not guaranteed. Larger guide excursions can also fail. Inspect the diagnostic, edit the offending input and preview again. Inspect exact preview for continuity and intended orientation.

Thread creates custom 60-degree V-groove geometry, without ISO/DIN fit certification. Specify external/internal, nominal diameter, pitch, length, depth, clearance, handedness, one to four starts, phase and unthreaded run-in/run-out allowances. Legacy XYZ `axis` with quantity `origin` retains v1 and sixteen total turns. V2 uses a shared `origin-axis`, `datum-axis` (x/y/normal), stable `linear-edge`, or `explicit-axis` object; explicit origin is a mm tuple and direction is a normalized signed tuple. The exact target is first, any distinct axis producer is second, and generic references remain empty because body-bound topology stays in `parameters.axis`. Single-start v2 permits twenty total turns; multi-start retains sixteen. Depth stays at most 0.75 times pitch. Preserve complete axis and quantity intent on update. Preview and measure the intended cylindrical band before commit; kernel failures must not silently fall back to an unthreaded body.

Native STEP/STP/BREP/STL/3MF imports use the advertised bounded upload and manual review tools described in [native source import](native-import.md). Planar SVG/DXF import uses the distinct [planar source import](planar-import.md) tools. Assembly and local-library authoring use [owned assembly drafts](assembly-and-library.md); printable relief uses [surface texture proposals](surface-textures.md). Placement and editable text use the named tools described below. Discovery remains authoritative for each transport. Local stdio and paired remote MCP share the named schemas and ordinary review/commit authority.

Sketch fillet/chamfer are sketch edits, separate from solid Fillet/Chamfer features. In the editor, select two authored non-construction lines sharing a corner, enter the radius or two setbacks, review the disposable preview and Apply once. Construction guides preserve the original virtual-corner dimensions; the added radius/tangent or distance constraints remain editable. Branched, collinear and oversized corners fail closed. Use a named transport tool only when its live schema advertises this edit; do not emulate it with a 3D edge treatment.

## Placement and editable text

`create_placement`/`update_placement` take the registered typed translation/rotation parameters and an exact `targetBody`. Supply exactly that producer as the sole dependency and empty references. Placement is numeric and non-associative; preview bounds and volume before ordinary manual review. Read the existing feature before update and retain its identity.

`create_sketch_text` takes `draftId`, the current draft `baseRevision` from its last returned state, a fresh `commandId`, `sketchId`, a new stable UUIDv7 `groupId`, bounded `origin: [x, y]` and `intent` (`text`, `heightMm`, `trackingMm`, `alignment`, `kerning`). Inspect the live schema for supported characters and bounds. The browser uses its pinned bundled font; do not supply font bytes, hashes, entity IDs or outline metadata. Existing outline complexity budgets still apply even below the 64-scalar text limit.

For `update_sketch_text`, retain the group ID and explicitly set `removeAttachedConstraints`. False rejects replacement when existing constraints refer to the generated entities; true deliberately removes those attached constraints. Regenerated contour identities can invalidate downstream selectors: inspect the exact draft sketch solution, repair dependent selectors and preview before Apply. `detach_sketch_text` retains geometry and constraints while removing the editable text intent.

Text preparation uses the actor-owned exact-revision draft, then the ordinary sketch update path after asynchronous outline generation. Failed, cancelled, expired or stale preparation must leave the draft unchanged. These tools cannot expand browser auto-apply grants.

## FDM geometry tools

Discover `create_fdm` and `update_fdm` on the local or paired remote adapter. Both author one editable feature with strict `parameters.kind`: `web`, `corner-relief`, `seam-groove`, `teardrop-hole`, `hex-seat`, `crush-ribs`, `flexible-sleeve`, `nut-pocket`, `insert-pocket`, `enclosure-joint`, `membrane`, or `calibration-coupon`. In a repository checkout, `docs/product/fdm-tools.md` is the canonical feature contract; use live schemas for dimensions and the rules below for bounded native support.

Use ordinary owned drafts, exact current revisions, and reviewed apply. Select an exact target BodyRef including its output role from body inspection; never replace a missing role with `result`. Calibration coupons have no target; sleeves may omit one. Dimensions/origins retain units and source expressions. Count controls are plain bounded integers, so document-variable count expressions are evaluated snapshots rather than associative controls.

For Web/Rib, inspect a saved solved sketch and use stable nonconstruction line IDs. Declare target, distinct sketch support owner, and distinct stop-plane owner in that order, and carry only the sketch's actual support reference. Web extrudes normal to the sketch; Rib is a triangular in-plane gusset with symmetric normal thickness. Automatic wall extension requires finite rectangular planar cavity walls with complete coverage. Only parallel reachable origin/datum/explicit planes can stop a Web; finite body-face termination fails explicitly. Do not substitute a bounded-depth operation after an extension/termination failure without preserving the requested intent.

Preview exact bounds, positive volume, one connected solid, and the intended cut/addition. Missed cutters and disconnected additions fail. Inspect the result visually before apply; fit and printability still require material/process calibration. Flat cuts reuse `create_split` or `create_reference_split` and their exact output-role contracts. These tools do not configure slicer settings or start a printer.
