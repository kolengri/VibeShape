# Structural lightweighting

Use the [model-write approval policy](../../vibeshape-use/references/session.md#model-write-approval)
for the current connection. Manual review instructions below apply to external MCP clients.

Use this workflow only when `analyze_lightweighting` and `request_lightweighting` are advertised
and the user authorized preliminary structural analysis or material removal on the paired project.
Both tools run the same browser-owned worker as the editor. They are available on the local and
paired remote transports. They accept no mesh arrays, file paths, scripts, actor or approval flags.

## Capture the source and physical inputs

Structural source capture removes unreferenced vertices and welds exactly equal XYZ coordinates.
It preserves triangle positions, order, winding, surface-selection indices and the source
body/hash/revision without approximating the surface. Structural and Quick source/result meshes
have no fixed vertex or triangle count cutoff in computation. Ordinary format validity, digest and
source-identity checks still apply before publication. Quick preserved-exterior output retains the original
captured vertices and triangles. Invalid or non-finite sources still fail explicitly; selected triangle
indices must exist in the actual captured source. Input diagnostics include bounded validation paths and
messages; inspect that cause before changing a study or retrying. Passing input validation alone
does not establish a solved or feasible study.

For `runtime-unavailable`, inspect the reported stage and bounded cause. Module/package loading
failures require checking the installed build's same-origin numerical runtime assets and HTTP
responses; changing material, forces or mesh settings cannot repair a missing runtime module.
Runtime errors omit traceback frames, captured inputs and sensitive URL components.

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
   empty), and `maxIterations` (a nonnegative search budget). Poisson ratio is limited to 0–0.45. Schema validity remains authoritative. There are no fixed grid/cell/node, filter-entry,
   shell, support/load/preservation counts or forced computation deadline. The requested resolution
   and iteration budget determine actual work; browser memory remains finite. Keep long-running
   work pending or cancel explicitly. `infeasible-baseline` still means the original analyzed body
   fails the supplied loads/material/displacement constraints; do not fabricate a successful result.
   `min`, `max`, and `forceN` are numeric `[x, y, z]` arrays, never serialized strings.

   Optional `obstacleRegions` accepts positive-size world-mm `{min,max}` boxes.
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

## Select an optimization algorithm

### Compound loads and relative performance

Both paired transports accept optional `additionalLoads` on each load case. Each term has its own
`region` and nonzero numeric `forceN`; the primary term and all additional terms act simultaneously
in one solve. Every term must select valid baseline facets independently, avoid fixed supports, and
retain its load interface. A torsion couple needs opposite forces on separated patches in the same
case. Two separate opposite-force cases do not establish torsion; irregular patch placement may
also introduce bending.

Optional `settings.relativePerformance` supplies `minStiffnessFraction` and `minStrengthFraction`,
each greater than zero and at most one. Every accepted candidate and the repeated final solid must
meet both bounds in every case: candidate compliance is at most baseline compliance divided by the
stiffness fraction; candidate peak von Mises stress is at most baseline stress divided by the
strength fraction. Baseline and candidate responses must be positive; tiny responses do not bypass
the ratios. The summary echoes both fractions and transport validation rejects missing, changed,
or violated evidence. Existing absolute constraints remain required.

For the automatic bed-face/plastic workflow with exact preserved surfaces, use
[exact print optimization](print-optimization.md). Its dedicated analysis and request tools run
reconstruction and original-boundary verification before exact STEP import. The manual
`analyze_lightweighting` and `request_lightweighting` tools retain voxel snapshots;
`preserveRegions` protects nearby cells rather than exact analytical mating surfaces.
Private lattice/reference options and native face-hash arguments are not MCP settings.

### Algorithm settings

Both paired transports accept optional `settings.algorithm`. Omission keeps feasible cell removal.

- SIMP: `{kind: "simp", volumeFraction, filterRadiusMm, penalty}`. Fraction is 0.1–1 of the
  conservative baseline; filter radius is at least one cell and penalty is 1–5. When also supplying
  a maximize-stiffness objective, its retained fraction must match exactly. Inspect
  `summary.algorithm` for the echoed settings, density iteration/convergence, binary target count,
  achieved count, target status, and projection evaluations. Density convergence does not establish
  that the exported full-solid geometry reached the volume target or a global optimum.
- Adaptive TPMS: `{kind: "adaptive-lattice", lattice, cellPeriodMm, minWallThicknessMm,
  maxWallThicknessMm, skinThicknessMm, field, gamma}`. Types are `gyroid`, `schwarz-p`, and
  `schwarz-d`; field is `strain-energy` or `von-mises`, combined conservatively across cases.
  Period requires at least eight analysis cells and minimum wall at least two; maximum wall lies
  between minimum wall and half the period. Skin is 0 or at least one analysis cell. Gamma is
  0.1–8. Load/support/preserved cells remain protected. Inspect field range, requested wall range,
  conservative occupied-cube feature bound, and projection evidence. Do not call requested wall
  thickness a measured smooth-surface minimum.

