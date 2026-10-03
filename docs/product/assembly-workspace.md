# Assembly workspace

The Model/Assembly controls switch geometry workspaces within one project. Assembly keeps ordinary
committed Undo/Redo and native Save/Open; Model authoring shortcuts and the Model export dialog are
unavailable while Assembly is active.

Create a definition from an available Part to freeze its selected body and source dependency
closure. Reuse that definition through independent named instances with UUIDs and rigid world
poses. Editing or deleting the original Part does not change the frozen source. Explicit relinking
captures a new definition revision while keeping its occurrence identities.

Grounded instances establish roots. Attach an ungrounded child through a fixed, revolute or
prismatic joint with explicit parent/child frames and axis. Revolute and prismatic limits and drive
values use the domain's bounded static kinematic solver. Degrees of freedom and failures are
visible. The solver accepts a grounded forest with one inbound joint per child; it does not solve
closed linkage loops or claim physical dynamics.

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
