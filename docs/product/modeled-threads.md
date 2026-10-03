# Modeled custom threads

Thread removes real helical V-groove geometry from one exact body. It is a custom 60-degree profile,
not a standard ISO/DIN thread designation or a cosmetic display effect.

Select one visible, available part in the Parts group and choose Thread. The exact current body
role is captured once; the result continues the same part identity, name, visibility, and history.
The task starts with an explicit Z axis at the origin, diameter 10 mm, pitch 2 mm, length 6 mm,
depth 0.8 mm, and radial clearance 0.1 mm. These are editable defaults, not inferred dimensions.
Open **Axis, origin and thread options** to set the frame, handedness, starts, phase, and allowances.
Lengths and angles use document display units when bare values are entered. Starts stays scalar.

Apply requires one successful exact native preview; invalid fields, unavailable source bodies,
missed bands, and kernel failures block it with readable diagnostics. Cancel disposes the preview
without authoring a feature. The History row edits the same feature, preserving raw expressions
and body binding. Apply/Update, Undo/Redo, reload, native Save/Open, and selected-part STEP export
use the ordinary document lifecycle. Saving failures preserve the task values and release the
submission lock for retry.

`create_thread` and `update_thread` use the ordinary paired owned draft route. Supply the exact
`targetBody`, its sole matching dependency, empty topology references, and all authored quantities.
Use a fresh command ID and the current draft revision. Preview must succeed before the ordinary
commit operation can apply the draft.

Choose an external or internal thread, the positive world X/Y/Z axis, and an explicit origin.
The origin is axial position zero. Enter nominal diameter, pitch, length, groove depth, radial
clearance, handedness, starts, phase, and unthreaded run-in/run-out allowances. Length quantities
use millimeters after conversion, phase uses radians after conversion, and starts is dimensionless.
All quantities can retain expressions.

For an external thread, crest radius is nominal radius minus clearance and the groove cuts inward.
For an internal thread, bore radius is nominal radius plus clearance and the groove cuts outward.
Clearance changes the actual radial fit envelope throughout the threaded band. The groove depth
is measured from that adjusted crest or bore. Each start must cut material; an operation that only
applies clearance fails.

The modified band starts at `runIn` and ends at `length-runOut`. Material outside that band stays
unchanged. These allowances leave unthreaded axial regions and create abrupt boundaries; they do
not produce a smooth tapered lead-in or lead-out.

Pitch is the axial spacing between adjacent starts. With N starts, each helix has lead N times
pitch and phases are separated by one revolution divided by N. Right-handed threads increase
angle along the positive axis; left-handed threads decrease it. Phase zero points toward world +Y
for an X axis, +Z for a Y axis, and +X for a Z axis.

Supported authoring bounds are 1-4 starts, positive diameter and length up to 1,000 mm, pitch from
0.2 to 20 mm, depth at most 0.75 times pitch, phase within +/-one revolution, and at most 16 total
authored turns. The band and external root radius must remain positive. Extremely small dimensions,
invalid sweeps, disconnected results, missed material, and out-of-workspace geometry fail explicitly.

Digital geometry validation does not prove standardized mating, printer accuracy, strength, or
physical fit. See [ADR-0064](../adr/0064-modeled-custom-threads.md) for native ownership and integration
gates. Native frame/parameter coverage, browser acceptance, and integrated review are separate
verification evidence; the editor controls do not imply those gates have passed.
