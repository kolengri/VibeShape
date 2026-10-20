# FDM/FFF lid fits and compliant retention

Use this reference for an FDM/FFF insert-style lid, plug, or removable cover that
must fit inside a measured opening. Establish FDM/FFF as the intended process before
applying these construction and calibration checks. For resin, SLS, MJF, or another
process, use its own design guidance instead. Combine [mechanical design](mechanical-design.md)
with the FDM/FFF section of [3D-printing design](3d-printing.md).
Threaded, gasketed, and positive-lock closures need their own interface design;
do not replace them with friction fins without preserving the requested function.

## Design principle

Separate the rigid locating geometry from the contact that provides retention.
A rigid lid perimeter can bind at a corner or along an entire wall when the
opening, print, or alignment varies. First give the rigid core sufficient
clearance. Then choose where contact should remain: straight wall regions,
flexible corner tabs, or distributed spring fins. Compliance accommodates a
bounded size variation; its useful travel and retention depend on geometry,
material, print orientation, temperature, and time under load.

| Observed need | Construction | Acceptance condition |
| --- | --- | --- |
| Corners bind while straight walls already fit | Recess the corner contact regions | Corner clearance throughout insertion, with wall support preserved |
| Local corner contact should yield during insertion | Isolate attached corner tabs with slots | Free tabs can bend into clearance space without hitting a stop or separating from the lid |
| Retention must tolerate variation around the opening | Clear the rigid core and add distributed cantilever fins | Fin contact at the largest opening and recoverable travel at the smallest opening |

Choose the simplest construction that meets the required retention and removal
behavior. Do not add all three treatments automatically. A freely removable
cover may need clearance and a stop without elastic interference.

## Establish the mating interface

Measure the opening at the insertion depth, including its smallest/largest
expected span, corner radii, taper, lip, and insertion stop. Distinguish measured
values from nominal CAD and assumptions. For a physical container, request the
critical measurements when they are unavailable; an unscaled image is not a measurement.
Identify removal access, retention needs, repeated-use expectations, and the
intended material/process before choosing a compliant detail.

Keep the container and lid as separate final parts. Define named variables for
the opening profile, per-side rigid clearance, insertion depth, lid thickness,
corner relief, and any spring or fin geometry before creating their consumers.
For opposed straight walls, a rigid insert span is the opening span minus twice
the per-side clearance. For curved or irregular profiles, construct the intended
normal clearance rather than uniformly scaling the outline. Preserve the user's
accepted surfaces and sealing requirements.

## Choose the contact strategy

### Corner clearance relief

Use local corner cutbacks when the corners bind while the straight walls already
have the intended clearance. Remove contact only from the offending region and
retain adequate wall thickness, lid support, and insertion stops. This reduces
corner interference; it does not create a spring or fix an oversized rigid span.
In plan view, replace the contacting corner of the insertion skirt with a recessed
arc, chamfer, or notch that clears the actual container corner over the engagement
depth. Keep the lid's top overhang or stop intact when it provides support.
Parameterize relief width/depth or radius separately from straight-wall clearance;
a smaller corner radius alone does not guarantee that the contact moved inward.

Use `create_fdm` / `update_fdm` with `kind: corner-relief` only when a positioned
cylindrical cut matches the requested relief. Otherwise author the cutback with
a supported constrained sketch and subtractive feature. Inspect every affected
corner and the remaining sections; do not use an arbitrary whole-body edge fillet
as a substitute for removing the actual contact.

### Integral corner flexure tabs

Use slots or relief cuts that leave an attached corner segment free to bend in
the required contact direction. Preserve its root and a clear deflection space;
a notch that leaves a fully backed wall does not establish useful compliance.
For a skirt attached to a lid plate, slots can start at the skirt's free insertion
edge and stop before the plate, leaving a continuous root. Place the slots so
the corner contact belongs to a defined flexible tab, with room to move toward
the core. Keep a connected load path from that tab to the plate; cutting through
the entire root creates a loose fragment instead of a flexure.
Parameterize free length, bending thickness, slot width/depth, root radius, and
contact projection. Use the tab's free length and bending thickness to tune
compliance independently of the rigid core clearance. Round slot ends and roots
where function and available geometry allow; inspect the residual section after
the cuts.

