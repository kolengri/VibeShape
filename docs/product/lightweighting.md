# Structural lightweighting

The **Lightweighting** button opens **Optimize for 3D printing** by default. Select a flat exterior
bed face, a plastic example or custom material properties, and any faces to preserve; then choose
**Optimize for printing**. The remaining exterior may change within the original design envelope.
**Set real supports and loads manually** opens the existing structural task described below.

## Automatic print optimization

The automatic task generates four normalized comparison scenarios: axial tension, bending in two
directions, and one opposing-force couple for torsion. One end of the longest print-frame span is
assumed clamped; the bed face only determines print orientation. The couple acts simultaneously in
one FEM solve. Irregular traction patches can also introduce bending. These scenarios do not infer
actual service supports or loads.

By default, every accepted solid retains at least 90% of baseline stiffness and 90% of normalized
load capacity in each scenario. Advanced settings expose both targets, resolution, minimum feature
size, layer height, iterations and support policy. Retained stiffness is baseline compliance divided
by candidate compliance; normalized load capacity is baseline peak stress divided by candidate peak
stress under the same normalized forces. The solver seeks a lighter feasible binary projection of
a SIMP density field; it does not prove a global mass/strength optimum. If no improved feasible solid
is found, Apply stays disabled. Generated support/load interfaces are retained automatically in
addition to user-preserved regions.

When the density target is below protected material plus the minimum free density, SIMP skips the
unattainable relaxed solve with an explicit warning and ranks using verified baseline FEM energy.
A failed relaxed density solve also stops iteration explicitly. Reconstruction then
uses the last verified density ranking (baseline FEM energy if no density solve succeeded), with
budgeted trials that include small removals near the full baseline. This can yield modest savings;
it never relaxes equilibrium or per-case performance checks, and does not imply density convergence.

Print settings default to supports allowed, 45 degrees from vertical, a layer height at most
0.2 mm, and a minimum feature size at least 0.8 mm (or one analysis cell when larger). Both FDM
policies verify the baseline and final solid. Finer resolution may be needed for thin or curved
features; infeasible baselines fail without relaxing constraints. Support-free mode cannot repair
an initially unsupported baseline. Support area is estimated; no supports or toolpaths are generated.
Minimum-feature coverage first uses filled cubes of `ceil(minimum / cellSize)` cells. If eligible
cubes cannot cover the baseline because captured spans undershoot in raw or Float32 geometry,
the proof tries one additional cell. The requested thickness remains unchanged; thin geometry without a complete
larger cube still fails.

The selected bed face must be planar and support the whole source without geometry below its
plane. Computation rotates a captured copy into print coordinates and restores the exact CAD result
to the original placement. Reports include the transform and normalized scenario assumptions;
print preparation must reproduce that orientation. Selected regions bind to the captured revision
and body hash; changing the source invalidates them and any result.

Selected original CAD faces and their dimensions remain exact, including curved holes and mating
surfaces. After voxel optimization, the native kernel removes material outside the retained cells
and protected interface skins, proves each selected face is unchanged, and exports a new exact
solid to STEP. It rejects lost faces, disconnected solids, invalid geometry and no actual material
reduction. Conservative protected skins can prevent useful savings; preserving a full curved face
does not freeze its entire bounding box.

The reconstructed body is analyzed again on the original FEM lattice planes, against every original
scenario and retention target. Its STEP bytes are independently inspected before preview and Apply.
Apply adds a separate exact CAD Part through ordinary import and one Undo entry; the original stays
editable. Reports distinguish the voxel proposal from reconstructed-body verification and use exact
CAD volume for material savings. A source/display face-catalog change invalidates face selections.

Plastic presets and custom properties still use isotropic elasticity. Layer adhesion, infill,
fatigue, thermal distortion and real service strength are not modeled. Unprotected voxel boundaries
are not automatically smoothed. See [ADR-0141](../adr/0141-exact-preserved-print-interfaces.md).

