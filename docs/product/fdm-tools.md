# Editable FDM features

The Model command **FDM tools** creates one ordinary editable Part Design feature,
`org.vibeshape.feature.part-design.fdm` version 1. It uses exact OCCT geometry,
revisioned Preview/Apply, History editing, suppression, Undo/Redo, native project
save/open, and the same authored-part ownership as other modifying features.
Its twelve kinds cover the following operations:

| Kind | Result |
|---|---|
| Web / Rib | Reinforcement from selected nonconstruction straight lines in a saved solved sketch |
| Corner relief | Cylindrical relief cut at a positioned corner |
| Seam trap groove | Triangular groove cut along the local X direction |
| Teardrop hole | Circular lower arc with tangent roof flanks, optionally a flat bridge at the top |
| Compliant hex seat | Hexagonal pocket with six radial slots |
| Crush ribs | Radial rectangular ribs extending inward into an existing bore |
| Flexible sleeve | Hollow cylinder with axial slots and a retained closed base |
| Nut pocket | Hexagonal recess with radial clearance |
| Insert pocket / boss | Cylindrical recess with radial clearance and an optional cylindrical boss |
| Enclosure lip / groove | Rectangular ring added as a lip or cut as a groove with clearance |
| Sacrificial membrane / bridges | Thin rectangular sheet or separated rectangular bridges fused to the target |
| Calibration coupon | Independent rectangular plate with a progression of circular through holes |

A calibration coupon needs no target. A flexible sleeve can be independent or
fused to an exact target. All other kinds modify a selected exact body role.
Operations must actually change the target and produce one valid connected solid
with positive volume; a missed cutter, detached addition, or disconnected result
fails explicitly. Existing target geometry is never mutated in place.

## Position and dimensions

Spatial features use a world-coordinate origin and an X, Y, or Z extrusion axis.
Their profile is authored in local XY and swept along local positive Z before
placement. Dimensions and origin coordinates retain quantity units and expression
sources. Counts are bounded plain integers; the editor can evaluate an expression
for a count, but a saved count is not an associative variable quantity.

Teardrop **Roof flank angle** measures each roof flank above horizontal, from 15
to 75 degrees. The apex angle is 180 degrees minus twice the flank angle. The
flat-top variant replaces the upper apex with a horizontal bridge at the circle's
upper extent. Hole position/orientation must still be chosen for the intended
print direction; the tool does not infer a printer orientation.

**Crush ribs** assumes the bore already exists. Place the rib origin at that
bore's axis and choose the same depth and direction. Optional insert bosses use
both a positive diameter and height; zero in both editor fields omits the boss.
Calibration hole centers must remain farther apart than the largest hole diameter.

## Web and Rib

Select the exact target, a saved sketch, and one to sixty-four distinct straight
nonconstruction line entities. Sketch solutions and support frames are resolved
at the current revision; missing lines are diagnosed rather than replaced.

**Web** thickens each line in its sketch plane and extrudes the strip along the
sketch normal. **Rib** creates a triangular gusset in the sketch plane and gives
it symmetric thickness along the normal. Forward/reverse changes the signed
reinforcement depth.

Automatic extension is bounded to planar prismatic cavities whose finite wall
faces are rectangular and cover the complete reinforcement endpoints. Curved,
partial, or ambiguous wall coverage fails explicitly. Web can stop at an authored
parallel origin, datum, or explicit plane with a positive reachable extent.
Finite body-face termination is not supported by this feature. Rib has no stop
plane; its depth controls its in-plane triangular extent.

## MCP and existing tools

Both local and paired remote MCP advertise `create_fdm` and `update_fdm`. They
require typed parameters, exact target roles, ordinary draft/command identities,
explicit suppression intent, and matching ordered dependencies. Dependencies are
target first, distinct saved-sketch support owner second, and distinct stop-plane
owner last. Only Web/Rib carries the saved sketch's actual support reference.
Current schemas, diagnostics, and exact draft preview remain authoritative.

A flat cut on a cylinder or sphere uses the existing **Split** command and its
negative/positive output roles; there is no duplicate FDM cut feature.

Metric thread diameter/pitch presets and export mesh quality complement this
workflow. Thread remains a custom modeled V groove rather than a certified ISO
thread profile or fit. STL/3MF export quality controls tessellation of an export
copy, without changing authored solids. See [3D printing](../3d-printing.md).

These geometry features do not configure slicer walls, Arachne, infill, or actual
printing. Clearance, membrane thickness, compliant fit, and thread fit require
calibration for the selected material, nozzle, orientation, and process.