Build this with supported sketch-driven cuts unless a live feature contract
actually matches the geometry. A cylindrical `corner-relief` alone is not a
general slotted-corner spring. Treat force, recoverable strain, creep, and fatigue
as material/process-dependent quantities requiring separate evidence.

### Distributed cantilever grip fins

Keep the rigid lid core clear of the opening and add attached perimeter fins as
the intended contact regions. Provide a lead-in and space for the fins to deflect
along the insertion path. Parameterize fin projection, thickness, free length,
spacing, and engagement depth; maintain a root connected to the core. Distribute
fins over useful wall regions, avoiding interference between corner details.
Each fin needs an attached root, a free contact portion, and an unobstructed
bending path. Choose its cross-section and direction so insertion bends that
free portion rather than compressing a short, fully supported rib. Chamfer or
round the leading contact edge where appropriate, and keep the insertion stop
separate from the spring travel.

For a centered symmetric fit, the fin-tip envelope must reach the largest opening
that needs contact, while required travel at the smallest opening must remain
within demonstrated recoverable deflection. Check each wall/profile direction;
a final assembled view alone does not establish an unobstructed insertion path.

For two opposed, identical fins, use the following centered fit model along each
relevant span. It is a geometric travel budget, not a force or strength model:

- `opening_min`, `opening_max`: smallest and largest expected opening spans.
- `core_span`: rigid core span; `(opening_min - core_span) / 2` must retain the
  required rigid clearance at the tightest opening.
- `fin_envelope`: unloaded span across opposing fin tips.
- `deflection_min = (fin_envelope - opening_max) / 2`: minimum per-fin deflection;
  positive contact preload requires a value above zero.
- `deflection_max = (fin_envelope - opening_min) / 2`: maximum per-fin deflection;
  it must fit both the free geometric travel and the established recoverable travel.

Derive these quantities from named variables when supported. Include print
variation in the spans being assessed. If the lid can shift off center, or opposing
fins differ in stiffness, assess unequal travel instead of assuming an equal split.
Do not choose a universal interference allowance or claim sufficient retention
from a positive deflection value alone.

Author one editable fin and use a supported associative pattern or mirror when
the layout warrants it, then fuse attached additions into the lid's single solid.
Inspect terminal bodies so patterned fins do not remain separate printable parts.
The FDM `crush-ribs` tool adds inward ribs to an existing bore; it is not a generic
outward lid-fin tool, and sacrificial crush retention is not equivalent to a
reusable spring. Discover the actual sketch, pattern, and union schemas through
[modeling contracts](modeling.md) rather than inventing a dedicated lid tool.

## Accept and calibrate

Use exact preview and [inspection](../../vibeshape-inspection/SKILL.md) to check
rigid clearance, corner cutbacks, attachment roots, deflection spaces, insertion
depth/stops, and the intended terminal part count. Keep checks at the tightest
and loosest expected interface dimensions explicit. Review print orientation,
layer-direction loading, first-layer expansion, and whether slots/fins survive
the intended extrusion width and layer height.

For an uncalibrated fit, propose a small representative perimeter segment or
corner coupon with the same material, orientation, and local geometry. The built-in
FDM calibration coupon is a hole-size ladder, not a lid-fin test. Use ordinary
parametric geometry for a representative specimen. Physical checks should cover
insertion/removal, retention, permanent set, and repeated use as required; record
their actual results before claiming a verified fit. Update the existing fit
variables from that evidence rather than stacking unverified compensation.

Report the chosen strategy, assumptions, changed variables, and remaining physical
checks. CAD validity does not prove sealing, food-contact suitability, or production
reliability. Follow [export delivery](../../vibeshape-export/SKILL.md) when files are
requested; this reference grants no printer operation or print-start authority.