Both paired MCP transports expose `analyze_print_optimization` and `request_print_optimization`
for this complete exact workflow, including face discovery, plastic/custom properties, settings,
background jobs and reviewed publication. See the [exact-print operator workflow](../../.agents/skills/vibeshape-modeling/references/print-optimization.md)
and [ADR-0142](../adr/0142-exact-print-optimization-mcp.md). The analysis tool also reconstructs
and verifies the exact candidate without saving it.

## Manual structural optimization

The manual task reduces occupied material while satisfying supplied
von Mises stress, safety-factor, and displacement limits in every load case. Choose feasible cell removal, filtered SIMP topology optimization, or an FEM-graded lattice.
All modes verify the final occupied solid; none proves a global optimum or certifies physical strength.
`analyze_lightweighting` and `request_lightweighting` expose the same browser calculation through
paired local and remote MCP. See the [operator reference](../../.agents/skills/vibeshape-modeling/references/lightweighting.md).

The toolbar button uses the same registered command as the command palette and a native SVG icon.
Opening the responsive right task panel captures one unambiguous selected exact Part (from the tree or a viewport body/face)
and prefills its source. Missing, unavailable, hidden, mesh, or ambiguous targets
remain unselected. A later viewport selection does not replace the source being edited in the panel.

## Inputs and numerical model

Choose one available, valid exact single-solid Part, or keep the valid selected Part prefilled on opening. Analysis uses its pristine display
tessellation, excluding surface textures. Capture removes unreferenced vertices and welds only
exactly equal XYZ coordinates. This preserves every triangle's
coordinates, order and winding, including selected surface regions; it does not simplify geometry
or approximate the surface. The computation schemas and solvers impose no fixed vertex or triangle
count cutoff. Finite coordinates, complete triangles and valid indices remain required; surface selections
are checked against the actual captured triangle count. Invalid inputs retain bounded validation
paths and messages. Dense tessellations still increase memory and proximity-query work.
Enter Young's modulus and yield strength in MPa, density
in kg/m3, Poisson ratio, required safety factor, maximum displacement in mm, cell size in mm, and
total forces in N. Choose **Custom material** or an editable named material example. The application
does not infer a material grade or print process from geometry. Changing a preset cancels pending
analysis and invalidates its result; manually editing a material value labels it Custom without
discarding the other values. Loads, supports and constraints are not changed by a material preset.

### Material examples

The shared `@vibeshape/domain/lightweighting-materials` catalog supplies both the selector and the
read-only paired MCP tool `list_lightweighting_materials` (empty arguments). Copy a catalog entry's
`material` into the existing analysis/request `settings.material`; no preset ID replaces those
explicit numeric inputs. The catalog is shipped locally and does not fetch data at runtime.

Values below are published sample means for polymers and stated minimum 0.2% proof stress for
metals. Source revisions and URLs are shown for the selected example and returned by MCP.

