# Generative Design

The registered **Generative Design** toolbar and command-palette action explores a bounded set of
structural alternatives inside one exact single-solid Part. It reuses the graphical support, load,
preservation, material, resolution, preview, and Apply workflow described in
[Structural lightweighting](lightweighting.md).

## Search and comparison

Enter one to three distinct retained-mass percentages from 10 to 100. The editable current material
is always included; optionally select up to two additional material examples from the shared
catalog. Each material/target pair runs an independent stiffness-guided feasible-removal search,
giving at most nine alternatives. Results are generated sequentially in disposable local workers;
model geometry stays in the browser. Each alternative retains the structural workflow's resource
limits and three-minute compute deadline. The complete study can therefore take longer than one
structural analysis. Cancel or changing settings stops the current worker and prevents subsequent
alternatives from starting.

All scenarios share source geometry, loads, supports, preserved regions, resolution, and limits.
They override material and retained-mass objective only. Compare actual mass and the maximum
compliance across load cases. Compliance is force-displacement work in N·mm under the specified
loads; it is not a universal stiffness score. A Pareto candidate has no other feasible candidate
with equal-or-lower mass and compliance and a strict improvement in at least one of them.
Equal metrics do not dominate one another. Identical geometry for the same study material is
marked explicitly rather than presented as another discovered shape.

Typed numerical failures are listed per scenario and do not discard successful candidates.
Cancellation, invalid study inputs, and unexpected runtime failures stop the study. An unmet mass
target remains explicit: a feasible candidate can be heavier than requested because physical
constraints, protected cells, topology, or the iteration limit prevented further removal.

## Keep-out regions

Optional positive-size axis-aligned boxes use model coordinates in millimeters. Any closed voxel
box intersecting a keep-out box is removed conservatively before baseline analysis. Touching box
boundaries also excludes the voxel. Exclusion includes the permitted float32 STL displacement
(one millionth of cell size), plus a grid-arithmetic margin, so the captured mesh also stays outside
the original boxes. Intersection with protected support, load, or preservation
cells fails explicitly; geometry is never silently moved or a constraint weakened.

The retained-mass target is relative to the feasible voxel baseline **after** keep-out removal.
The source-volume loss includes both conservative voxelization and excluded cells. Keep-out
regions can disconnect a source or make it infeasible, in which case no accepted candidate is
returned for that scenario. Fully enclosed cavities remain unsupported by the structural solver's
single connected surface contract; they fail with `disconnected-mesh` rather than being repaired.
Ordinary single-analysis MCP settings also accept these boxes through
optional `obstacleRegions`; the editor currently exposes their controls in Generative Design.

## Preview, Apply, and limitations

The first improved Pareto candidate is previewed automatically when available. Selecting another
candidate validates and prepares its existing mesh through the ordinary import path without
rerunning FEM. Apply is unavailable during computation or inspection, before renderer readiness,
for unchanged candidates, or after source/settings invalidation. It imports the selected mesh as
one separate Part, hides the editable source, and creates one atomic Undo entry. Download analysis
report exports the selected candidate's actual input material, objective, regions, numerical
metrics, and source identity. Changing the source does not regenerate applied results.

This is a bounded multi-scenario search using a greedy voxel-removal heuristic. It does not explore
manufacturing methods, optimize over arbitrary starting topologies, prove a global optimum, or
certify structural strength or printability. The isotropic linear FEM limitations in the structural
contract apply to every candidate. There is no smoothing, CAD/B-Rep reconstruction, or STEP output;
results support ordinary mesh STL/3MF export and native project backup.

The multi-candidate study is currently an editor workflow, not a new MCP tool. Existing paired
`analyze_lightweighting` and `request_lightweighting` operate on one scenario at a time; do not
advertise automatic multi-candidate study or selection support through MCP.

See [ADR-0107](../adr/0107-bounded-generative-design-studies.md) for ownership and alternatives.
