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
| What drives a dimension or fails expression evaluation? | `model_variables` or `draft_variables` |
| Which authored parts/folders or canonical History order? | `model_parts`, `model_folders`, `model_history` |
| Which exact body is available, with which output role? | `model_body_measurements` or `draft_body_measurements` |
| Which body faces/edges can be measured or selected for Shell? | `model_body_topology` or `draft_body_topology` |
| Which edge references can a treatment select? | `model_edges` or `draft_edges` |
| What unsaved intent is in the draft? | `draft_tree`, `draft_entity` at the current draft revision |
| Does the entire draft rebuild correctly? | `preview_draft`, followed by relevant draft reads |

Use the exact committed revision from `model_info` for model reads; draft reads use the draft's current revision and host-returned draft ID. Follow `nextCursor` until null for a complete requested collection, or stop when a targeted question is answered. Start with `cursor: null` where required. Reduce page size when a response exceeds budget. Do not mix pages across revisions.

Tree dependency summaries include authored sketch inputs for Hole, Loft and Sweep, profile inputs and Revolve axis inputs as well as producer dependencies. Read complete entity records before changing those inputs; a summary does not include all parameters or establish current geometry availability.

## Interpret evidence

Stable feature/part IDs and semantic body output roles identify authored intent. Transient OCCT face/edge indices, kernel handles, display names, and mesh order do not. Use only resolved durable references from the edge-selection tools for modeling. The body-topology tools supply current exact face references and content hash for Shell openings, including unsaved draft producers. Their references are not Hole/Fillet/Chamfer inputs; those operations retain their separate body/edge selection contracts.

Draft body measurements and topology evaluate disposable exact geometry at the owned draft's current revision. Retain returned content hashes and cursor provenance; after a source edit, restart stale discovery. Existing Shell v2 openings can retain unique durable face identity within the same exact body; explicitly reselect missing, ambiguous or unsupported openings. These reads do not save the draft or renew its expiry. `draft_tree`/`draft_entity` are authored records; `draft_edges` selects supported feature edges. Full sketch-profile discovery remains unavailable. A missing or ambiguous reference must be repaired through a supported selection route, not reconstructed from an index.

Part visibility is display intent; a consumed body may have no current geometry. Aggregate bounds can match while the wrong body or hole is present. For a requested dimensional check, inspect the relevant feature parameters and exact body measurements; use a visual view for spatial relationships that those values cannot establish.

For an invalid preview, locate the first relevant failure in diagnostics, inspect its authored dependencies/constraints/selections, and report the cause supported by that evidence. Null measurements or an inspection error are not zero volume. If correction is authorized, use [vibeshape-modeling](../vibeshape-modeling/SKILL.md) and preview again after the targeted fix.

`model_info.diagnostics` and `preview_draft.geometry.diagnostics` report feature failures, blocked dependencies, sketch/datum support resolution and external-reference health. Inspect entity IDs, codes, `blockedBy`, `supportFeatureId` and suggested `action`; successful solid measurements can coexist with invalid support diagnostics. `status: unknown` or unavailable diagnostics are not a clean result. A missing or ambiguous support requires inspecting the producer and explicitly reselecting the intended support, not adding unrelated geometry.

## Finish

Report measured values with their declared units, revision, and relevant tolerance. Separate exact kernel validity, visible appearance, slicer interpretation, and physical fit/strength. None implies the others. A request only to inspect does not authorize a commit or an export.

Use `model_measurements` and `draft_measurements` for paged feature measurements. Their `scope` defaults to `terminal`; set `scope: "all"` to inspect failed or blocked upstream features. Begin draft paging with a null cursor; another inspection target or draft edit invalidates the detached catalog.
