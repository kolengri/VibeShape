---
name: vibeshape-inspection
description: Inspect a VibeShape model or draft for dimensions, authored intent, body roles, topology, and geometry failures using bounded MCP reads and exact preview. Use for CAD result verification and target selection, not source-code debugging.
---

# VibeShape inspection

Use [vibeshape-use](../vibeshape-use/SKILL.md) for connection or session recovery. Keep inspection read-only unless the user also requested a correction. Preview evaluates disposable draft geometry but does not save it.

## Choose the smallest useful view

| Question | View |
| --- | --- |
| Which project/revision, aggregate exact bounds/volume and model health? | `model_info`; inspect `diagnostics` and retain `measurementDiagnostic` when measurements are unavailable |
| What authored feature/sketch IDs and dependencies exist? | `model_tree`, then complete `model_entity` records for relevant IDs |
| What solved coordinates, DOF, conflicts and usable sketch profiles exist? | `model_sketch_solution` or `draft_sketch_solution` |
| What drives a dimension or fails expression evaluation? | `model_variables` or `draft_variables` |
| Which authored parts/folders or canonical History order? | `model_parts`, `model_folders`, `model_history` |
| Which exact body is available, with which output role? | `model_body_measurements` or `draft_body_measurements` |
| Which exact body faces/edges can be measured or selected by supported features? | `model_body_topology` or `draft_body_topology` |
| Which edge references can a treatment select? | `model_edges` or `draft_edges` |
| What unsaved intent is in the draft? | `draft_tree`, `draft_entity` at the current draft revision |
| Which assembly instances/mates, frozen frames, local DOF or exact interference? | `model_assembly`, `inspect_assembly`; explicit pairs and occurrence/source topology page |
| Which immutable local component version is available? | `library_items`, `library_version` |
| Does the entire draft rebuild correctly? | `preview_draft`, followed by relevant draft reads |
| Does the visible CAD shape match the requested form and spatial relationships? | `render_preview` at the exact model or owned draft revision |

Use the exact committed revision from `model_info` for model reads; draft reads use the draft's current revision and host-returned draft ID. Follow `nextCursor` until null for a complete requested collection, or stop when a targeted question is answered. Start with `cursor: null` where required. Reduce page size when a response exceeds budget. Do not mix pages across revisions.

Tree dependency summaries include authored sketch inputs for Hole, Loft and Sweep, profile inputs and Revolve axis inputs as well as producer dependencies. Read complete entity records before changing those inputs; a summary does not include all parameters or establish current geometry availability.

## Visual inspection

Use `render_preview` after meaningful construction steps and before accepting a shape-dependent
result. Both local and remote MCP return a native PNG image content block plus structured metadata;
the host must pass image content to a vision-capable model. A text-only client cannot inspect the
picture by reading its metadata or base64.

For saved geometry, supply `source: "model"` and `revision` from `model_info`. For unsaved geometry,
supply `source: "draft"`, the owned `draftId`, and its current `revision`. Start with
`quality: "overview"` (also used when omitted): one isometric view within 768 × 576 total pixels.
For small features or shape verification, choose `quality: "detail"`, an exact body target and
relevant views or a close-up. Detail defaults to the legacy labeled isometric/front/right/top
collage within 1024 × 768 total pixels. Either policy may return a smaller raster to fit the
unchanged byte budget; the required top-level `quality` metadata identifies the selected policy,
not an exact resolution guarantee. Explicit one to four unique standard `views` retain their order
independently of quality. Optional `target: { featureId, outputRole }` selects one exact body from
body measurements, including a historical producer output. A missing body fails instead of falling
back to another body.

For an arbitrary angle or a close-up, supply `camera` instead of `views`. `camera.position` and
`camera.target` are world-space XYZ triples in millimeters; `camera.up` is an optional nonzero,
nonparallel orientation vector. Omit it for the default Z-up orientation with a pole-safe fallback.
The projection is orthographic: set `camera.viewHeightMm` to the visible vertical span in millimeters
to zoom into the target region; changing camera distance alone does not zoom. Without that span,
the custom view automatically fits all requested bodies. A close-up intentionally crops the rest
of the model, so retain an overview when evaluating the whole shape. Custom output is labeled
`custom`, and metadata echoes the requested camera. Coordinates and view span are bounded by the
live tool schema. Target and camera remain independent of quality; overview never discards other
bodies unless an exact target is supplied. Never estimate exact dimensions from apparent pixel sizes.

Automation previously defaulted to four views; choose `quality: "detail"` to restore that policy.
Old strict clients can reject the added result field, and old strict servers can reject the request
option. Do not assume mixed-version compatibility.

