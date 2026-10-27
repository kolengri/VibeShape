# Structural lightweighting

The **Lightweighting** button in the main modeling toolbar reduces occupied material while satisfying supplied
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
exactly equal XYZ coordinates within a bounded raw source mesh. This preserves every triangle's
coordinates, order and winding, including selected surface regions; it does not simplify geometry
or raise the 10,000-vertex analysis budget. Raw capture is bounded to 20,000 vertices and 20,000
triangles. Invalid or genuinely oversized inputs retain explicit validation diagnostics.
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
full-solid linear isotropic Hex1 elasticity through scikit-fem, and solves with SciPy. Each candidate
must satisfy every load case. Stress is unaveraged and evaluated at quadrature points and all eight
element corners. The final candidate receives a repeated solve and exports the exact analyzed cell
surface without smoothing. The schema and strict 3MF manufacturing validator independently gate
the captured STL import. Before any result publication or capture, float32 STL coordinates must
round by no more than one millionth of the analysis cell size, and the rounded solid passes the
strict manufacturing validator. Excessive rounding fails with `serialization-precision`; move
the source closer to the origin or choose coarser cells instead of importing a distorted solid.

## Output and lifecycle

Optional `obstacleRegions` are up to sixteen positive-size axis-aligned `{min,max}` boxes in mm.
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
`@vibeshape/structural-optimization` owns the browser client, independent worker, bounded Python
solver, result validation, and mesh encoding. UI and automation are adapters over this same client.
The numerical worker does not own document authority or persistence.

Pyodide 314.0.7 (Python 3.14.2), NumPy 2.4.6, SciPy 1.18.0, scikit-fem 12.0.2, and trimesh 4.12.2
are served from the application origin. `bun run structural:prepare`, automatically used by dev
and build, verifies pinned SHA-256 inputs and retains wheel licenses, runtime licenses, and
provenance. The pinned inputs total 31,471,575 bytes; they load only when analysis runs. Model
geometry is processed in the browser and is not uploaded. Preparation requires upstream access
only when the verified local artifact cache is absent.

Bounds are 10,000 source vertices, 20,000 source triangles, 12,000 grid cells, 3,000 occupied cells,
5,000 nodes, eight supports, eight cases, sixteen preservation regions, forty removal iterations,
and a 180-second client computation deadline. Cancel terminates the worker. Poisson ratio is
limited to 0 through 0.45. Resource-limit failures require a coarser grid or smaller analysis domain.

## Accuracy boundaries

This is a preliminary finite-element feasibility result under explicit assumptions. It omits
nonlinear material behavior, buckling, fatigue, contact, thermal effects, FDM anisotropy and process
defects. The small-strain model rejects strains above 5%; that threshold is a runtime bound, not
accuracy certification. Sharp corners and voxel stair steps can produce resolution-dependent
stress concentrations. Smaller cell size changes the numerical problem and can exceed limits.

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
or STEP export. Computational and small-strain limits remain unchanged.

Local and paired remote `analyze_lightweighting` and `request_lightweighting` accept both methods.
The result's `algorithm.settings` must match the request. In Generative Design, each SIMP scenario
uses its scenario retained fraction as `volumeFraction`; the standalone target is not silently reused.
See [ADR-0122](../adr/0122-density-topology-and-adaptive-lattices.md).

## Quick lightweighting

**Quick lightweighting** is a separate registered toolbar and palette command. It assumes a filled
exact source solid and previews a periodic lattice without requesting structural supports or loads.
A switch selects **Keep exterior** or **Open organic**. Choose **Gyroid**, **Schwarz P**, or
**Schwarz D** cells, using trigonometric nodal sheet approximations of TPMS geometry. Sliders control requested removal, physical cell size, sampling detail, and
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
Schwarz D settings can fail connected-material validation. An explicit period must be 6–12 sampling cells;
the physical period is preserved when detail changes within this range and clamped otherwise.
A preserved skin requires at least two sampling cells,
plus conservative geometric margins. These margins and connected-material validation can limit
actual removal. Results report source/result volume, requested/achieved removal, cell period, and
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

Quick generation accepts 10,000 source vertices and 20,000 source triangles, at most 56³ samples,
and 120,000 generated triangles. The complete result is bounded
by 80,000 vertices and 140,000 triangles. At most three connectivity candidates reuse the same
source distance grid. Generation runs in a dedicated Web Worker through the local Pyodide
WebAssembly runtime, without a fixed elapsed-time or cumulative proximity-query cutoff.
Distance and containment work uses adaptive batches of at most 128 points, with at most 262,144
worst-case triangle/ray pairs per batch. Larger surfaces use smaller batches to bound intermediate
memory. Sampling and validation show current-pass progress; validation can restart for another
pass or connectivity candidate. **Cancel generation**, closing the panel, or changing inputs
terminates the worker. Local and remote MCP impose no Quick operation deadline; cancellation,
revocation, source identity, pairing lifetime and the five-minute import/review lease still apply.
Geometry and payload capacity failures remain explicit; changing detail or cell size does not
guarantee a feasible result.

Preserved exterior results may contain inward cavity shells. 3MF export uses actual shell
containment, intersection checks, alternating orientation, and positive total material volume.
Public 3MF import accounts canonical geometry leaves against its existing aggregate vertex and
triangle budgets, separately from the 100,000 generic XML-node budget. Namespace, depth, bytes,
archive expansion, and metadata limits remain enforced. Internal round trips establish format
behavior; they do not establish slicer compatibility or physical printability.