Browser and MCP validation require `densityIterations` or `thresholdPasses` to equal
`summary.iterations`, which must not exceed the requested `maxIterations`.
Projection evaluations must fit that search budget (SIMP permits one additional restoration
projection) and match total FEM evaluations after baseline, density solves, and final validation.
A zero search budget permits no projection.

Every accepted result is reanalyzed as full-solid cells for every load case. Relaxed SIMP metrics
or the source field cannot substitute for final feasibility. Underresolved walls and incompatible
protected geometry fail explicitly; never weaken user constraints to obtain success. Ordinary
resource limits, stale-source protection, cancellation, review, Apply, and Undo remain authoritative.
The multi-candidate study remains editor-only; these tools run one selected algorithm/scenario.

## Analyze and request a snapshot

Use the [numerical job workflow](numerical-jobs.md): both tools return a job receipt immediately.
Read the final nested result with `get_numerical_job`; a receipt alone contains no metrics or snapshot.

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
`minimumFeatureCubeCells` is the nominal rounded-up cube size or one extra cell when eligible
nominal cubes cannot cover the baseline at the requested raw and float32 span. This does not relax
the requested minimum, and geometry without complete filled proof cubes still fails.
Support-free evidence must report zero unsupported area. Area is not support volume, support
accessibility, or a physical printability certificate. Manual review shows the complete FDM settings.

An unattainable SIMP density target below the protected-material floor skips the relaxed solve with
an explicit warning; projections use verified baseline FEM energy and still require every solid
constraint. Zero density iterations in that case do not establish density convergence.

For a stiffness-guided objective, inspect `summary.objective`: requested `retainedMassFraction`,
`targetMassKg`, `targetCellCount`, `achievedRetainedMassFraction` and `targetStatus`. The target
cell count rounds upward from the baseline fraction. `reached` means the rounded cell target was
reached and uses `target-mass-reached` termination; `not-reached` reports a remaining target gap
with a warning. Do not describe a partial target as attained. A baseline-only run with a retained
fraction of 1 can already be `reached` without material removal or a new snapshot.

Inspect `sourceVolumeMm3` and `sourceVolumeLossFraction`: conservative interior cells already omit
some original material before optimization. Baseline-to-candidate saving is separate from that
discretization loss. A finer cell size can improve source approximation while increasing memory use and calculation time. Errors require correcting the physical inputs, regions or resolution; do not weaken
the user's limits merely to obtain a successful result.

Structural solves use diagonally preconditioned conjugate gradients to avoid sparse-LU
factorization storage. A `numerical-failure` for non-convergence or equilibrium residual is not
an `infeasible-baseline` result and supplies no accepted physical metrics. Browser memory is
still finite; this method does not promise that every requested mesh fits.

When the user authorized creating the result, call `request_lightweighting` with the same complete
inputs and an English `label`. It computes again against the captured committed body. An improved
candidate is encoded as a private immutable STL or 3MF SourceAsset, inspected and shown in the ordinary
browser mesh preview together with the material, constraints, regions and analysis evidence.
External clients require manual Apply/Reject, including CAD auto-apply sessions. The job remains
pending while the user reviews it; no caller approval substitutes for browser Apply.

Apply performs one ordinary atomic import transaction and creates one Undo entry, retaining the
original Part. The saved revision can advance by several command revisions within that transaction.
The response contains bounded `summary` plus the committed `snapshot` identity: `uploadId`,
`featureId`, `outputRoles`, `documentId`, base and saved revisions. Mesh arrays never traverse the
MCP broker. A `no-improvement` response has `snapshot: null` and creates neither review nor model
mutation. Do not retry an uncertain successful Apply blindly.

The worker and paired transport impose no fixed computation deadline while the session remains live.
The private manual review lease starts after native inspection is ready and expires after five minutes. Cancellation, session revocation,
changed revision/body/hash, rejected or expired review prevents mutation. Cancellation after an
atomic persistence transaction has been accepted must report its actual outcome. Re-read the
source identity and physical regions after a stale-source error.

## Acceptance limits

Binary STL capture requires coordinate rounding within one millionth of the analysis cell size,
relative volume change at most `1e-5`, and a valid rounded manufacturing solid. Structural snapshots
automatically use exact-coordinate 3MF when STL cannot preserve the analyzed detail. The ordinary
review and import authority remains unchanged; do not coarsen the user's grid or move the source
to work around STL precision. The 3MF declares millimeter units and retains precise coordinates
through rebuild, numerical recapture, assemblies and 3MF export; Float32 coordinates remain for
display. Explicit binary STL export still has that format's precision limitations.

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