The renderer fits full CAD body meshes on a separate canvas without changing the user's camera,
selection, saved model or Undo history. It reports document/revision/generation, rendered body count
and `geometryStatus`. An invalid rebuild may show surviving bodies: use numerical diagnostics to
find missing/failed features, then repair the cause. Views cover CAD body geometry rather than
assembly occurrence placement or surface-relief layers; unsupported representations fail explicitly.
Hidden terminal bodies may be included because part visibility is display intent.

Check silhouettes, opening orientation and body placement against the request. Render another
relevant angle when occlusion hides the evidence. Pictures do not establish dimensions, minimum wall
thickness, clearance, exact topology, printability or physical fit; exact measurements remain
authoritative. Retain the corresponding numerical checks. Re-render after edits rather than
combining evidence from different revisions.

## Interpret numerical evidence

Stable feature/part IDs and semantic body output roles identify authored intent. Transient OCCT face/edge indices, kernel handles, display names, and mesh order do not. Use only resolved durable references from the edge-selection tools for modeling. Body-topology tools supply current exact references and content hashes, including unsaved draft producers. Shell openings, planar Extrude endpoints (v6/v7), finite curved-face Extrude endpoints (v7), and Loft v3 end constraints consume their supported face contracts; follow the [modeling reference](../vibeshape-modeling/references/modeling.md) for each version. These face references are not Hole/Fillet/Chamfer inputs; those operations retain their separate body/edge selection contracts.

Draft body measurements and topology evaluate disposable exact geometry at the owned draft's current revision. Retain returned content hashes and cursor provenance; after a source edit, restart stale discovery. Existing Shell v2 openings can retain unique durable face identity within the same exact body; explicitly reselect missing, ambiguous or unsupported openings. These reads do not save the draft or renew its expiry. `draft_tree`/`draft_entity` are authored records; `draft_edges` selects supported feature edges. Solved sketch profiles are discovered through `model_sketch_solution` or `draft_sketch_solution`. A missing or ambiguous reference must be repaired through a supported selection route, not reconstructed from an index.

Solved sketch reads return status, remaining degrees of freedom and solver provenance on every page. Choose `section: "points"`, `"circles"`, `"failed-constraints"`, `"profiles"` (default), or `"diagnostics"`. Profile pages supply stable boundary selectors, area/perimeter/bounds; use these selectors directly in supported feature tools. Authored point coordinates may differ from solved coordinates; inspection does not save them. Cursors bind an opaque inspection ID and section. Restart with a null cursor after an edit, target change, eviction or cancellation; do not reuse a cursor for another section. An open, ambiguous or conflicting sketch can have no usable profile. Inspect its status and diagnostics instead of inventing a profile index.

Part visibility is display intent; a consumed body may have no current geometry. Aggregate bounds can match while the wrong body or hole is present. For a requested dimensional check, inspect the relevant feature parameters and exact body measurements; use a visual view for spatial relationships that those values cannot establish.

For an invalid preview, locate the first relevant failure in diagnostics, inspect its authored dependencies/constraints/selections, and report the cause supported by that evidence. Null measurements or an inspection error are not zero volume. If correction is authorized, use [vibeshape-modeling](../vibeshape-modeling/SKILL.md) and preview again after the targeted fix.

`model_info.diagnostics` and `preview_draft.geometry.diagnostics` report feature failures, blocked dependencies, sketch/datum support resolution and external-reference health. Inspect entity IDs, codes, `blockedBy`, `supportFeatureId` and suggested `action`; successful solid measurements can coexist with invalid support diagnostics. `status: unknown` or unavailable diagnostics are not a clean result. A missing or ambiguous support requires inspecting the producer and explicitly reselecting the intended support, not adding unrelated geometry.

## Finish

Report measured values with their declared units, revision, and relevant tolerance. Separate exact kernel validity, visible appearance, slicer interpretation, and physical fit/strength. None implies the others. A request only to inspect does not authorize a commit or an export.

Use `model_measurements` and `draft_measurements` for paged feature measurements. Their `scope` defaults to `terminal`; set `scope: "all"` to inspect failed or blocked upstream features. Begin draft paging with a null cursor; another inspection target or draft edit invalidates the detached catalog.

Assembly inspection omits meshes and frozen source bytes. Topology pages bind an occurrence/source to its body and pin revision; use only uniquely resolved analytical recipes for frame binding. Relinking requires fresh selection. Local DOF is mobility at the solved branch, not global uniqueness. Assembly previews retain the original committed base and private draft version; follow the [assembly/library workflow](../vibeshape-modeling/references/assembly-and-library.md).
