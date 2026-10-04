export const authoringGuide = `# VibeShape MCP authoring guide

Read \`vibeshape://session\` for the actual \`editorUrl\` and current \`paired\` status.
This resource works before pairing and contains no credentials or document data.
Open that URL, open/create the intended project, and have the person click **Enable AI session**.
The browser retains the document authority; there is no embedded chat and no headless modeling mode.
Use MCP tools/list as the current input/output schema authority. Only listed tools are callable.

## Additional exact feature tools

Box retains \`create_box\` millimeter shorthand and adds typed \`update_box\`.
Cylinder, pointed Cone, Sphere, ring Torus and regular Pyramid have named create/update tools.
Use complete quantity parameters, quantity origin, applicable centered state and explicit suppression;
preserve existing IDs, labels and raw expressions. These independent primitives accept no dependencies
or topology references. Wedge and truncated Cone have no registered primitive tool.

Owned drafts also expose \`remove_feature\`, \`remove_sketch\`, \`set_feature_suppressed\`
and \`rename_project\` through ordinary registered commands. Referenced records block removal;
repair consumers explicitly. Suppression is an explicit boolean, and exact preview diagnoses blocked
downstream geometry. Project rename uses a normalized nonempty name of at most 120 characters.
All lifecycle commands require manual browser review even with CAD auto-apply enabled; there is no
cascade, preserve-intent override, History navigation or generic execution authority.

Named create/update tools cover Datum Plane, Boolean subtraction, Union, Compound, Mirror,
linear/circular body Pattern, Shell, Split, Sweep, Loft and custom Thread. Choose exact
feature/output-role targets from \`model_body_measurements\` or \`draft_body_measurements\`.
Use \`draft_body_topology\` to select openings on a new draft body and create Shell before
one final Apply. Shell openings require current exact body topology references and their source content hash. Sweep
requires an already aligned profile at the start of an open tangent-continuous line/arc path;
Loft takes two to twenty-four ordered hole-free sections within a 2,000-curve aggregate budget. Thread models a custom 60-degree V groove
with at most twenty single-start turns in v2 and sixteen turns for multi-start or legacy v1,
without ISO/DIN fit certification. Use the live schema for
limits, quantities, dependencies and repair; exact preview remains mandatory.

Before writing, read the modeling skill's construction strategy. Prefer dimensioned analytical
profiles, Extrude/Revolve for straight/rotational regions, and symmetry where the source supports it.
Use Shell for a constant-thickness interior; retain explicit inner profiles for variable thickness
or protected mating geometry. A failed operation needs diagnosis before additional construction.
Mirror plane-only inputs retain v1 replacement. Supplying offset and preserveSource selects v2;
offset is a signed length along +Z/+Y/+X for XY/XZ/YZ. preserveSource=true keeps the original part
and creates a reflected result part. Join exact source/copy bodies explicitly with Union when needed.

The additive \`create_reference_mirror\`/\`update_reference_mirror\` author Mirror v3,
\`create_reference_split\`/\`update_reference_split\` author Split v2, and
\`create_reference_body_pattern\`/\`update_reference_body_pattern\` author Pattern v2.
Select an origin plane/axis, authored Datum Plane frame, stable exact-body planar face/LINE edge,
or explicit world origin in mm and unit normal/direction. Get body-bound refs from current
\`model_body_topology\` or \`draft_body_topology\`; oriented PLANE/LINE signatures must carry direction.
Dependencies are target first followed by a distinct support owner; generic references are empty.
Mirror retains typed offset/preserveSource, Split uses a signed offset along the chosen normal,
and circular Pattern obtains its center from the axis. No native index or caller content hash
is accepted. Legacy tool names keep their old versions. Preview and ordinary review remain required.

\`create_datum_plane\`/\`update_datum_plane\` use offset mode, a signed typed length and
origin support xy/xz/yz (empty dependencies/references) or an existing planar face v0 TopoRef
(exactly its owner dependency and the same persisted reference). Body-topology v1 references
cannot be substituted. Preview downstream sketches/features before commit.
\`create_boolean\`/\`update_boolean\` perform legacy whole-result subtraction: operation=subtract,
optional keepTools, exactly two distinct dependencies ordered target before tool, empty references.
Additive \`create_body_subtract\`/\`update_body_subtract\` author Subtract v2 with exact targetBody/toolBody
selectors, including distinct roles from one producer. Dependencies deduplicate producers in target/tool
order; references are empty. keepTools retains the tool Part without changing geometry identity.
\`create_body_revolve\`/\`update_body_revolve\` author Revolve v7 Add/Remove/Intersect with an exact
targetBody, canonical same-sketch profiles, typed angle and existing origin/sketch-line/model-edge axis.
Dependencies are target first, then distinct sketch-support and model-edge owners; preserve existing
sketch-support references. New Revolve keeps its existing tools. Get roles from current body measurements;
missing roles fail closed. No caller content hash or native index is accepted. Both use ordinary owned
revision-bound drafts, preview, review and Apply on local and paired remote transports.
\`create_union\`/\`update_union\` select two to eight distinct exact bodies in ordered \`bodies\`;
\`create_compound\`/\`update_compound\` select them in ordered \`slots\` with stable UUIDv7 slotId.
Both use feature schema v2. Dependencies list each producer once in first-occurrence order;
references are empty. Several roles from one producer are supported. Union requires one connected
solid and keeps the first selected part. Compound retains separate solids and body.<slotId> roles.
Preserve existing slot IDs on update. Missing roles fail closed. Manual review remains default;
an explicit browser grant permits Union v2 and Loft v1 creation and same-version edits. Compound
and schema upgrades still require manual review. Tools cannot enable the grant.

Surface texture create/update/remove use named owned proposals with native relief preview and
mandatory manual Apply. Read the modeling skill's surface-textures reference for packed custom
maps, exact face scope and bounded mask append. Geometry/planar import uses its advertised
contracts or the editor. The shared local and paired remote feature tools follow the same
draft/review/commit workflow. Read the modeling operator skill for the relevant feature family
and the export skill for file delivery.

## Assembly and local component library

Use model_assembly and inspect_assembly at the committed revision. create_assembly_draft returns
an original baseRevision and private draftVersion; retain both and use the latest returned version
for named definition/instance/joint edits. upgrade_assembly explicitly enables general v2 mates.
preview_assembly_draft evaluates exact owned geometry without saving; commit_assembly_draft always
requires browser Apply and repeats exact preflight before ordinary revision CAS and Undo.
inspect_assembly provides bounded frozen-source topology pages and explicitly requested interference.
Library source closure remains controller-owned. save_library_definition and update_library_metadata
require manual review and metadata CAS; insert/relink select immutable versions inside an assembly
draft with explicit copy/reference semantics. Read the modeling skill's assembly/library reference.
Callers cannot provide frozen pins, raw bytes, document authority or an approval flag.

## Placement and editable sketch text

\`create_placement\`/\`update_placement\` use typed translation/rotation parameters, an exact
\`targetBody\`, exactly its producer dependency and empty references. Preview exact bounds
and volume, then use ordinary manual review. Placement remains numeric rather than associative.

\`create_sketch_text\`/\`update_sketch_text\` use a stable UUIDv7 groupId, sketchId, origin
and supported text intent (text, heightMm, trackingMm, alignment, kerning). The browser uses the
pinned bundled font and generates outline entities and digest internally. No caller font metadata
is accepted. Scalar limits do not override the existing contour/pole complexity budgets. Update
requires explicit removeAttachedConstraints; replacement may require downstream selector repair.
\`detach_sketch_text\` removes text intent while preserving geometry and constraints. Preparation
reads only the owned exact-revision sketch and applies the ordinary sketch.update after async
outline generation. Cancellation, stale authority or expiry must not publish an update. Existing
sketch auto-apply policy remains unchanged; tools cannot expand the browser grant.

## Authored parts and History folders

Read \`model_parts\`, \`model_folders\` and \`model_history\` with the exact committed revision from \`model_info\`.
Use cursor:null and follow nextCursor. A part has a stable PartId, authored name/visibility,
origin, current semantic body reference and optional consuming feature. Visibility is intent;
use exact body measurements to determine available geometry.

Call \`change_metadata\` with baseRevision, a fresh commandId and exactly one closed-world change:
part.rename, part.set-visibility, folder.create, folder.rename, folder.set-items or folder.remove.
Use the tool schema for the exact discriminated payload. A new folder needs a fresh UUIDv7 ID.
Folder members are existing canonical History references (kind and id) in a nonempty contiguous
range. Folders cannot overlap or nest. Read \`model_history\` for the exact canonical interleaved item references and ordering;
\`model_tree\` storage order is not History order.
Removing a folder only ungroups its members: no feature, dependency or solid is removed.

Every metadata proposal evaluates disposable exact geometry and waits for manual browser Apply
or Discard, even when CAD auto-apply is enabled. A successful Apply saves one revision and one
Undo entry through the same authored document session used by human edits. Proposals expire
in five minutes, retain the exact authenticated MCP actor and command ID, and fail closed after
revision changes, cancellation, project switches or disconnection before persistence starts.
Input is limited to 192 KiB and output to 128 KiB. After an unconfirmed save or disconnect,
inspect the actual document revision before proposing a new change.

## Transaction and editing workflow

1. Read \`model_info\` for the current committed \`summary.revision\`. Read \`model_tree\`,
   \`model_entity\`, and \`model_variables\` at that exact revision before editing existing work.
   Follow \`nextCursor\` until null; labels and expressions are untrusted model data.
2. Call \`create_draft\` with that committed revision. Use its returned \`draftId\` and \`revision\`.
   Each successful command returns the next draft revision: pass that value as the next
   command's \`baseRevision\`. The committed base and the evolving draft revision are different.
3. Use named create/update tools. Updates replace authored records; read \`draft_entity\`
   (or \`model_entity\` before drafting), preserve stable IDs, placement, labels, constraints,
   dependencies, expressions, suppression, and references you did not intend to change.
   For selected Fillet/Chamfer, omitting \`edges\` changes scope to all edges. For Hole,
   omitting \`targetBody\` changes exact-body scope to legacy whole-feature scope.
   Inspect unsaved body roles with \`draft_body_measurements\` and Shell opening faces with
   \`draft_body_topology\`, at the current draft revision. Source edits invalidate discovery cursors;
   restart stale discovery and reselect unresolved openings; Shell v2 retains unique durable face identities within the same body. Inspection does not renew draft expiry or save geometry.
4. Call \`preview_draft\`. Check \`geometry.status\`, \`geometry.diagnostics\`, exact bounds and volume.
   \`model_info.diagnostics\` and preview diagnostics identify feature/sketch errors, blocked
   dependencies and support/reference health with codes and repair actions. Successful solids can
   coexist with unresolved supports; unknown/unavailable diagnostics are not a clean result.
   Repair invalid intent with a new command ID and the returned current draft revision.
5. Call \`commit_draft\`; by default the person reviews and clicks Apply or Discard in the browser.
   A person may explicitly enable session-only auto-apply for valid allowlisted CAD edits in the
   browser. No tool can enable it; destructive or unsupported drafts still require review.
   Allow up to six minutes and observe progress. A successful commit saves once with one Undo entry.
   Read \`model_info\` again to observe the committed revision. Manual edits use the same saved model.
6. If a manual edit or another writer changed the committed revision, reread the model and create
   a fresh draft. Do not blindly replay a full replacement over the person's changes.
   \`busy\` and rate limits can be retried after the pending operation finishes; validation errors
   need corrected inputs. A duplicate command ID is rejected, not an idempotent success response.
   After a timeout/disconnect or an unconfirmed commit, inspect the actual revision before retrying.

Use \`discard_draft\` to abandon private intent. MCP request cancellation revokes the whole pairing
and cancels disposable work; enable a new browser AI session before continuing. Cancellation after
persistence begins cannot roll back an accepted transaction. Ordinary Undo/Redo is available in the
browser, not as an MCP tool. Reopening/reloading the page requires pairing again.

## Units and IDs

Sketch coordinates and named \`*Mm\` values are millimetres, irrespective of display units.
Typed quantities carry canonical mm (length) or rad (angle), plus the authored source unit/value.
A literal 4 mm quantity is \`{ "schemaVersion": 0, "dimension": "length", "value": 4,
"unit": "mm", "source": { "value": 4, "unit": "mm", "expression": null } }\`.
For 1 inch, canonical \`value\` is 25.4 while \`source.value\` is 1 and \`source.unit\` is \`in\`.
For a variable, retain a matching numeric source and set \`source.expression\`, e.g. \`#thickness\`;
the expression is authoritative when the ordinary CAD evaluator resolves it.
Measurements declare mm, mm2 and mm3. A Revolve angle uses radians, including its canonical value.
Horizontal and vertical distance constraints are signed: the first point's coordinate minus the
second point's coordinate equals the authored value. For a point at positive X relative to an
origin anchor, use the positive point as firstPointId and the anchor as secondPointId. Initial
point coordinates are solver seeds, not substitutes for these constraints. XY sketch coordinates
map directly to world X/Y; inspect exact bounds after preview rather than assuming placement.

Command, feature, sketch, entity, constraint and variable IDs require lowercase UUIDv7.
Generate fresh IDs for new records and every attempted command; preserve existing record IDs
when editing. Use the draft ID returned by the host. \`crypto.randomUUID()\` produces UUIDv4
and is unsuitable. A portable generator using the current millisecond timestamp is:

\`\`\`js
function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = Date.now();
  for (let index = 5; index >= 0; index--) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return \`\${hex.slice(0, 8)}-\${hex.slice(8, 12)}-\${hex.slice(12, 16)}-\${hex.slice(16, 20)}-\${hex.slice(20)}\`;
}
\`\`\`

## Editable printing plate example

The JSON below describes sequential tool calls for a 40 x 24 x 4 mm plate with two 4 mm
through holes at (10,12) and (30,12). It uses a constrained rectangular sketch, variable-driven
Extrude and an independent fixed-point sketch for Hole. The expected exact volume is
\`3840 - 32*pi\` mm3. The point spacing stays fixed when the outline changes.

These are example IDs and revisions, not reusable session state. First call \`create_draft\`,
replace every example ID consistently with fresh UUIDv7 IDs (except the host-returned draft ID),
and replace each \`baseRevision\` with the latest successful result. For each entry call its \`tool\`
with \`arguments\`; the array is documentation, not a batch/execute tool. Preview, review/commit and
export are separate calls after these commands.

\`\`\`json
[
  {
    "tool": "create_variable",
    "arguments": {
      "draftId": "0195b5ac-b250-7a2c-8c33-000000000001",
      "baseRevision": 0,
      "commandId": "0195b5ac-b250-7a2c-8c33-000000000100",
      "variable": {
        "schemaVersion": 0,
        "id": "0195b5ac-b250-7a2c-8c33-000000000002",
        "name": "thickness",
        "expression": "4 mm"
      }
    }
  },
  {
    "tool": "create_sketch",
    "arguments": {
      "draftId": "0195b5ac-b250-7a2c-8c33-000000000001",
      "baseRevision": 1,
      "commandId": "0195b5ac-b250-7a2c-8c33-000000000101",
      "sketch": {
        "schemaVersion": 0,
        "id": "0195b5ac-b250-7a2c-8c33-000000000010",
        "label": "Plate outline",
        "plane": "xy",
        "entities": [
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000011",
            "type": "point",
            "x": 0,
            "y": 0,
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000012",
            "type": "point",
            "x": 40,
            "y": 0,
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000013",
            "type": "point",
            "x": 40,
            "y": 24,
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000014",
            "type": "point",
            "x": 0,
            "y": 24,
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000015",
            "type": "line",
            "startPointId": "0195b5ac-b250-7a2c-8c33-000000000011",
            "endPointId": "0195b5ac-b250-7a2c-8c33-000000000012",
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000016",
            "type": "line",
            "startPointId": "0195b5ac-b250-7a2c-8c33-000000000012",
            "endPointId": "0195b5ac-b250-7a2c-8c33-000000000013",
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000017",
            "type": "line",
            "startPointId": "0195b5ac-b250-7a2c-8c33-000000000013",
            "endPointId": "0195b5ac-b250-7a2c-8c33-000000000014",
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000018",
            "type": "line",
            "startPointId": "0195b5ac-b250-7a2c-8c33-000000000014",
            "endPointId": "0195b5ac-b250-7a2c-8c33-000000000011",
            "construction": false
          }
        ],
        "constraints": [
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000021",
            "type": "fixed",
            "pointId": "0195b5ac-b250-7a2c-8c33-000000000011"
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000022",
            "type": "horizontal",
            "lineId": "0195b5ac-b250-7a2c-8c33-000000000015"
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000023",
            "type": "vertical",
            "lineId": "0195b5ac-b250-7a2c-8c33-000000000016"
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000024",
            "type": "horizontal",
            "lineId": "0195b5ac-b250-7a2c-8c33-000000000017"
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000025",
            "type": "vertical",
            "lineId": "0195b5ac-b250-7a2c-8c33-000000000018"
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000026",
            "type": "horizontal-distance",
            "firstPointId": "0195b5ac-b250-7a2c-8c33-000000000012",
            "secondPointId": "0195b5ac-b250-7a2c-8c33-000000000011",
            "value": {
              "schemaVersion": 0,
              "dimension": "length",
              "value": 40,
              "unit": "mm",
              "source": {
                "value": 40,
                "unit": "mm",
                "expression": null
              }
            }
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000027",
            "type": "vertical-distance",
            "firstPointId": "0195b5ac-b250-7a2c-8c33-000000000013",
            "secondPointId": "0195b5ac-b250-7a2c-8c33-000000000012",
            "value": {
              "schemaVersion": 0,
              "dimension": "length",
              "value": 24,
              "unit": "mm",
              "source": {
                "value": 24,
                "unit": "mm",
                "expression": null
              }
            }
          }
        ]
      }
    }
  },
  {
    "tool": "create_extrude",
    "arguments": {
      "draftId": "0195b5ac-b250-7a2c-8c33-000000000001",
      "baseRevision": 2,
      "commandId": "0195b5ac-b250-7a2c-8c33-000000000102",
      "featureId": "0195b5ac-b250-7a2c-8c33-000000000030",
      "label": "Plate",
      "dependencies": [],
      "references": [],
      "suppressed": false,
      "parameters": {
        "profile": {
          "schemaVersion": 0,
          "sketchId": "0195b5ac-b250-7a2c-8c33-000000000010",
          "outerBoundaryEntityIds": [
            "0195b5ac-b250-7a2c-8c33-000000000015",
            "0195b5ac-b250-7a2c-8c33-000000000016",
            "0195b5ac-b250-7a2c-8c33-000000000017",
            "0195b5ac-b250-7a2c-8c33-000000000018"
          ],
          "holeBoundaryEntityIds": []
        },
        "distance": {
          "schemaVersion": 0,
          "dimension": "length",
          "value": 4,
          "unit": "mm",
          "source": {
            "value": 4,
            "unit": "mm",
            "expression": "#thickness"
          }
        },
        "symmetric": false,
        "operation": "new"
      }
    }
  },
  {
    "tool": "create_sketch",
    "arguments": {
      "draftId": "0195b5ac-b250-7a2c-8c33-000000000001",
      "baseRevision": 3,
      "commandId": "0195b5ac-b250-7a2c-8c33-000000000103",
      "sketch": {
        "schemaVersion": 0,
        "id": "0195b5ac-b250-7a2c-8c33-000000000040",
        "label": "Mounting points",
        "plane": "xy",
        "entities": [
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000041",
            "type": "point",
            "x": 10,
            "y": 12,
            "construction": false
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000042",
            "type": "point",
            "x": 30,
            "y": 12,
            "construction": false
          }
        ],
        "constraints": [
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000043",
            "type": "fixed",
            "pointId": "0195b5ac-b250-7a2c-8c33-000000000041"
          },
          {
            "schemaVersion": 0,
            "id": "0195b5ac-b250-7a2c-8c33-000000000044",
            "type": "fixed",
            "pointId": "0195b5ac-b250-7a2c-8c33-000000000042"
          }
        ]
      }
    }
  },
  {
    "tool": "create_hole",
    "arguments": {
      "draftId": "0195b5ac-b250-7a2c-8c33-000000000001",
      "baseRevision": 4,
      "commandId": "0195b5ac-b250-7a2c-8c33-000000000104",
      "featureId": "0195b5ac-b250-7a2c-8c33-000000000050",
      "label": "Mounting holes",
      "dependencies": [
        "0195b5ac-b250-7a2c-8c33-000000000030"
      ],
      "references": [],
      "suppressed": false,
      "parameters": {
        "sketchId": "0195b5ac-b250-7a2c-8c33-000000000040",
        "pointIds": [
          "0195b5ac-b250-7a2c-8c33-000000000041",
          "0195b5ac-b250-7a2c-8c33-000000000042"
        ],
        "diameter": {
          "schemaVersion": 0,
          "dimension": "length",
          "value": 4,
          "unit": "mm",
          "source": {
            "value": 4,
            "unit": "mm",
            "expression": null
          }
        },
        "direction": "forward",
        "extent": "through-all"
      }
    }
  }
]
\`\`\`

To resize thickness later: read the current model/variable ID, create a fresh draft, call
\`set_variable_expression\` with that stable variable ID and \`expression: "6 mm"\`, preview,
then commit with browser Apply. To move a hole, read the entire point sketch and use
\`update_sketch\`, preserving every unaffected entity and constraint. To change diameter,
read the Hole feature and resubmit it with \`update_hole\`, preserving its scope and dependencies.

For an L bracket, use a closed six-line outline with points \`(0,0), (40,0), (40,4),
(4,4), (4,30), (0,30)\` and extrude the profile to the desired width. Keep boundary line IDs
unique and sorted in \`outerBoundaryEntityIds\`, with \`holeBoundaryEntityIds: []\`.
Add fixed sketch points on an origin plane normal to each mounting face, then Hole features
with the preceding solid as the first dependency. Preview checks cutting direction and placement;
never guess transient face/edge indices. A supported alternative is two sketch-backed Extrudes,
with the second using Add and target-first dependencies. For existing complex sketches, complete
profile/face discovery is not yet exposed; do not infer a profile from arbitrary edge order.

## Independent extrusion depths

For independent extents, supply a profile set in \`profiles\` (including a single profile),
\`distance\`, \`secondDistance\`, \`reversed\`, \`symmetric\`, and \`operation\`.
This selects Extrude schema version 5. With \`distance: 10 mm\`, \`secondDistance: 3 mm\`,
\`reversed: false\`, and \`symmetric: false\`, the solid spans -3 to +10 mm along the
sketch normal. Reversing spans -10 to +3 mm. Use ordinary length-quantity objects as above,
not strings. Each enabled depth must be at least 0.001 mm; total span is at most 100,000 mm.
\`secondDistance: null\` selects a single direction. Symmetric requires null second depth;
its stored Distance remains the total span split equally about the sketch plane, including
existing schema versions 1–4. There is no starting offset or arbitrary direction in this contract.
All four result operations preserve their existing explicit target/support dependencies.

## Exact extrusion endpoints and fastener recesses

Extrude v6 is selected by supplying \`targetBody\`, \`startOffset\`, \`draftAngle\`, and
\`endCondition\` alongside the v5 profile/depth fields. New requires null targetBody;
Add/Remove/Intersect require one exact named body. Offset is a signed length and draft a signed
angle within 45 degrees, measured from the shifted sketch neutral plane. Distance uses
\`{kind:"distance"}\`. Through-all and up-to-body use \`{kind,targetBody,sourceContentHash}\`;
up-to-face also includes a stable body-bound planar \`face\`. Inspect the current role, topology
and content hash together. Dependencies are the modifying target first, optional sketch support,
and a distinct end producer last, with duplicate producers retained once. Dynamic endpoints
require one directional extent; stale, unreachable, ambiguous or partially covering supports fail
closed. V6 up-to-face remains limited to finite planar faces.

The additive \`create_face_extent_extrude\` and \`update_face_extent_extrude\` tools author v7
up-to-face only. Use the same advanced fields with a current exact finite planar or curved
\`BodyFaceRef\` and captured support hash from body topology inspection. Curved termination
requires one complete reachable cap, with every new cap lying on the selected finite face.
Partial patches, neighboring caps, inside starts, unreachable or stale supports fail closed;
finite surfaces are never extended implicitly. Explicit legacy upgrades require manual browser
review. A saved v7 stays v7 when its endpoint is changed to a planar face.

Hole v3 adds required \`targetBody\` and \`treatment\`: simple, counterbore with typed diameter
and depth, or countersink with typed diameter and included angle between 10 and 170 degrees.
The recess diameter exceeds the hole diameter and a blind recess leaves positive cylindrical depth.
Preserve the complete treatment, body scope, point IDs and expressions on update.

Thread v2 uses a shared origin-axis, datum-axis, stable linear-edge or explicit-axis object in
\`axis\`, without the legacy \`origin\` field. Explicit origins are mm tuples and directions
are signed unit tuples. Keep the exact target first and any distinct axis producer second;
generic references remain empty because exact edge topology stays inside the axis object.
V2 allows twenty single-start turns; multi-start and legacy XYZ-axis v1 remain bounded to sixteen.
Run-in/run-out are unthreaded allowances. Preserve complete quantity and axis intent when updating.

## Inspection, scope and limits

\`model_edges\` and \`draft_edges\` return durable selectable edge references; use only resolved
references for selected treatments. \`model_body_measurements\` returns named output roles.
\`model_body_topology\` and \`draft_body_topology\` inspect current named body edges/faces.
Their exact references and content hash select Shell openings and versioned Extrude face endpoints;
stable LINE references also select Thread axes. Edge treatments retain their separate selection
contract. Use \`draft_body_measurements\` for unsaved output roles. A newly authored single-solid
Extrude declares the body role \`result\`; preserve the exact \`targetBody\` on scoped updates.

Tools currently cover registered Box, Cylinder, Cone, Sphere, Torus and Pyramid create/update;
sketch, Extrude, Revolve and Hole create/update;
Fillet/Chamfer, Datum Plane, Boolean subtraction, Union, Compound, Mirror, body Pattern, Shell,
Split, Sweep, Loft and custom Thread create/update;
variables; bounded inspection; draft lifecycle and export; review-bound feature/sketch removal,
explicit feature suppression and project rename.
History navigation are not currently exposed through MCP. There is no
generic command, script, kernel handle or filesystem mutation tool. Print-analysis is not
a production printability report; exact geometry validity does not establish printability.

Operations are serialized: one pending MCP operation per session. Each serialized operation
must fit within 192 KiB. Semantic entity/page responses are bounded to 128 KiB; follow tool
schemas for per-page limits. Hole/selected-treatment selections allow at most 256 IDs/references.
Drafts expire five minutes after creation or the last successful command/preview; inspection does
not renew expiry. The pairing expires after one hour or loss of browser polling.

Both transports support \`prepare_model_export\` with exact committed \`revision\` and geometry
\`format\`, or \`prepare_project_backup\` for an editable \`.vshape\`. Follow \`read_export_chunk\`
byte offsets, reconstruct base64 chunks with ordinary client file tools, verify descriptor byte
length and SHA-256, then \`discard_export\`. Keep binary output out of conversation. Transfers
retain one actor-owned file up to 6 MiB for five minutes; reads do not renew expiry. Preparing
another evicts it. Remote reads share ordinary operation/rate budgets. Larger files and part
selection use the editor. A descriptor alone is not file delivery.

Alternatively, local MCP exports the successful committed revision using \`export_model\` with \`format: "step"\`, \`"stl"\`
or \`"3mf"\`. Read the returned \`resource_link.uri\` through MCP resources/read, decode its base64
blob and save the bytes using your client's ordinary file handling. Exports are limited to 6 MiB,
expire after five minutes, and become inaccessible when pairing is revoked. No path is accepted
by the tool. STL has no unit metadata; coordinates are mm. 3MF records millimetres.
`
