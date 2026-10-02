export const authoringGuide = `# VibeShape MCP authoring guide

Read \`vibeshape://session\` for the actual \`editorUrl\` and current \`paired\` status.
This resource works before pairing and contains no credentials or document data.
Open that URL, open/create the intended project, and have the person click **Enable AI session**.
The browser retains the document authority; there is no embedded chat and no headless modeling mode.
Use MCP tools/list as the current input/output schema authority. Only listed tools are callable.

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
4. Call \`preview_draft\`. Check \`geometry.status\`, diagnostics, exact bounds and volume.
   Repair invalid intent with a new command ID and the returned current draft revision.
5. Call \`commit_draft\`; the person reviews and clicks Apply or Discard in the browser.
   Allow up to six minutes and observe progress. A successful Apply saves once with one Undo entry.
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

## Inspection, scope and limits

\`model_edges\` and \`draft_edges\` return durable selectable edge references; use only resolved
references for selected treatments. \`model_body_measurements\` returns named output roles.
\`model_body_topology\` can inspect committed body edges/faces, but those body-scoped topology
references are currently not accepted by modeling tools. Draft body/face/profile inspection
is not exposed. A newly authored single-solid Extrude declares the body role \`result\`; use
legacy Hole semantics in the example, or preserve a known exact \`targetBody\` on update.

Tools currently cover Box creation; sketch, Extrude, Revolve and Hole create/update;
Fillet/Chamfer create/update; variables; bounded inspection; draft lifecycle and export.
Box update/placement, Cylinder, Boolean, Datum Plane, feature/sketch removal, suppression,
model rename and history navigation are not currently exposed through MCP. There is no
generic command, script, kernel handle or filesystem mutation tool. Print-analysis is not
a production printability report; exact geometry validity does not establish printability.

Operations are serialized: one pending MCP operation per session. Each serialized operation
must fit within 192 KiB. Semantic entity/page responses are bounded to 128 KiB; follow tool
schemas for per-page limits. Hole/selected-treatment selections allow at most 256 IDs/references.
Drafts expire five minutes after creation or the last successful command/preview; inspection does
not renew expiry. The pairing expires after one hour or loss of browser polling.

Export the successful committed revision using \`export_model\` with \`format: "step"\`, \`"stl"\`
or \`"3mf"\`. Read the returned \`resource_link.uri\` through MCP resources/read, decode its base64
blob and save the bytes using your client's ordinary file handling. Exports are limited to 6 MiB,
expire after five minutes, and become inaccessible when pairing is revoked. No path is accepted
by the tool. STL has no unit metadata; coordinates are mm. 3MF records millimetres.
`
