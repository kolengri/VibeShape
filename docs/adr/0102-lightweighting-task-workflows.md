# ADR-0102: Graphical Structural and Quick Lightweighting Workflows

- Status: Accepted
- Date: 2026-10-07
- Local geometry/resource admission policy partially superseded by [ADR-0134](0134-local-geometry-resource-policy.md)
- Mesh-count resource policy superseded by [ADR-0133](0133-lightweighting-mesh-density.md)
- Supersedes interaction and preserved-surface scope in [ADR-0101](0101-browser-structural-lightweighting.md)
- Related: [ADR-0013](0013-microkernel-modules-and-mcp-automation.md), [ADR-0006](0006-3mf-primary-print-export.md)

## Decision

Retain the existing structural computation owner, source-bound automation lifecycle, and ordinary
mesh import authority. Structural parameters use the responsive task panel with graphical face
selection and signed force arrows. Surface inputs reference triangle indices in a captured pristine
mesh and are invalidated when its revision or hash changes. They remain disposable analysis inputs,
not durable topology references. Strict legacy box inputs remain available through MCP.

Add a separate load-free quick workflow to the same computation package. It uses the pinned local
NumPy/SciPy/Trimesh runtime and Three.js marching cubes in a disposable worker. A selectable Gyroid, Schwarz P, or Schwarz D field is
clipped to the source solid. The preserved-exterior variant retains source triangles and appends
inward cavity shells behind a conservative skin; the open variant may change the exterior. Report
measured volumes and achieved removal, without claiming optimal stiffness under unknown loads.
Both transport surfaces use the same client and source-bound reviewed snapshot path.
Physical lattice cell size is separate from sampling detail within the 6–12 samples-per-period bound.
The existing structural heuristic gains a baseline retained-mass stopping target for stiffness-oriented
removal; it remains a single bounded, load-dependent optimization rather than full generative design.

Use a host-owned controlled workspace task context to coordinate the task panel, pristine picking
source, and non-pickable viewer overlays. Required action reasons are persistent in task forms;
compact toolbar actions provide focus, hover, and touch disclosure with an explicit activation guard.

## Consequences

Graphical surface/FEM mapping and quick geometry remain resolution-dependent. Original exact CAD
stays editable, but applied results are mesh snapshots rather than regenerated parametric B-Reps.
Preserved exterior means the captured outer tessellation is retained, within serialization precision.
Enclosed cavities require cavity-aware closed-mesh export validation rather than demanding positive
volume for every disconnected surface shell. Formats retain their own validation and serialization
authority. See [the canonical product contract](../product/lightweighting.md).
