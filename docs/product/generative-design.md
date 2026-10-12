# Generative Design

The registered **Generative Design** toolbar and command-palette action explores a bounded set of
structural alternatives inside one exact single-solid Part. It reuses the graphical support, load,
preservation, material, resolution, preview, and Apply workflow described in
[Structural lightweighting](lightweighting.md).

## First run

The main form asks for the source Part, material preset, fixed faces, loaded faces, and total force.
Choose actual boundary conditions in the viewport; the editor never guesses them or assigns a
material. A preset fills the material properties. Custom properties and their reference sources
remain available under **Material properties and references**.

**Generate alternatives** remains visible in the task footer while the form scrolls. If it is
unavailable, its explanation and next-step button direct the user to the source/material control,
start face picking, or focus the missing force. **Review the settings** opens the advanced sections
when the primary inputs are complete but validation still fails, bringing the first invalid native
field or the first disclosure into the form viewport without scrolling workspace ancestors. Apply
appears in the shared command header only after a candidate is ready; its readiness explanation
remains visible while disabled. Close stays in that header; Generate and its setup guide stay in
the fixed footer.
Collapsing a section preserves
its values and validation; it never removes an active constraint.

The initial study analyzes one target: retain 70% of the feasible starting weight. Quick choices
request 15%, 30%, or 50% weight reduction; these are targets, not promised reductions. Up to three
custom retained-mass targets, additional materials, and keep-out regions remain under
**Compare more alternatives and keep-out regions**. Preserved faces, region depth, safety limits,
and solver resolution remain under **Preserved faces and analysis settings**. FDM support policy
and build direction stay visible; **Printer settings** holds the numerical FDM limits, with their
current values summarized in the main form. Opening a section does not invalidate results;
changing a parameter does.

## Search and comparison

Enter one to three distinct retained-mass percentages from 10 to 100. The editable current material
is always included; optionally select up to two additional material examples from the shared
catalog. Each material/target pair runs an independent stiffness-guided feasible-removal search,
giving at most nine alternatives. Results are generated sequentially in disposable local workers;
model geometry stays in the browser. Each alternative retains the structural workflow's resource
limits and three-minute compute deadline. The complete study can therefore take longer than one
structural analysis. Cancel or changing settings stops the current worker and prevents subsequent
alternatives from starting.

All scenarios share source geometry, loads, supports, preserved regions, resolution, FDM settings, and limits.
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

## FDM constraints

The editor study defaults to **Supports allowed**, build direction `+z`, minimum feature size
1.2 mm, layer height 0.2 mm, and maximum overhang 45 degrees **from vertical**. These are editable
starting values, not printer calibration or universal manufacturing limits. Choose either policy:

- **Without supports:** every accepted geometry must satisfy the conservative support check.
- **Supports allowed:** unsupported geometry is permitted and its area requiring support is shown
  for comparison. This does not generate supports or estimate their volume, cost, or removability.

Both policies enforce minimum feature size before baseline acceptance, during removal, and during
repeated final verification. Minimum feature size uses a conservative filled-voxel-cube bound:
each retained cell must belong to an entirely filled axis-aligned cube of sufficient size. It is
not a thin-wall measurement or extrusion-width/perimeter simulation. A finer FEM grid can make
the same requested feature size require several cells and constrain removal more strongly.
Coverage must satisfy the requested size in both solver coordinates and captured float32 STL
coordinates. An exact cell-size minimum can fail when serialization shrinks a cube; rounding
never weakens the requested minimum. Cube counts exceeding the bounded cell budget fail before
size-dependent allocation.
An incompatible baseline fails explicitly rather than returning a manufacturing-infeasible result.

Build directions are `+x`, `-x`, `+y`, `-y`, `+z`, and `-z` in captured model coordinates. Layer
height and the angle from vertical define a one-layer horizontal reach for conservative support
checks. Layer height must not exceed voxel cell size; the one-slice approximation cannot represent a
previous print layer spanning several voxel slices. The worker also checks the smallest actual
build-axis slice in solver and captured float32 coordinates. A layer height exactly equal to cell
size can fail after rounding; decrease layer height rather than relaxing the geometry check.
Bed contact is exempt from support demand.
The voxel surface can reject stepped geometry that a calibrated printer could bridge; bridging is
not inferred from a small unsupported area.
Results echo the settings, baseline and optimized unsupported area, whether support is required,
the conservative minimum-feature bound, and build height. Mass/compliance Pareto labels keep
their existing two-metric meaning; inspect support demand separately.

The selected direction affects analysis only. Preview, Apply, and ordinary STL/3MF export retain
model coordinates. Reproduce that direction in print preparation or your slicer; the file contains
no printer profile, support toolpath, or layer settings. Printed material behavior remains isotropic
in FEM. Adhesion, extrusion paths, infill, layer-direction strength, and actual print success are
outside this approximation.

Existing paired single-analysis MCP tools accept the same optional `settings.fdm`; omission keeps
the previous structural workflow. Successful requested FDM evidence must match its settings, and
manual review displays the policy and parameters before Apply. Multi-candidate studies remain
editor-only. See [ADR-0108](../adr/0108-generative-design-fdm-constraints.md).

Angle conventions differ between tools: [PrusaSlicer documents its overhang threshold from the
horizontal plane](https://help.prusa3d.com/article/support-material_1698). VibeShape labels its
angle from vertical explicitly; do not copy the same numeric value without converting conventions.

## Preview, Apply, and limitations

The first improved Pareto candidate is previewed automatically when available. Selecting another
candidate validates and prepares its existing mesh through the ordinary import path without
rerunning FEM. Apply is unavailable during computation or inspection, before renderer readiness,
for unchanged candidates, or after source/settings invalidation. It imports the selected mesh as
one separate Part, hides the editable source, and creates one atomic Undo entry. Download analysis
report exports the selected candidate's actual input material, objective, regions, FDM settings, numerical
metrics, and source identity. Changing the source does not regenerate applied results.

This is a bounded multi-scenario search using a greedy voxel-removal heuristic. It does not explore
alternative manufacturing methods, optimize over arbitrary starting topologies, prove a global optimum, or
certify structural strength or printability. The isotropic linear FEM limitations in the structural
contract apply to every candidate. There is no smoothing, CAD/B-Rep reconstruction, or STEP output;
results support ordinary mesh STL/3MF export and native project backup.

The multi-candidate study is currently an editor workflow, not a new MCP tool. Existing paired
`analyze_lightweighting` and `request_lightweighting` operate on one scenario at a time; do not
advertise automatic multi-candidate study or selection support through MCP.

See [ADR-0107](../adr/0107-bounded-generative-design-studies.md) for ownership and alternatives.
