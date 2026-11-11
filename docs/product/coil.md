# Coil

**Coil** (Model toolbar, Modeling menu and command palette) sweeps a closed section along an exact
helix. Use it for compression springs, wire coils, helical ribs and helical channels.

## Parameters

- **Operation:** *New body* creates an independent part. *Add*, *Remove* and *Intersect* modify one
  exact target body chosen from the current solids (or picked in the viewport); the target keeps its
  name and History.
- **Helix axis:** the origin Z axis by default, another origin axis, a datum plane axis (x, y or
  normal), a stable straight model edge, or an explicit origin and direction. The helix starts on its
  radius at the **start angle** and advances along the axis direction.
- **Handedness:** right-hand helices turn counterclockwise when viewed against the axis direction;
  left-hand helices turn clockwise.
- **Radius** and **pitch:** distance from the axis to the section center, and axial advance per turn.
- **Length by:** a number of **turns** (0.05–50, fractional allowed) or a **height**, the axial travel
  of the section center; turns are height divided by pitch.
- **Section:** *Circular* (diameter) or *Rectangular* (radial width and axial height). The section is
  centered on the helix and normal to it.

Every length, angle and count accepts a `#variable` expression. The section must not reach the axis,
and adjacent turns must not touch. Points of the section nearer the axis climb faster than its center,
so the required pitch is somewhat larger than the section height; the exact rule is in
[ADR-0155](../adr/0155-exact-helix-coil-and-helical-sweep.md). The panel shows the minimum pitch when
this rule fails.

## Behavior

The preview is the exact kernel result and is disposable; Apply stays disabled until it succeeds and
creates one ordinary undoable transaction. Editing a History row keeps the feature identity and all
authored expressions. Native `.vshape` save/open, undo/redo, STEP export and downstream features use
the shared document lifecycle.

The section is swept with the Frenet trihedron and does not twist along the helix. Both ends are flat
cuts normal to the helix. Ground (flat) spring ends, variable pitch or radius, conical coils and
multi-start coils are not modeled; trim ends with a downstream Split or Remove if needed.

## Helical Sweep

Sweep can also follow a helix: choose **Path type → Helix** in the Sweep task panel and set the same
helix parameters. Save the profile sketch on a plane through the helix start, normal to its starting
tangent; the panel shows the required tilt (the lead angle `atan(pitch / (2π·radius))`). For a helix on
the origin Z axis starting at +X, an XZ datum plane rotated about its x axis by +lead angle
(right-hand) or −lead angle (left-hand) is the usual support. The profile is never moved: after
changing the radius, pitch, start angle, handedness or axis, re-orient that datum plane or the
preview fails. Preview never moves the profile. Holed
profiles are not supported on helix paths. See [Sweep and Loft](sweep-loft.md).

## Automation

Local and paired remote MCP expose `create_coil` and `update_coil` over the same owned-draft,
preview and commit route; `create_sweep`/`update_sweep` accept a `{ kind: "helix", … }` path.
See [ADR-0155](../adr/0155-exact-helix-coil-and-helical-sweep.md).