| Example / source | Tensile E (MPa) | Yield (MPa) | Density (kg/m³) | Specimen / product condition |
| --- | ---: | ---: | ---: | --- |
| [PLA — Prusament](https://prusament.com/wp-content/uploads/2022/10/PLA_Prusament_TDS_2021_10_EN.pdf) | 2300 | 51 | 1240 | Horizontal printed, v1.1, 2022-02-16 |
| [PETG — UltiMaker](https://um-support-files.ultimaker.com/materials/2.85mm/tds/PETG/Ultimaker-PETG-TDS-v1.00.pdf) | 1939 | 46.2 | 1270 | XY flat printed, v1.00, 2022-04-29 |
| [ABS — UltiMaker](https://um-support-files.ultimaker.com/materials/2.85mm/tds/ABS/Ultimaker-ABS-TDS-v5.00.pdf) | 1962 | 38.1 | 1100 | XY flat printed, v5.00, 2022-04-20 |
| [ASA — Prusament](https://prusament.com/wp-content/uploads/2022/10/ASA_Prusament_TDS_2022_16_EN.pdf) | 1600 | 42 | 1070 | Horizontal printed, v1.1, 2022-02-16 |
| [PC Blend — Prusament](https://prusament.com/wp-content/uploads/2022/10/PCBlend_Prusament_TDS_2022_16_EN.pdf) | 1900 | 63 | 1220 | Horizontal printed, v1.1, 2022-02-16 |
| [Nylon PA6/66 — UltiMaker](https://um-support-files.ultimaker.com/materials/2.85mm/tds/NYLON/Ultimaker-Nylon-TDS-v5.00.pdf) | 2331 | 63.1 | 1140 | XY flat printed, footer v2.00, 2022-04-20 |
| [Aluminum 6061-T6 — Hydro](https://www.hydro.com/globalassets/01-products--services/extruded-profiles/americas/ena-resources/alloy-data-sheets/hydro_2019_data_sheet_6061.pdf) | 69000 | 240 | 2700 | Unwelded extruded T6/T6511, revision 2019/01 |
| [Stainless steel 304 — Outokumpu](https://www.outokumpu.com/en/products/product-ranges/-/media/files/products/core/outokumpu-core-range-datasheet.pdf?modified=20251117111909&revision=025e9931-a1d5-4c8f-8ff5-f881d38916da) | 200000 | 230 | 7900 | Core 304/4301 cold-rolled coil/sheet at 20°C, 1560EN:4, November 2022 |

Hydro E and density come from its [pipe/tube catalogue](https://www.hydro.com/globalassets/01-products--services/extruded-profiles/americas/ena-resources/sales-literature/pipe_tube_combined_july_2023_gelato.pdf),
revision August 2023, p.8: typical E = 10 million psi (rounded to 69000 MPa), specific gravity 2.70.
The 6061 datasheet supplies minimum yield 240 MPa for both listed wall-thickness ranges. Polymer
E is tensile modulus, not flexural modulus; yield is measured on printed samples, not filament.
The six polymer specimens use 100% infill. Prusa uses two perimeters, 0.20 mm layers, and rectilinear infill;
UltiMaker uses S5 Pro Bundle, AA0.4, 0.15 mm, Cura 4.9 and at least 24 hours room-temperature
conditioning. These conditions are examples, not a matching process prescription.

**Every Poisson ratio is an explicit unmeasured assumption:** 0.35 for these polymers, 0.33 for
aluminum and 0.30 for steel. Presets are starting assumptions, not universal properties or certified
design allowables. Printed XY/horizontal yield must not be applied as measured Z-layer yield.
Infill, adhesion, orientation, moisture, temperature and grade can change performance; the solver
remains isotropic. TPU/elastomers are omitted because their nonlinear behavior is outside the
linear-elastic yield-limited model. Use custom values when the example does not represent the part.

The editor selects support, loaded, and preserved faces on the model. Picked faces are colored by
role and loads display signed force arrows. Choose total force magnitude and a normal or axis
direction; no hidden load is assumed. A normal-directed selection with cancelling normals asks
for an axis or different faces. Face picking uses the captured pristine mesh, even when surface
textures change the ordinary displayed mesh. On narrow displays the task sheet collapses during
picking and returns after a face is selected. Blocked Analyze and Apply actions show persistent,
accessible reasons next to the action.

Surface regions use `{kind: "surface", triangleIndices, depthMm}` over the immutable captured source
tessellation. MCP retains strict legacy `{min,max}` axis-aligned boxes. Indices are disposable and
bound to the source hash and document revision; they are not persistent CAD face identities.
The FEM mapper resolves each baseline exterior facet against the full source mesh, checks outward
normal alignment, bounds distance by one cell diagonal, and excludes ambiguous ties across another
aligned surface. Supports fully fix selected facet nodes; each load case distributes its total
force over complete selected baseline facets. Support/load facets and preservation bands retain
their incident cells. Preservation rounds depth by half a cell diagonal and stops at another
nearest surface. Empty or undersized mappings fail explicitly. Legacy box selections keep their
original strict node/facet/cell semantics and never snap to a nearby surface.

The solver certifies cubic cells inside the source, checks connected manifold boundaries, assembles
full-solid linear isotropic Hex1 elasticity through scikit-fem, and solves with SciPy's
diagonally preconditioned conjugate-gradient method. This avoids the additional sparse-LU
factorization storage; assembly, mesh and field arrays still consume finite browser memory.
Non-convergence is a numerical failure, and the original assembled equilibrium residual must
independently satisfy its relative tolerance of `1e-8` before metrics are accepted. Each candidate
must satisfy every load case. Stress is unaveraged and evaluated at quadrature points and all eight
element corners. The final candidate receives a repeated solve and exports the exact analyzed cell
surface without smoothing. Snapshot encoding uses binary STL when coordinate rounding stays
within one millionth of the analysis cell size, volume changes by at most `1e-5` relative, and
the rounded solid passes the strict manufacturing validator. When STL cannot preserve the
analyzed detail, the same import workflow captures a 3MF with the original double coordinates
and declared millimeter units. It does not move the source or change the requested cell size.
Imported precise coordinates survive numerical recapture, previews, assembly transforms, cache
copies and 3MF export alongside the Float32 display mesh. See
[ADR-0139](../adr/0139-precise-imported-mesh-coordinates.md).

## Output and lifecycle

Optional `obstacleRegions` are positive-size axis-aligned `{min,max}` boxes in mm.
Closed voxel boxes intersecting them, including boundary contact, are excluded before baseline
analysis; conflicts with protected support, load, or preservation cells fail explicitly. Targets
refer to the remaining feasible baseline, and source-volume loss includes excluded material.
The editor exposes these controls in [Generative Design](generative-design.md), which compares
multiple material/mass-target scenarios through this same numerical and snapshot owner.

The report compares the feasible voxel baseline with the optimized solid, includes source volume,
conservative voxelization loss, cell size, per-case stress/displacement/safety/compliance, volume,
mass, iterations, termination, and assumptions. Removal percentage uses the voxel baseline;
source-to-voxel loss is reported separately. Zero iterations performs baseline-only evaluation.
An infeasible baseline publishes no result; a feasible unchanged result cannot be applied.

Preview temporarily isolates the inspected candidate in the main viewport so the original solid cannot
occlude it. Cancellation and invalidation restore the committed scene; face picking restores the pristine
source. Apply remains unavailable until the main renderer is ready. Both task panels own a bounded,
scrollable content region, including the narrow-screen sheet. Applying an improved result appends one
imported mesh Part and hides the editable CAD source in the same atomic transaction, persistence, and
Undo path. The source stays in the Parts tree and can be shown again; one Undo restores its visibility
and removes the result. A document revision, source producer, or feature-hash change invalidates the result. Closing
or canceling terminates the worker; input changes invalidate pending and completed results.
Download report preserves settings and source identity with the metrics.

The mesh is a snapshot: changing the source does not regenerate it. It supports ordinary mesh
STL/3MF export and native project backup; it has no exact B-Rep or STEP reconstruction. Preserved
regions retain analyzed voxel material, not exact original mating faces.
Select its feature in History to open the right panel, then choose **Delete feature** and confirm.
Deletion uses the ordinary dependency checks and persisted Undo/Redo path. Other Parts retain
their current visibility; show the original through its visibility control if needed.

## Runtime and limits

`@vibeshape/domain/lightweighting` owns pure settings/summary schemas.
`@vibeshape/structural-optimization` owns the browser client, independent worker, Python
solver, result validation, and mesh encoding. UI and automation are adapters over this same client.
The numerical worker does not own document authority or persistence.

Pyodide 314.0.7 (Python 3.14.2), NumPy 2.4.6, SciPy 1.18.0, scikit-fem 12.0.2, and trimesh 4.12.2
are served from the application origin. `bun run structural:prepare`, automatically used by dev
and build, verifies pinned SHA-256 inputs and retains wheel licenses, runtime licenses, and
provenance. The pinned inputs total 31,471,575 bytes; they load only when analysis runs. Model
geometry is processed in the browser and is not uploaded. Preparation requires upstream access
only when the verified local artifact cache is absent.

The desktop and standalone static hosts serve the runtime's `.mjs` modules as JavaScript and
its standard-library ZIP and Python wheels as binary ZIP archives, under the existing same-origin
and path-containment policies. Vite development success alone does not verify this delivery path.
`runtime-unavailable` diagnostics include the failed stage and a bounded original cause, such as
module loading, runtime initialization, package loading or solving. Python failures retain the final
exception without traceback frames or captured inputs. An asset-loading failure requires checking
the installed runtime files and their HTTP responses, rather than changing physical settings.

There are no fixed candidate-grid, occupied-cell, node, filter-entry, cavity-shell or region-count
ceilings. `maxIterations` is a nonnegative caller-selected search budget, without a forced upper
bound. Clients and paired MCP impose no computation deadline while the session remains live;
Cancel terminates the worker. Sparse candidate grids are streamed in batches and SIMP uses SciPy
CSR filters. Memory and computation still scale with the requested problem and browser capacity.
Poisson ratio remains limited to 0 through 0.45. Baseline feasibility, equilibrium, positive geometry,
float32 precision, protected regions and requested final physical constraints remain enforced.
`infeasible-baseline` means the unmodified analyzed body fails the supplied physical assumptions;
removing resource ceilings does not make that study feasible.

## Accuracy boundaries

This is a preliminary finite-element feasibility result under explicit assumptions. It omits
nonlinear material behavior, buckling, fatigue, contact, thermal effects, FDM anisotropy and process
defects. The small-strain model rejects strains above 5%; that threshold is a runtime bound, not
accuracy certification. Sharp corners and voxel stair steps can produce resolution-dependent
stress concentrations. Smaller cell size changes the numerical problem and increases memory and calculation time.

Conservative voxelization can lose thin features and misrepresent curved interfaces. Source meshes
must bound one connected material solid. Closed inward-oriented cavity shells are permitted;
separate outer solids, nested material islands, or inconsistent shell orientation are rejected. The source
must be a valid CAD solid, but tessellation self-intersections are not exhaustively proven. Reported
constraints concern the analyzed grid only. Physical load testing and an appropriate higher fidelity
analysis remain necessary before relying on a load-bearing part.

See [the architecture decision](../adr/0101-browser-structural-lightweighting.md),
[testing strategy](../testing-strategy.md), and [licensing](../licensing.md).

## Topology optimization and adaptive lattices

The **Optimization method** selector is shared by Lightweighting and Generative Design. Omission
of MCP `settings.algorithm` preserves feasible material removal. The two additional methods are:

- **Topology optimization (SIMP):** `{kind: "simp", volumeFraction, filterRadiusMm, penalty}`.
  Target retained volume is 10–100% of the conservative baseline. The filter radius must be at least
  one voxel; penalization is 1–5. A simultaneous maximize-stiffness objective must request the same
  retained fraction. The density iteration uses penalized elastic stiffness, filtered sensitivities,
  and bounded optimality-criteria updates. Protected cells remain full material. Binary projection
  restores material when constraints prevent the requested target. Density convergence and solid
  target achievement are reported separately; neither implies a global optimum.
- **Adaptive lattice (FEM):** `{kind: "adaptive-lattice", lattice, cellPeriodMm,
  minWallThicknessMm, maxWallThicknessMm, skinThicknessMm, field, gamma}`. Lattice types are
  `gyroid`, `schwarz-p`, and `schwarz-d`. The baseline maximum across load cases supplies
  `strain-energy` or `von-mises`; exponent `gamma` is 0.1–8. Local field magnitude maps to the
  requested wall range. A period needs at least eight voxels; the minimum wall needs at least two,
  and maximum wall must be between minimum wall and half the period. Skin is zero for open
  geometry or at least one voxel. Protected interfaces remain solid independently of skin.

These are bounded voxel constructions, without smooth-wall accuracy or exact source-face preservation.
Adaptive minimum features use complete occupied-cube coverage, including captured float32 coordinates;
requested widths are not measurements of the smooth TPMS surface. Underresolved or incompatible
settings fail explicitly. Increasing the implicit threshold can restore material to obtain a feasible
candidate, including an unchanged baseline when no lighter valid solid is found.

Every candidate must satisfy all supplied stress, safety, displacement, keep-out, connectivity, and
optional FDM constraints. Repeated final FEM uses the full-solid exported cells, never relaxed SIMP
stiffness or baseline-field estimates. Results and downloaded reports include algorithm settings and
evidence; settings/source changes invalidate the result. Algorithm iteration counters must equal the
summary iteration count and remain within the request budget in both browser and MCP validation.
Projection evaluations must fit the algorithm budget and account for the reported total FEM solves,
including baseline, density iterations where applicable, and final validation. Zero search budget
permits no projections. Apply uses the existing inspected mesh
snapshot, atomic transaction, and Undo workflow. Results remain mesh Parts, without CAD reconstruction
or STEP export. The small-strain model remains unchanged.

Local and paired remote `analyze_lightweighting` and `request_lightweighting` accept both methods.
The result's `algorithm.settings` must match the request. In Generative Design, each SIMP scenario
uses its scenario retained fraction as `volumeFraction`; the standalone target is not silently reused.
See [ADR-0122](../adr/0122-density-topology-and-adaptive-lattices.md).

## Quick lightweighting

**Quick lightweighting** is a separate registered toolbar and palette command. It assumes a filled
exact source solid and previews a periodic lattice without requesting structural supports or loads.
A switch selects **Keep exterior** or **Open organic**. Choose **Gyroid**, **Schwarz P**, or
**Schwarz D** cells, using trigonometric nodal sheet approximations of TPMS geometry. Sliders and direct numeric inputs control requested removal, physical cell size, sampling detail, and
(when retaining the exterior) skin thickness. Generation waits until a slider pointer or keyboard
gesture ends, then debounces the final settings for 650 ms. Pauses during a held gesture do not
start a worker. Starting another adjustment cancels obsolete work and disables Apply immediately.
Pointer cancellation, capture loss, and blur release the gesture. Generation is cancelable; source
changes and input changes invalidate obsolete results. Apply adds a separate mesh Part with one
Undo entry through the ordinary validated import transaction.

Keep exterior preserves the captured outer triangles and creates inward-oriented, enclosed cavity
shells behind a continuous skin. Open organic generates an isosurface inside the source envelope.
The default cell period is six sampling cells for Gyroid and Schwarz P, or twelve for Schwarz D
to resolve its finer nodal pattern. The selector starts Schwarz D at this safer size. Explicit coarse
Schwarz D settings can fail connected-material validation. An explicit period must contain at least six sampling cells; there is no upper sampling bound.
The physical period is retained when detail increases and enlarged only when needed to preserve
that minimum resolution. Numeric input can exceed the convenience slider ranges. Requested
removal is strictly between 0 and 100 percent; measured positive removal has no minimum percentage.
A preserved skin requires at least two sampling cells,
plus conservative geometric margins. These margins and connected-material validation can limit
actual removal. The envelope reserves one sampling-cell diagonal in addition to the preserved
skin. Preparation first checks the source bounds for a proven upper limit on interior clearance;
an insufficient bound fails before allocating or sampling the grid. An inconclusive bound continues
normally. A `no-removable-material` preparation error reports either that bound or the maximum
sampled interior clearance, skin and sampling margin. Finer detail can open internal space while keeping the same physical
skin and lattice period; it does not guarantee the requested removal percentage.
Sampling uses the existing `three-mesh-bvh` nearest-surface and ray queries in normalized float64
coordinates. Ambiguous ray hits fall back to the pinned Trimesh calculation in adaptive scratch
batches. The worker releases its sampling index after preparation; final containment, skin,
connectivity and serialization validation remain independent of the accelerated sampling path.
Dense envelope and lattice fields cross the Python/JavaScript boundary as owned float64 buffers;
only grid metadata uses JSON. This avoids the JavaScript single-string ceiling without reducing
sampling detail or precision. Buffer views and proxies are released after copying and validating
finite samples and grid dimensions. Invalid JSON diagnostics identify the response kind and its
UTF-16 length without including captured geometry.
Quick validates cavity or organic-surface containment and retained skin against the rounded captured
exterior using the actual float32 coordinates written to binary STL. It checks serialized shell
winding, positive material volume and removal, collapsed triangles, nonmanifold edges and invalid
vertex fans. Ordinary coordinate rounding is not rejected merely
because it exceeds a fixed fraction of the sampling detail. Geometry that cannot survive the
round trip still fails validation.
The shared 3MF mesh validator also checks logical and serialized shell intersections and nesting
before Quick analysis returns a result; STL encoding repeats that validation at its boundary.
Results report source/result volume, requested/achieved removal, cell period, and
warnings. They do not report stress, displacement, or a maximum-stiffness score. Use the structural
workflow for explicit isotropic numerical load assumptions. Neither workflow certifies printability
or physical strength.

Paired local and remote MCP expose `analyze_quick_lightweighting` (compute only) and
`request_quick_lightweighting` (reviewed ordinary mesh snapshot). They reuse source identity,
actor ownership, revision checks, cancellation, private staged import, Apply and Undo. Mesh data
stays browser-private; MCP receives bounded geometric summaries and snapshot identifiers.
See the [quick operator reference](../../.agents/skills/vibeshape-modeling/references/quick-lightweighting.md)
and [interaction research](lightweighting-ux-research.md).


### Optimization objectives

The structural workflow supports **Minimize mass** (the default) and **Maximize stiffness at target
mass**. The latter uses a retained fraction of the analyzed baseline mass, rounded upward to a whole
voxel count. Low-energy feasible removal stops at that count; it never silently removes below the
mass target. Results distinguish a reached target from a target prevented by constraints, protected
regions, topology, or the iteration budget. Both objectives use a greedy heuristic and do not claim
a global minimum mass or maximum stiffness. This is not a full generative-design search over
manufacturing methods or multiple alternative designs.

Optional `settings.fdm` extends the shared structural analysis with conservative minimum-feature
and support-policy checks. The editor exposes these controls in Generative Design; paired MCP
can supply them for an individual analysis. See the canonical
[FDM contract](generative-design.md#fdm-constraints) for direction, angle conventions, baseline
failure, comparison evidence, and the distinction from slicer simulation.

### Quick runtime and exchange bounds

Quick computation has no fixed source/result vertex/triangle count, sampling-resolution or
total sample-count cutoff. Marching-cubes buffers are sized from the actual Float32 field
triangle count at each threshold, without truncating output or allocating worst-case geometry. At most three connectivity candidates reuse the same
source distance grid. Generation runs in a dedicated Web Worker through the local Pyodide
WebAssembly runtime, without a fixed elapsed-time or cumulative proximity-query cutoff.
Local STL/3MF geometry, source storage and native backup do not reject a candidate for fixed
mesh-count or geometry-byte budgets. Explicit caller-supplied import limits still apply. Ordinary
finite/index/manifold checks, archive path/entity/reference safety, digest validation and atomic
source-bound publication remain required. Generated MCP candidates enter the existing reviewed
prepared-import path directly; public upload/chunk limits are transport admission policies and
are not applied to an internal loopback upload. See
[ADR-0134](../adr/0134-local-geometry-resource-policy.md).
Distance and containment work uses adaptive batches of at most 128 points, targeting 262,144
worst-case triangle/ray pairs per batch. Batches retain at least one query point, so very dense
sources exceed that target and intermediate memory still scales with source density.
Invalid Quick inputs include the validation cause in MCP errors and the editor task panel.
Sampling and validation show current-pass progress; validation can restart for another
pass or connectivity candidate. **Cancel generation**, closing the panel, or changing inputs
terminates the worker. Local and remote MCP impose no lightweighting operation deadline; cancellation,
revocation, source identity and pairing lifetime still apply. The five-minute manual review lease
starts after both native inspections finish.
Geometry and payload capacity failures remain explicit; changing detail or cell size does not
guarantee a feasible result.

Preserved exterior results may contain inward cavity shells. 3MF export uses actual shell
containment, intersection checks, alternating orientation, and positive total material volume.
Public 3MF import accounts canonical geometry leaves against its existing aggregate vertex and
triangle budgets, separately from the 100,000 generic XML-node budget. Namespace, depth, bytes,
archive expansion, and metadata limits remain enforced. Internal round trips establish format
behavior; they do not establish slicer compatibility or physical printability.
