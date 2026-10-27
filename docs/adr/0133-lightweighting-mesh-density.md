# ADR-0133: Tessellation-independent Lightweighting Inputs

- Status: Accepted
- Date: 2026-10-27
- Partially supersedes the mesh-count resource policy of [ADR-0101](0101-browser-structural-lightweighting.md) and [ADR-0102](0102-lightweighting-task-workflows.md)

## Decision

Remove fixed source and result vertex/triangle count cutoffs from structural and Quick
lightweighting schemas, Python input/output validation, surface selection and isosurface extraction.
Display tessellation density does not determine FEM problem size. A valid dense source must not
fail before analysis merely because it crosses the prototype's 10,000-vertex or 20,000-triangle threshold.

Keep finite-coordinate, complete-triangle and actual index-range validation. Selected surface
triangle indices are bounded by the captured source, retaining triangle order and source identity.
Exact-coordinate compaction remains an optimization for structural capture. Quick preserved-exterior
results retain the original captured source prefix without decimation or compaction.

Allocate marching-cubes geometry buffers from the grid's worst-case triangle count rather than a
fixed output budget. Preserve independent FEM grid/cell/node, Quick sampling-resolution, adaptive
proximity-batch and cancellation policies. Invalid inputs report bounded validation paths and causes.

## Consequences

Dense source meshes consume more memory and sampling work; this decision does not promise
unlimited runtime capacity or numerical accuracy. Existing physical and numerical feasibility
checks remain authoritative. No native service, dependency, file format or publication authority changes.
Shared exchange writers and untrusted file-import budgets remain governed by their existing
format contracts, including [ADR-0065](0065-bounded-exchange-geometry-import.md); this decision
removes the computation-specific mesh cutoffs rather than widening every import/export boundary.

Regression coverage must cross the former source and result thresholds, exercise real pinned
WASM solvers at fixed numerical resolution, retain exterior identity and reject malformed indices.
See [the product contract](../product/lightweighting.md) for current numerical limits.
