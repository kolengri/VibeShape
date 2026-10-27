# ADR-0101: Browser Structural Lightweighting Snapshots

- Status: Accepted with reduced scope
- Date: 2026-10-07
- Local geometry/resource admission policy partially superseded by [ADR-0134](0134-local-geometry-resource-policy.md)
- Mesh-count resource policy superseded by [ADR-0133](0133-lightweighting-mesh-density.md)
- Related: [ADR-0013](0013-microkernel-modules-and-mcp-automation.md), [ADR-0020](0020-local-slicer-handoff-bridge.md)

## Decision

Structural lightweighting runs in a disposable browser Web Worker through pinned same-origin
Pyodide, scikit-fem, SciPy, NumPy, and trimesh assets. Reuse their FEM assembly and numerical
linear algebra rather than implementing a parallel TypeScript solver. Pure settings and result
summaries belong to the domain; the structural-optimization package owns computation and its
bounded protocol. The document worker, geometry kernel, and slicer bridge retain their owners.

The first delivery removes feasible full-solid voxel cells and exports their exact analyzed
surface as a separate mesh snapshot. UI and paired local/remote MCP use one numerical client.
Ordinary mesh import owns preview, atomic commit, Undo, persistence, and export. Source identities
and revisions gate publication and Apply; computation never mutates the source.

## Alternatives and consequences

A native local numerical service supports larger problems with lower interpreter overhead, but
requires installation and a new authority/process boundary. A custom TypeScript/WASM FEM solver
reduces Python packaging but creates a large numerical maintenance and validation burden. The
browser runtime preserves static local-first delivery and established computational libraries,
at the cost of approximately 31.5 MB of lazily loaded pinned inputs and bounded model sizes.

Analysis is linear, isotropic, and resolution-dependent. No smoothing, exact CAD reconstruction,
live parametric regeneration, global optimality, physical strength certification, or exact mating
surface preservation is included. Those require separate geometry, accuracy, and lifecycle gates.
Full behavior, resource bounds, and limitations are canonical in
[Structural lightweighting](../product/lightweighting.md).
