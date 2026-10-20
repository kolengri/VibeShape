# Printed lid fits and compliant retention

Use this reference for an insert-style printed lid, plug, or removable cover that
must fit inside a measured opening. Combine [mechanical design](mechanical-design.md)
with the applicable process guidance in [3D-printing design](3d-printing.md).
Threaded, gasketed, and positive-lock closures need their own interface design;
do not replace them with friction fins without preserving the requested function.

## Source and scope

[Slant 3D: Made to Fit Perfectly, 3D Printed Lids](https://www.youtube.com/shorts/DYnvg47Dn9E)
demonstrates three related techniques: relieve corner contact (approximately
0–9 seconds), add cuts that let the corner regions flex (9–18 seconds), and use
grip fins around the perimeter (18–23 seconds). The construction and acceptance
guidance below adapts those ideas to VibeShape; it is not a dimensioned recipe
from the video. The clip gives no material, calibrated clearance, spring travel,
insertion-force, or cycle-life specification. Compliance accommodates a bounded
size variation, not arbitrary dimensions or a guaranteed fit on every print.

## Establish the mating interface

Measure the opening at the insertion depth, including its smallest/largest
expected span, corner radii, taper, lip, and insertion stop. Distinguish measured
values from nominal CAD and assumptions. For a physical container, request the
critical measurements when they are unavailable; video proportions are not a scale.
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

### Relieve rigid corners

Use local corner cutbacks when the corners bind while the straight walls already
have the intended clearance. Remove contact only from the offending region and
retain adequate wall thickness, lid support, and insertion stops. This reduces
corner interference; it does not create a spring or fix an oversized rigid span.

Use `create_fdm` / `update_fdm` with `kind: corner-relief` only when a positioned
cylindrical cut matches the requested relief. Otherwise author the cutback with
a supported constrained sketch and subtractive feature. Inspect every affected
corner and the remaining sections; do not use an arbitrary whole-body edge fillet
as a substitute for removing the actual contact.

### Make corner regions compliant

Use slots or relief cuts that leave an attached corner segment free to bend in
the required contact direction. Preserve its root and a clear deflection space;
a notch that leaves a fully backed wall does not establish useful compliance.
Parameterize free length, bending thickness, slot width/depth, root radius, and
contact projection. Round slot ends and roots where function and available
geometry allow; inspect the residual section after the cuts.

Build this with supported sketch-driven cuts unless a live feature contract
actually matches the geometry. A cylindrical `corner-relief` alone is not a
general slotted-corner spring. Treat force, recoverable strain, creep, and fatigue
as material/process-dependent quantities requiring separate evidence.

### Distribute contact with grip fins

Keep the rigid lid core clear of the opening and add attached perimeter fins as
the intended contact regions. Provide a lead-in and space for the fins to deflect
along the insertion path. Parameterize fin projection, thickness, free length,
spacing, and engagement depth; maintain a root connected to the core. Distribute
fins over useful wall regions, avoiding interference between corner details.

For a centered symmetric fit, the fin-tip envelope must reach the largest opening
that needs contact, while required travel at the smallest opening must remain
within demonstrated recoverable deflection. Check each wall/profile direction;
a final assembled view alone does not establish an unobstructed insertion path.

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
