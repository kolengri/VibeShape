# Exact automatic FDM optimization

Use this workflow when `analyze_print_optimization` and `request_print_optimization` are advertised
and the user authorizes material reduction under hypothetical automatic scenarios. Both local and
paired remote MCP use the editor's numerical solver, exact reconstruction and independent fixed-body
verification. No manual task-panel setup is needed. Follow the connection's
[model-write approval policy](../../vibeshape-use/references/session.md#model-write-approval).

## Capture source, faces and material

1. Read `model_info`, then `model_parts` at its saved revision. Select an available exact single-solid
   Part and retain its Part ID and current body producer/output role.
2. Read `model_body_topology` for that producer/output, `topologyKind: "face"` at the same revision.
   Page with its exact cursor until the relevant faces are found. Retain `contentHash` and the full
   resolved `reference` objects. These are body-scoped geometric references, never native face IDs
   or triangle indices. Missing, changed, ambiguous or mesh-unavailable references fail explicitly.
3. Choose one planar exterior `bedFace` that can support the whole part without source geometry
   below its plane. Use the returned signature's bounds, centroid and oriented direction to choose;
   inspect/render the source when needed. Do not assume a face index, model origin or axis.
   `preserveFaces` optionally contains unique full references to surfaces whose original CAD shape
   and dimensions must stay exact, including holes and mating faces. A bed face can also be preserved.
   Other exterior geometry may change. Bed orientation is distinct from mechanical clamping.
4. `settings.material` is either `{kind: "preset", presetId}` with `pla`, `petg`, `abs`, `asa`,
   `pc-blend` or `nylon`, or `{kind: "custom", properties}` with `youngModulusMpa`, `poissonRatio`,
   `yieldStrengthMpa` and `densityKgM3`. `list_lightweighting_materials` supplies the presets' sources,
   example conditions and limitations; the two metal examples are not automatic-print presets.
   Presets remain isotropic examples, not measured Z-layer allowables or physical print certification.

## Analyze or create a result

Supply `baseRevision`, `source: {partId, featureId, outputRole, contentHash}`, and `settings` with
the captured `bedFace`, material, and optional `preserveFaces`. The request tool also requires `label`.
Optional settings are `cellSizeMm`, `minFeatureSizeMm`, `layerHeightMm`, `maxIterations`,
`minStiffnessFraction`, `minStrengthFraction` and `supportMode` (`allowed` or `forbidden`).
Omitted settings use the editor's envelope and mean-wall-scale estimate (volume/surface area) to
seed resolution. Above the 0.01 mm lower bound, default cell widths are powers of two; the lattice
is anchored at zero in the selected print frame rather than an arbitrary mesh-bound residue.
This avoids nominal-width rounding failures without relaxing raw/float32 coverage checks.
The estimate is not a proof of the thinnest wall: numerical validation remains authoritative.
Explicit cell sizes remain unchanged. Defaults retain at least 0.8 mm minimum feature
size, layer height at most 0.2 mm, 24 iterations, both retention fractions 0.9, and supports allowed.
The resolved `summary.configuration` records the actual numeric settings and material properties.

The four normalized scenarios are axial tension, two bending directions and a simultaneous
opposing-force couple for torsion. One end of the longest print-frame span is assumed clamped.
These are hypothetical comparison cases; do not substitute them for user-specified real loads.
For explicit loads use [structural lightweighting](lightweighting.md), whose output remains a voxel
snapshot and whose preservation regions do not promise exact analytical surfaces.

Follow [numerical jobs](numerical-jobs.md) for receipts, cancellation and completion. An initial
`status: "running"` is not a completed analysis or saved result. Both exact tools run reconstruction,
original-boundary FEM verification and STEP inspection before returning successful improved evidence.
`analyze_print_optimization` never saves. `request_print_optimization` uses the ordinary reviewed import
path to save a separate exact Part and hide the editable source in one Undo transaction. External
clients retain the application's existing manual Apply policy; connected assistants use their existing
model authority. Do not duplicate a pending request or treat a client timeout as proof of failure.

Inspect `summary.proposal` for numerical search and convergence diagnostics; `summary.exact` gives
actual CAD source/result volumes, preserved-face count and reconstructed-body verification. Compare
its verified response against the original proposal baseline; candidate self-comparison is insufficient.
Actual savings use exact CAD volumes. A no-improvement proposal has `exact: null` and saves no snapshot.
Only a completed successful request with `snapshot` identifies a saved result; verify that revision
and the new exact Part before reporting completion. Export STEP/STL/3MF separately only when requested.

Source/revision or active native face-catalog changes invalidate pending work. Lost selected surfaces,
unprintable or disconnected geometry, failed performance gates and absent material reduction fail
closed. Native Boolean cancellation suppresses stale publication but cannot interrupt a synchronous
kernel call already running. The heuristic does not prove a global optimum; layer adhesion, infill,
fatigue and real service strength remain unmodeled. Supports are estimated, not generated, and new
cut boundaries remain unsmoothed.
