# ADR-0122: Density Topology Optimization and FEM-Graded Lattices

- Status: Accepted with reduced scope
- Date: 2026-10-21
- Extends: [ADR-0101](0101-browser-structural-lightweighting.md), [ADR-0107](0107-bounded-generative-design-studies.md)

## Decision

Extend the existing structural-optimization worker with optional filtered SIMP and FEM-graded TPMS
algorithms. Domain owns strict settings and evidence schemas; structural-optimization owns numerical
assembly, iteration, reconstruction, and repeated full-solid verification. The editor and paired
local/remote MCP use the same client. No new package, numerical dependency, geometry kernel,
document schema, or privileged commit path is introduced. Omitted algorithm settings preserve
the existing feasible-removal workflow.

SIMP optimizes penalized elastic densities with filtering and a bounded update. Density convergence
and reconstructed target achievement are separate evidence. Adaptive lattices map the baseline
multi-case FEM field to requested wall thickness, with optional exterior skin. Protected interfaces
and keep-outs retain their existing authority. Underresolved parameters fail explicitly.

Every accepted result is an unsmoothed occupied-cell surface analyzed again as full material for
all supplied cases. Relaxed density metrics and the source field cannot establish the feasibility
of that reconstructed solid. Final mesh serialization, material connectivity, stress, displacement,
and requested FDM constraints remain acceptance gates. Preview is disposable; Apply uses ordinary
source-revision-checked atomic mesh import and one Undo entry. Source CAD remains editable.

## Alternatives and consequences

A standalone native optimizer would permit larger meshes but require installation and a separate
process boundary. A smooth implicit renderer would improve presentation but require a distinct
surface-to-analysis accuracy contract. Reusing the existing browser libraries preserves local-first
deployment and established cancellation, ownership, and result validation, at the cost of coarse
voxel geometry and bounded problem sizes.

Neither method establishes a global optimum, calibrated print strength, or smooth minimum-wall
accuracy. Exact CAD reconstruction and STEP output remain separate work. Canonical settings,
limits, and operator behavior are documented in [Structural lightweighting](../product/lightweighting.md).
