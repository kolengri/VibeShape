# Quick load-free lightweighting

Use the [model-write approval policy](../../vibeshape-use/references/session.md#model-write-approval)
for the current connection. Manual review instructions below apply to external MCP clients;
library publication remains separately reviewed for every connection.

Use this workflow when `analyze_quick_lightweighting` and `request_quick_lightweighting` are
advertised and the user authorized load-free material removal. Both paired local and remote MCP
use the editor's browser worker. These tools generate periodic lattice geometry and do not analyze loads,
material strength, stiffness, safety factors, fatigue, buckling or printing performance.
For explicit loads and constraints, use [structural lightweighting](lightweighting.md).

## Capture the source and settings

Read `model_info` and `model_parts` at the same committed revision. Choose one available exact
single-solid Part and retain its `partId`, body `featureId` and `outputRole`. Read
`model_body_measurements` for the same body/revision and retain `contentHash`. Supply these four
fields under `source`, with `baseRevision`. Imported triangle meshes and textured display meshes
are not source solids. Never guess identities or reuse a hash after a source edit.

Supply the complete `settings`:

- `mode`: `preserve-exterior` retains the source exterior triangles and creates closed interior
  voids; `open-organic` generates an inset, openly perforated envelope and changes the exterior.
- `removalPercent`: requested removal, 5–80%. Skin, source shape and resolution may limit it.
- `cellType`: optional `gyroid`, `schwarz-p` or `schwarz-d`; omission selects Gyroid.
  Schwarz P and Schwarz D select different periodic field geometry, without a strength ranking.
- `latticeCellSizeMm`: independent physical lattice period in mm. Omission uses six times
  `cellSizeMm` for Gyroid and Schwarz P, or twelve times for Schwarz D to resolve its finer pattern. The period must be between six and twelve sampling cells (absolute schema
  bounds 0.06–12,000 mm). This controls geometric spacing, rather than the sampling detail.
- `cellSizeMm`: sampling detail in mm, 0.01–1,000. Smaller detail can exceed the worker's
  resolution budget. Keep this separate from the requested physical lattice period.
- `skinThicknessMm`: 0–1,000 mm; preserve-exterior requires at least two sampling cells.
  Open-organic ignores skin thickness; use zero.

Live schemas remain authoritative. Source input is bounded to 10,000 vertices and 20,000 triangles;
output is bounded to 80,000 vertices and 140,000 triangles. The browser-owned Web Worker uses
local WebAssembly and adaptive batches to bound intermediate memory. Quick generation has no
fixed elapsed-time or cumulative-query cutoff, including local and remote MCP operation handling.
Keep the request pending; cancellation, pairing revocation and source changes still invalidate it.
The paired session lifetime and five-minute private import/review lease remain enforced.
Schwarz D at the six-sample boundary can produce disconnected material; start at its twelve-sample
default and inspect the actual outcome. Larger cells or finer sampling can resolve a failed pattern.
No material values, mesh arrays, scripts, file paths, actor fields or approval flags are accepted
by these MCP tools.

## Analyze and save the candidate

`analyze_quick_lightweighting` computes without model mutation or Apply review. Inspect
`sourceVolumeMm3`, `resultVolumeMm3`, `removedPercent`, `requestedRemovalPercent`, mode, skin,
`cellType`, `latticeCellSizeMm`, sampling detail and warnings. Removal is measured from the output geometry and may differ from the
requested target. A candidate with less than 0.5% measured removal fails with
`no-removable-material`; do not fabricate a success or weaken agreed geometry requirements.

When creating the result is authorized, call `request_quick_lightweighting` with the same complete
inputs and an English `label`. It computes against the captured source and privately stages an
immutable STL SourceAsset for the ordinary browser mesh preview. External clients require manual Apply/Discard, including CAD auto-apply sessions. Keep the request open while the person reviews it.

Apply retains the original Part, commits one ordinary atomic import transaction and creates one
Undo entry. The result contains bounded `summary` and the committed `snapshot` identity:
`uploadId`, `featureId`, `outputRoles`, `documentId`, base revision and saved revision. The saved
revision can advance by several commands inside that transaction. Mesh arrays never cross MCP.

The private import/review lease expires after five minutes. Cancellation, revoked pairing,
changed revision/body/hash or rejected/expired review prevents mutation. Once atomic persistence
has accepted the transaction, cancellation must report its actual saved outcome. Do not retry an
uncertain successful Apply blindly. Re-read source identity after a stale-source error.

## Acceptance limits

STL rounding is checked before evidence publication and import inspection validates the saved
manufacturing solid. This remains an independent triangle-mesh snapshot, without an exact CAD
feature or live regeneration. Preserved exterior mode creates enclosed cavities, which require a
process capable of producing them; open-organic changes the original envelope. Neither mode
establishes maximum stiffness, structural feasibility, printer suitability or physical strength.
Export or back up a committed result only when requested, through
[vibeshape-export](../../vibeshape-export/SKILL.md).

Apply keeps the editable source in the Parts tree and hides it in the same atomic transaction
as the new mesh, preventing it from covering the result. One Undo removes the mesh and restores
the source visibility. Show the source again through its normal visibility control when needed.
