---
name: vibeshape-inspection
description: Inspect a VibeShape model or draft for dimensions, authored intent, body roles, topology, and geometry failures using bounded MCP reads and exact preview. Use for CAD result verification and target selection, not source-code debugging.
---

# VibeShape inspection

Use [vibeshape-use](../vibeshape-use/SKILL.md) for connection or session recovery. Keep inspection read-only unless the user also requested a correction. Preview evaluates disposable draft geometry but does not save it.

## Choose the smallest useful view

| Question | View |
| --- | --- |
| Which project/revision, aggregate exact bounds/volume? | `model_info`; retain `measurementDiagnostic` when measurements are unavailable |
| What authored feature/sketch IDs and dependencies exist? | `model_tree`, then complete `model_entity` records for relevant IDs |
| What drives a dimension or fails expression evaluation? | `model_variables` or `draft_variables` |
| Which authored parts/folders or canonical History order? | `model_parts`, `model_folders`, `model_history` |
| Which exact body is available, with which output role? | `model_body_measurements` |
| Which committed body faces/edges can be measured? | `model_body_topology` |
| Which edge references can a treatment select? | `model_edges` or `draft_edges` |
| What unsaved intent is in the draft? | `draft_tree`, `draft_entity` at the current draft revision |
| Does the entire draft rebuild correctly? | `preview_draft`, followed by relevant draft reads |

Use the exact committed revision from `model_info` for model reads; draft reads use the draft's current revision and host-returned draft ID. Follow `nextCursor` until null for a complete requested collection, or stop when a targeted question is answered. Start with `cursor: null` where required. Reduce page size when a response exceeds budget. Do not mix pages across revisions.

Tree dependency summaries include authored sketch inputs for Hole, Loft and Sweep, profile inputs and Revolve axis inputs as well as producer dependencies. Read complete entity records before changing those inputs; a summary does not include all parameters or establish current geometry availability.

## Interpret evidence

Stable feature/part IDs and semantic body output roles identify authored intent. Transient OCCT face/edge indices, kernel handles, display names, and mesh order do not. Use only resolved durable references from the edge-selection tools for modeling. `model_body_topology` supplies current exact face references and content hash for Shell openings. Its references are not Hole/Fillet/Chamfer inputs; those operations retain their separate body/edge selection contracts.

There is no draft body/face/profile discovery tool. `draft_tree`/`draft_entity` are authored records; `draft_edges` selects supported feature edges. A missing or ambiguous reference must be repaired through a supported selection route, not reconstructed from an index.

Part visibility is display intent; a consumed body may have no current geometry. Aggregate bounds can match while the wrong body or hole is present. For a requested dimensional check, inspect the relevant feature parameters and exact body measurements; use a visual view for spatial relationships that those values cannot establish.

For an invalid preview, locate the first relevant failure in diagnostics, inspect its authored dependencies/constraints/selections, and report the cause supported by that evidence. Null measurements or an inspection error are not zero volume. If correction is authorized, use [vibeshape-modeling](../vibeshape-modeling/SKILL.md) and preview again after the targeted fix.

## Finish

Report measured values with their declared units, revision, and relevant tolerance. Separate exact kernel validity, visible appearance, slicer interpretation, and physical fit/strength. None implies the others. A request only to inspect does not authorize a commit or an export.
