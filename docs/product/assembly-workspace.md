# Assembly workspace

The Model/Assembly controls switch geometry workspaces within one project. Assembly keeps ordinary
committed Undo/Redo and native Save/Open; Model authoring shortcuts and the Model export dialog are
unavailable while Assembly is active.

The Assembly browser groups instances, joints and frozen definitions. Filter by component,
definition or joint type; section disclosure preserves selection. Instance rows distinguish grounded,
joint-connected and free occurrences. Joint rows name both endpoints and open their existing editor;
movable joints also expose **Drive** directly.

Create a definition from an available Part to freeze its selected body and source dependency
closure. Reuse that definition through independent named instances with UUIDs and rigid world
poses. Editing or deleting the original Part does not change the frozen source. Explicit relinking
captures a new definition revision while keeping its occurrence identities.

Existing assembly version 1 retains grounded forests with one inbound fixed, revolute or prismatic
joint per child. **Enable general mates** explicitly upgrades to version 2, preserving old driven
poses and frozen pins. Undo restores version 1. General mates support closed loops, multiple mates
per instance, cylindrical joints and ball joints. At least one instance in each connected component
must be grounded. Passive coordinates remain free; locking a drive adds its equality constraint.
The displayed degrees of freedom describe local mobility at the solved pose. Redundant-consistent
mates can solve successfully. Conflicts and nonconvergence leave the proposed edit uncommitted.

The Assembly task panel groups common actions into an icon toolbar and a **More assembly actions**
menu. The menu keeps create/connect, motion and selected-item actions together, including saved
studies. Icon controls have names and tooltips; labelled menu items retain visible text.

**As-built joint** captures the inspected occurrence poses at the current project and revision. It
uses the child origin and orientation as a shared frame, converts that frame to each endpoint, and
preflights the complete edit with the ordinary worker before one guarded transaction. Version 1
supports fixed, revolute and prismatic kinds; version 2 also supports cylindrical and ball kinds.
The child becomes ungrounded; general-mate initial poses preserve the captured branch. A stale
capture, invalid graph, unavailable source or failed solve leaves the design unchanged.

**Rigid group** connects selected instances to an explicit anchor through fixed as-built joints.
The anchor keeps its grounding; other members become ungrounded. The current assembly version
continues to enforce inbound, cycle and anchoring rules. The group stores ordinary star joints in
one atomic transaction, so one Undo restores the previous assembly without a new saved-file entity.
These are UI conveniences over existing mutations; the MCP contract still uses explicit joint
frames and does not advertise new named As-built Joint or Rigid Group tools.

Parent and child frames can use explicit numeric poses or geometry from their frozen definition.
Select a planar, cylindrical or spherical face, a circle/arc edge or a vertex. An origin hint and X
direction establish a finite right-handed frame; numeric fields become offsets from that frame.
Bindings use durable topology references and pin revisions. Missing, ambiguous or stale geometry
requires explicit reselection. Mesh bodies support numeric frames but have no exact topology frame.

The worker reuses the installed SolveSpace WASM for a local static solve. Editable initial poses
select branches and seed passive motion. A solved pose does not prove global uniqueness. Passive
limits are checked after solving, never clamped; change an initial pose or lock a drive to recover
an out-of-limit branch. No physical dynamics or collision response is claimed. See
[ADR-0080](../adr/0080-general-assembly-mates-and-topology-bound-frames.md) for the mathematical and
failure contract.

## Joint motion

Choose Drive for a revolute, prismatic or cylindrical joint. Select rotation or translation where the
joint supports both, enter a coordinate in project display units, and choose **Preview coordinate**.
The ordinary frozen-source worker solves the actual constraints, including general closed loops.
Out-of-range values, conflicts and nonconvergence show an error without substituting approximate
transforms. The saved assembly remains authoritative for export and interference.

**Play one sweep** samples an increasing range within authored limits and solves one disposable preview
at a time. **Pause** stops the sweep, **Reset preview** restores the saved pose, and **Cancel** discards
the motion session. The camera stays stable between samples. No sample creates a document command.
**Apply** saves the displayed successfully solved coordinate through one ordinary guarded joint update
and one Undo checkpoint; applying a passive coordinate explicitly locks it as a drive. A cylindrical
joint's other coordinate keeps its authored constraint. Project/revision changes and leaving Assembly
dispose pending previews. This is a kinematic preview, without dynamics or collision response.

The viewport renders already placed occurrence meshes and selects instances independently of Model
Parts. Interference checks use native transformed exact solids; bounds only reject separated pairs.
Touching faces are clear. Overlapping triangle meshes report unsupported. No approximate overlap
is presented as exact material intersection.

Export Assembly chooses all instances or one selected occurrence. STEP preserves independent exact
solids and their placements; STL and 3MF export placed meshes, with named 3MF objects. STEP is
unavailable for a mesh selection. The print panel creates a disposable combined copy, preserving
relative instance placement before its explicit rotation, centering and seating. Bed-fit warnings
include support geometry. Preparation supports at most eight source bodies; ordinary export remains
available for larger bounded selections. Changing scope, revision or settings invalidates a prior
prepared download. No export modifies the design.

The [local component library](local-component-library.md) inserts frozen copies or explicit pinned
references into this workspace. See [ADR-0069](../adr/0069-frozen-assembly-source-authority.md) and
[ADR-0072](../adr/0072-derived-assembly-geometry-and-exact-interference.md) for authority and geometry
boundaries. Native tests, browser workflow tests and integrated code review provide separate evidence;
they do not prove a physical assembly, printer operation or manufactured fit.

Applicable surface texture layers cannot currently be frozen into an assembly or library pin.
Capture fails with an explicit diagnostic: remove the layers or choose an untextured source.
Ordinary Model STL/3MF exports still include enabled relief; STEP exports the exact base B-Rep.
No capture silently replaces a textured source with its untextured shape.

Paired local and remote MCP can author definitions, instances and general mates through owned assembly
drafts, inspect bounded frozen topology and exact interference, and publish/insert explicit immutable
local-library versions. All writes require manual browser review and ordinary revision/metadata CAS.
See the [assembly/library workflow](../../.agents/skills/vibeshape-modeling/references/assembly-and-library.md)
and [ADR-0089](../adr/0089-owned-assembly-and-library-mcp-drafts.md).
