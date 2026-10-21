# Structural lightweighting

Use the [model-write approval policy](../../vibeshape-use/references/session.md#model-write-approval)
for the current connection. Manual review instructions below apply to external MCP clients.

Use this workflow only when `analyze_lightweighting` and `request_lightweighting` are advertised
and the user authorized preliminary structural analysis or material removal on the paired project.
Both tools run the same browser-owned worker as the editor. They are available on the local and
paired remote transports. They accept no mesh arrays, file paths, scripts, actor or approval flags.

## Capture the source and physical inputs

1. Read `model_info`, then `model_parts` at the same committed revision. Select one current,
   available exact solid Part, retaining its `partId` and body `featureId`/`outputRole`.
2. Read `model_body_measurements` for that body at the same revision and retain its exact
   `contentHash`. Supply all four fields under `source`, with `baseRevision`. Do not guess IDs,
   reuse an earlier body's hash, or select an imported triangle mesh. Surface relief is excluded.
3. Obtain the intended material's Young's modulus and yield strength in MPa, Poisson ratio, and
   density in kg/m³. When advertised, `list_lightweighting_materials` with empty arguments returns
   the same eight named examples as the editor: PLA, PETG, ABS, ASA, PC Blend, Nylon, aluminum
   6061-T6 and stainless steel 304. Inspect source revisions, URLs, specimen/product conditions,
   and limitations; copy the selected entry's `material` into `settings.material` and adjust for
   the actual material/process. A preset name or ID alone does not replace the numeric settings.
   Printed examples are horizontal/XY 100%-infill samples, not Z-direction strength or print
   certification. All listed Poisson ratios are explicitly assumed. Do not invent physical
   properties, treat sample means as certified design allowables, or use TPU as a supported preset.
4. Define axis-aligned support, load and preservation boxes with world-mm `min`/`max` triples,
   or current source surface regions `{kind: "surface", triangleIndices, depthMm}`. Surface
   indices refer only to the exact captured source tessellation at this body/hash/revision and
   `depthMm` defines the inward preservation depth. They are not persistent face identities,
   `TopoRef` IDs or triangle IDs from an imported result. Do not guess indices from render images
   or face order; use explicit current source indices when available, otherwise use physical boxes.
   Supports clamp selected exterior FEM nodes in all directions. Each uniquely named load case
   supplies a nonzero total `forceN` vector in newtons, distributed over complete exterior facets
   inside its region. Loaded facets must not touch support nodes. Verify the regions against the
   current bounds and mesh resolution; they do not follow later source edits.
5. Supply `safetyFactor` (at least 1), `maxDisplacementMm`, `cellSizeMm`, `preserveRegions` (possibly
   empty), and `maxIterations` (0–40). Poisson ratio is limited to 0–0.45. Schema bounds remain
   authoritative. Analysis is limited to 20,000 source triangles, 10,000 source vertices,
   3,000 FEM cells, 5,000 nodes and 8 load cases.

   Optional `obstacleRegions` accepts up to sixteen positive-size world-mm `{min,max}` boxes.
   Any closed FEM-cell box intersecting a keep-out box is excluded before baseline analysis,
   including boundary contact and the permitted STL coordinate-rounding margin. Intersections with
   support, load, or preserved cells fail explicitly.
   Exclusion can disconnect or invalidate the baseline. Mass targets refer to the remaining feasible
   baseline; source-volume loss includes excluded material as well as voxelization loss.

   Optional `fdm` supplies `buildDirection` (`+x`, `-x`, `+y`, `-y`, `+z`, or `-z`),
   `supportMode` (`forbidden` or `allowed`), `minFeatureSizeMm`, `layerHeightMm`, and
   `maxOverhangAngleDeg` (0–89 degrees from vertical). Both policies enforce a conservative
   filled-cube bound in solver and captured float32 geometry. Layer height must not exceed voxel
   cell size and the smallest actual raw/float32 build-axis slice for the one-slice support check.
   Exact cell-size equality can fail after rounding; decrease layer height. Both policies enforce the requested
   minimum-feature bound. `forbidden` additionally requires no unsupported area;
   `allowed` reports that area without generating supports. An incompatible baseline fails instead
   of relaxing these limits. No extrusion, bridging, adhesion, infill, or layer-strength simulation
   is implied. Build direction changes the analysis, not the exported mesh coordinates; reproduce
   it during print preparation. Omission keeps the prior structural behavior.

6. `objective` is optional. Omission or `{kind: "minimize-mass"}` retains the existing
   mass-reduction search. `{kind: "maximize-stiffness", retainedMassFraction}` uses a retained
   mass fraction of 0.1–1 relative to the conservative FEM baseline, not the original exact solid.
   It guides removal by increasing maximum cell strain energy across load cases until the rounded mass
   target or another stop condition. This is an approximate stiffness-guided removal heuristic;
   it does not solve a globally optimal minimum-compliance or generative-design problem.

## Analyze and request a snapshot

`analyze_lightweighting` computes bounded baseline and feasible-candidate evidence without editing
the model or requesting Apply. `maxIterations: 0` evaluates the baseline without removal. Examine
the baseline and optimized volume/mass, worst stress, displacement, achieved safety factor and
every named case. The feasible baseline must already satisfy all requested stress/safety and
displacement constraints; an infeasible or underconstrained model fails instead of returning an
accepted candidate. Compliance is reported per case as analysis evidence. The search ranks cells
by the maximum strain energy across cases, rechecks physical feasibility after accepted removal,
and reduces infeasible removal batches; it does not compare full candidate compliance to establish
maximum stiffness.

For requested FDM constraints, inspect `summary.fdm`: its echoed `settings` must match the request,
and `baseline`/`optimized` report `unsupportedAreaMm2`, `requiresSupports`,
`minFeatureSizeBoundMm`, and `buildHeightMm`. The minimum-feature bound must satisfy the request;
support-free evidence must report zero unsupported area. Area is not support volume, support
accessibility, or a physical printability certificate. Manual review shows the complete FDM settings.

For a stiffness-guided objective, inspect `summary.objective`: requested `retainedMassFraction`,
`targetMassKg`, `targetCellCount`, `achievedRetainedMassFraction` and `targetStatus`. The target
cell count rounds upward from the baseline fraction. `reached` means the rounded cell target was
reached and uses `target-mass-reached` termination; `not-reached` reports a remaining target gap
with a warning. Do not describe a partial target as attained. A baseline-only run with a retained
fraction of 1 can already be `reached` without material removal or a new snapshot.

Inspect `sourceVolumeMm3` and `sourceVolumeLossFraction`: conservative interior cells already omit
some original material before optimization. Baseline-to-candidate saving is separate from that
discretization loss. A finer cell size can improve source approximation while exceeding the cell
or node budget. Errors require correcting the physical inputs, regions or resolution; do not weaken
the user's limits merely to obtain a successful result.

When the user authorized creating the result, call `request_lightweighting` with the same complete
inputs and an English `label`. It computes again against the captured committed body. An improved
candidate is encoded as a private immutable STL SourceAsset, inspected and shown in the ordinary
browser mesh preview together with the material, constraints, regions and analysis evidence.
External clients require manual Apply/Reject, including CAD auto-apply sessions. Keep the tool call open
while the user reviews it; no caller approval substitutes for browser Apply.

Apply performs one ordinary atomic import transaction and creates one Undo entry, retaining the
original Part. The saved revision can advance by several command revisions within that transaction.
The response contains bounded `summary` plus the committed `snapshot` identity: `uploadId`,
`featureId`, `outputRoles`, `documentId`, base and saved revisions. Mesh arrays never traverse the
MCP broker. A `no-improvement` response has `snapshot: null` and creates neither review nor model
mutation. Do not retry an uncertain successful Apply blindly.

The worker has a three-minute compute budget; transport budgets are scoped to these tools.
The private import/review lease expires after five minutes. Cancellation, session revocation,
changed revision/body/hash, rejected or expired review prevents mutation. Cancellation after an
atomic persistence transaction has been accepted must report its actual outcome. Re-read the
source identity and physical regions after a stale-source error.

## Acceptance limits

Binary STL capture is gated before evidence publication: coordinate rounding must stay within one
millionth of the analysis cell size and the rounded mesh must remain a valid manufacturing solid.
For `serialization-precision`, move the source closer to the origin or choose coarser cells, then
recapture its current revision/body/hash. Do not apply rounded geometry against earlier metrics.

This is an independent unsmoothed FEM-cell mesh snapshot, not an exact CAD feature or live
regenerating topology optimization. The bounded material-removal search does not establish a
global minimum. Results use preliminary isotropic small-deformation linear elasticity and the
specified loads/constraints; they do not establish physical strength, fatigue, buckling, contact,
manufacturability or print performance. Keep those limits visible when presenting the metrics.
Export or back up the committed snapshot only when requested, through `vibeshape-export`.

The editor also offers a bounded multi-material/mass-target Generative Design study. It is not a
new paired MCP tool: these tools still analyze/request one scenario at a time. Do not claim automatic
study comparison or candidate selection through MCP. The editor study does not add manufacturing
constraints, CAD reconstruction, global-optimum guarantees, or physical strength certification.

Apply keeps the editable source in the Parts tree and hides it in the same atomic transaction
as the new mesh, preventing it from covering the result. One Undo removes the mesh and restores
the source visibility. Show the source again through its normal visibility control when needed.
