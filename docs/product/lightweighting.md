# Structural lightweighting

The **Lightweighting** button in the main modeling toolbar reduces occupied material while satisfying supplied
von Mises stress, safety-factor, and displacement limits in every load case. It uses energy-guided
cell removal with feasibility backtracking, not a global optimum or physical strength certification.
`analyze_lightweighting` and `request_lightweighting` expose the same browser calculation through
paired local and remote MCP. See the [operator reference](../../.agents/skills/vibeshape-modeling/references/lightweighting.md).

The toolbar button uses the same registered command as the command palette and a native SVG icon.
Opening the dialog captures one unambiguous selected exact Part (from the tree or a viewport body/face)
and fills its source and initial region bounds. Missing, unavailable, hidden, mesh, or ambiguous targets
remain unselected. A later viewport selection does not replace the source being edited in the dialog.

## Inputs and numerical model

Choose one available, valid exact single-solid Part, or keep the valid selected Part prefilled on opening. Analysis uses its pristine display
tessellation, excluding surface textures. Enter Young's modulus and yield strength in MPa, density
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

Axis-aligned boxes in model coordinates select fully fixed support nodes, loaded exterior facets,
and preserved cells. Each load case distributes its total force uniformly over baseline exterior
quad facets wholly inside its box. Support nodes must lie inside their authored boxes. Selection
never snaps or moves to a nearby surface; empty selection, overlapping fixed/load nodes, and
unrestrained modes fail. Load facet and support coordinate identities remain frozen through
optimization; all incident cells and cells intersecting preservation boxes are retained.

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

The report compares the feasible voxel baseline with the optimized solid, includes source volume,
conservative voxelization loss, cell size, per-case stress/displacement/safety/compliance, volume,
mass, iterations, termination, and assumptions. Removal percentage uses the voxel baseline;
source-to-voxel loss is reported separately. Zero iterations performs baseline-only evaluation.
An infeasible baseline publishes no result; a feasible unchanged result cannot be applied.

Preview is independent and disposable. Applying an improved result appends one imported mesh Part
through the normal atomic transaction, persistence, and Undo path while retaining the editable CAD
source. A document revision, source producer, or feature-hash change invalidates the result. Closing
or canceling terminates the worker; input changes invalidate pending and completed results.
Download report preserves settings and source identity with the metrics.

The mesh is a snapshot: changing the source does not regenerate it. It supports ordinary mesh
STL/3MF export and native project backup; it has no exact B-Rep or STEP reconstruction. Preserved
regions retain analyzed voxel material, not exact original mating faces.

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
must have one closed connected surface; separate internal cavity shells are unsupported. The source
must be a valid CAD solid, but tessellation self-intersections are not exhaustively proven. Reported
constraints concern the analyzed grid only. Physical load testing and an appropriate higher fidelity
analysis remain necessary before relying on a load-bearing part.

See [the architecture decision](../adr/0101-browser-structural-lightweighting.md),
[testing strategy](../testing-strategy.md), and [licensing](../licensing.md).
