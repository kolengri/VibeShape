# Structural lightweighting

The **Lightweighting** application-menu workflow reduces occupied material while satisfying supplied
von Mises stress, safety-factor, and displacement limits in every load case. It uses energy-guided
cell removal with feasibility backtracking, not a global optimum or physical strength certification.
`analyze_lightweighting` and `request_lightweighting` expose the same browser calculation through
paired local and remote MCP. See the [operator reference](../../.agents/skills/vibeshape-modeling/references/lightweighting.md).

## Inputs and numerical model

Choose one available, valid exact single-solid Part explicitly. Analysis uses its pristine display
tessellation, excluding surface textures. Enter Young's modulus and yield strength in MPa, density
in kg/m3, Poisson ratio, required safety factor, maximum displacement in mm, cell size in mm, and
total forces in N. There are no inferred material grades or print-process presets.

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

See [the architecture decision](../adr/0100-browser-structural-lightweighting.md),
[testing strategy](../testing-strategy.md), and [licensing](../licensing.md).
