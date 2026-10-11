# ADR-0107: Bounded Generative Design Studies

- Status: Accepted with reduced scope
- Date: 2026-10-11
- Related: [ADR-0101](0101-browser-structural-lightweighting.md), [ADR-0102](0102-lightweighting-task-workflows.md)
- Extended by: [ADR-0108](0108-generative-design-fdm-constraints.md) for conservative FDM constraints

## Decision

Extend the existing structural-optimization owner with sequential multi-material/multi-target
studies, conservative keep-out boxes, measured Pareto comparison, and explicit duplicate/failure
reporting. Pure bounded study settings belong to domain; numerical orchestration belongs to
structural-optimization; the editor owns disposable study selection. Reuse the existing validated
worker, source-revision checks, graphical boundary conditions, snapshot inspection, preview,
atomic Apply, persistence, and Undo paths. No new workspace, numerical dependency, document
feature schema, or privileged mutation API is introduced.

The first scope compares up to three materials and three retained-mass targets. Each scenario
uses the existing stiffness-guided feasible voxel-removal heuristic. Optional keep-out boxes are
shared structural settings, including existing paired MCP single-scenario tools. The study itself
is editor-only until an explicit source-bound multi-candidate MCP contract is implemented.

## Alternatives and consequences

A separate native solver service could support larger searches but adds installation, process,
and authority boundaries. A new density-based topology optimizer could explore different shape
families, but requires independent numerical validation and robust solid reconstruction. Reusing
the existing solver delivers load-checked comparison within the current local-first architecture,
while retaining its resolution, resource, and heuristic limitations.

Keep-out exclusion precedes baseline feasibility; targets refer to that baseline. Protected-cell
conflicts and disconnected/infeasible candidates fail explicitly. Every successful candidate keeps
its exact analyzed mesh and settings. Comparing mass and worst-case compliance does not establish
a global optimum, manufacturing suitability, or physical strength. The delivered snapshots remain
mesh rather than editable CAD. Full behavior is canonical in
[Generative Design](../product/generative-design.md).
