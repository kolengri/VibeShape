# Design for 3D printing

Apply this reference only to models intended for printing. Establish the process, candidate print orientation, material, and critical interfaces before changing manufacturing details. Ask for missing process information only when it changes the design; label reversible assumptions. Read [mechanical design](mechanical-design.md) for functional or loaded parts. Live tools and exact preview remain authoritative for CAD operations.

## FDM / FFF

### External corners and motion

Prefer rounded external corners in the layer-plane outline, usually by rounding edges parallel to print Z, when dimensions, fits, contact faces, and appearance permit. Use a meaningful variable-backed radius rather than indiscriminately treating every edge. [Klipper's planner documentation](https://www.klipper3d.org/Kinematics.html#look-ahead) explains corner-speed limits; expecting smoother motion from a rounded outline is an engineering inference, not a measured speedup or evidence about a particular printer's firmware. Small radii remain acceleration-limited. Compare sliced paths/time under unchanged settings only when a performance claim matters.

Distinguish these vertical corners from bed-facing edge rounds: a bottom fillet can create a steep early overhang. Prefer a suitable chamfer there when function permits, preserving adequate bed contact. [Prusa's modeling guidance](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135) describes this orientation-dependent tradeoff.

### Orientation and supported growth

Choose orientation before detailing. Balance layer-direction loading, surface finish, bed contact, and support removal. Inspect roofs, horizontal holes, short bridges, and disconnected starting regions in that frame. Consider sloped or teardrop roofs only if their shape preserves the required interface. Splitting a part may reduce supports but adds a joint to assess. Overhang angles and bridge spans are profile-dependent trial limits, not universal pass criteria. See [Prusa's orientation and support guidance](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135).

### Walls and small details

Relate walls, ribs, text, and small radii to the intended extrusion widths and layer height. Inspect sliced continuity of critical features. Do not require every wall to be an exact nozzle-width multiple: [Arachne](https://help.prusa3d.com/article/arachne-perimeter-generator_352769) adapts extrusion width, but can still omit or widen small features. Printable minimums do not establish structural sufficiency.

### Fits and assembly

Separate nominal CAD dimensions from calibrated hole/fit allowances. Use representative coupons for critical clearances; consider post-machining when required accuracy cannot be established by printing. Preserve access to holes and fasteners. Small loaded pins may benefit from a root radius or a separate hardware pin. Account for first-layer expansion at bed-level mating edges without stacking unverified CAD and slicer compensation. [Protolabs Network's FDM guide](https://www.hubs.com/knowledge-base/how-design-parts-fdm-3d-printing/) discusses these issues; its numeric examples are not universal limits.

## Resin and other processes

For SLA/MSLA, use the intended machine/resin guide for feature limits and support orientation. Hollowing must account for drainage, cleaning access, and cups in the build orientation; FDM corner-motion advice does not transfer to a resin exposure process. [Formlabs' SLA orientation guidance](https://formlabs.com/support/Model-Orientation/) discusses orientation and drain holes. Its [Form 2 design limits](https://formlabs.com/global/support/Design-Specs/) are tied to that machine, resin, and layer thickness, not all resin printers.

For SLS/MJF or another process, retrieve the actual provider/material design rules before adopting thickness, clearance, or cavity constraints. Do not silently substitute another process to avoid a design limitation.

## Evidence and delivery

Inspect exact final geometry and residual sections, then use [the export workflow](../../vibeshape-export/SKILL.md) for requested files. Check mesh units and curve resolution on the exported artifact, not only the shaded viewport. Record support needs or missing slicer evidence honestly. A valid solid, a clear preview, and a successful slice are distinct from physical fit and print success. Do not launch a print or change printer settings from modeling authorization alone.

Primary sources above were checked on 2026-10-08. Recheck machine-specific claims when choosing actual production limits; the motion recommendation is a qualified synthesis of planner behavior and the requested design preference.
