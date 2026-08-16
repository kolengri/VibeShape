# Sketch precision toolset

## Purpose

This document defines the mandatory first-production sketch tools and their interaction contract. A
tool is mandatory when a user needs it to author and fully constrain ordinary 3D-printable profiles
without treating the constraint list as the primary spatial interface.

The domain sketch record remains authoritative. Canvas glyphs, adaptive toolbars, solved positions,
and selection are presentation state; they never replace stable entity and constraint identities.

## Mandatory geometry tools

| Tool | Minimum behavior | Status |
|---|---|---|
| Select | Single and additive entity selection, point dragging, and Delete/Backspace | Implemented |
| Point | Place a stable analytical point with persistent point, midpoint, intersection, and point-on-line inference | Implemented |
| Line | Place a stable segment with endpoint reuse plus persistent point, direction, and tangent inference | Implemented |
| Midpoint Line | Place a segment symmetrically from its midpoint with persistent midpoint intent | Implemented |
| Corner Rectangle | Author four lines as one local history edit | Implemented |
| Center Rectangle | Author symmetric geometry and construction diagonals as one local history edit | Implemented |
| Aligned Rectangle | Define one side, then a signed perpendicular width with persistent perpendicular and parallel intent | Implemented |
| Centered Aligned Rectangle | Define the center, symmetric direction/half-length, and perpendicular half-width with a persistent construction axis and midpoint intent | Implemented |
| Center-point Circle | Author a center and analytical radius | Implemented |
| Three-point Circle | Author an exact circle through three non-collinear points | Implemented |
| Circumscribed Polygon | Define a center, vertex radius, and 3–50 sides; keep every vertex on one construction circle with equal side intent | Implemented |
| Inscribed Polygon | Define a center, tangent-circle radius, and 3–50 sides; keep side midpoints on the construction circle with equal side intent | Implemented |
| Center-point Arc | Author center, start, end, and positive sweep | Implemented |
| Three-point Arc | Author an exact circumcircle arc from three non-collinear points | Implemented |
| Tangent Arc | Continue from a line endpoint with a shared point and persistent tangent intent | Implemented |
| Straight Slot | Define two centerline endpoints and a signed half-width with analytical semicircular end caps | Implemented |
| Centered Slot | Define a center, symmetric centerline endpoint, and signed half-width | Implemented |
| Slot from selected line | Convert exactly one selected line into a construction centerline and define its signed half-width | Implemented |
| Construction | Mark reference geometry that participates in constraints but not profiles | Implemented |
| Local Undo/Redo | Reverse or restore one authored draft operation without a document revision | Implemented |

The command toolbar groups related variants like Onshape: Line and Midpoint Line; Corner, Center,
Aligned, and Centered Aligned Rectangle; Center-point and Three-point Circle; Inscribed and
Circumscribed Polygon; Three-point, Tangent, and Center-point Arc; and Straight, Centered, and
selection-driven Slot. The family
button invokes the active or last-used variant, while its adjacent menu exposes every variant with
the standard shortcut when one exists. Every family exposes a center-origin variant when its
geometry has a stable, unambiguous center construction. Free-form or selection-driven tools are not
duplicated with artificial center modes.

Trim, Extend, Split, mirror/pattern authoring, ellipses, curve-chain slots, splines, and
projected external geometry remain follow-up tools. They require new exact domain and solver
behavior and MUST NOT be simulated only in the toolbar.

## Onshape-oriented parity baseline

VibeShape follows the interaction grammar of Onshape without copying its visual design. The
baseline is derived from the official [Sketch tools](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm),
[Circumscribed Polygon](https://cad.onshape.com/help/Content/Sketch/circumscribed_polygon.htm), and
[Inscribed Polygon](https://cad.onshape.com/help/Content/Sketch/inscribed_polygon.htm) documentation.

| Family | Current parity | Remaining production gap |
|---|---|---|
| Line | Line and center-origin Midpoint Line in one remembered split family | Infinite construction line and richer wake-up inference |
| Rectangle | Corner, Center, Aligned, and Centered Aligned variants | Selection-driven conversion and numeric placement |
| Circle | Center-point and Three-point variants | Tangent circle and ellipse require exact solver entities |
| Polygon | Inscribed and Circumscribed variants; center, radius/apothem, pointer or typed side count; 3–50 sides | Numeric radius entry and side-count editing after creation |
| Arc | Three-point, Tangent, and Center-point variants | Fillet and selection-driven arc repair |
| Slot | Straight, Centered, and selected-line variants | Analytical arc/curve-chain selection |
| Modify | Delete and direct point manipulation | Trim, Extend, Split, Offset, Mirror, Transform, and patterns |
| Curves | Analytical lines, circles, and arcs | Ellipse, spline, conic, and projected/external geometry |

Every family button invokes its active or last-used variant. Polygon placement uses three visible
stages: select the center, select the vertex radius or tangent-circle radius, then adjust the side
count with pointer distance or type an integer from 3 through 50. `Enter` commits a valid count,
`Backspace` edits typed input, and `Escape` cancels the transient polygon without changing the draft.
The completed polygon is one schema-valid domain operation and one local undo entry.

## Mandatory geometric constraints

| Constraint | Selection contract | Canvas glyph | Status |
|---|---|---:|---|
| Coincident | Exactly two points | `×` | Implemented |
| Horizontal | Exactly one line | `H` | Implemented |
| Vertical | Exactly one line | `V` | Implemented |
| Parallel | Exactly two lines | `∥` | Implemented |
| Perpendicular | Exactly two lines | `⊥` | Implemented |
| Equal | Exactly two lines or two round curves | `=` | Implemented |
| Tangent | Exactly one line and one arc | `T` | Implemented |
| Concentric | Exactly two circles/arcs | `◎` | Implemented |
| Midpoint | Exactly one point and one line | `M` | Implemented |
| Symmetric | Exactly two points and one symmetry line | `S` | Implemented |
| Fix point | Exactly one point | `F` | Implemented |
| Point on line | Exactly one point and one line | `⊙` | Implemented |
| Point on curve | Exactly one point and one circle/arc | `⊙` | Implemented |

Each selection exposes only definitions that consume the complete selection. The editor MUST NOT
silently apply a constraint to a subset of selected entities.

## Mandatory driving dimensions

| Dimension | Selection contract | Canonical value | Status |
|---|---|---|---|
| Distance | One line or exactly two points | Length | Implemented |
| Horizontal distance | Exactly two points | Length | Implemented |
| Vertical distance | Exactly two points | Length | Implemented |
| Angle | Exactly two lines | Angle | Implemented |
| Radius | Exactly one circle/arc | Length | Implemented |
| Diameter | Exactly one circle/arc | Length | Implemented |

Dimensions accept an explicit unit, a bare value in the active project display unit, or a committed
`#variable` expression. Authored text is preserved while solving uses canonical millimeters and
radians. Length dimensions MUST be positive; angle inputs MUST resolve to an angle.

Reference/driven dimensions, arc length, point coordinates, and construction measurements remain
follow-up work. They require an explicit reference-versus-driving model and MUST NOT be simulated by
adding solver constraints.

## Interaction contract

1. The viewport is selection-first. A compact icon-only precision toolbar appears next to the
   working area when the complete selection supports a geometric constraint or dimension.
2. Every icon has a localized accessible name and tooltip. Standard technical glyphs are preferred
   over repeated icon-and-text controls in the canvas.
3. The task panel provides the keyboard-accessible equivalent, the dimension expression form, the
   applied-constraint list, conflict state, and removal controls.
4. Selecting a dimension label on the drawing selects the same stable constraint and opens its
   expression editor. Selecting a geometric glyph selects the matching task-panel row.
5. Adding, editing, or removing a constraint is one local sketch-history edit. It does not create a
   document revision until Finish succeeds.
6. The last valid exact solved geometry remains visible while a replacement solve is pending. A
   dimension edit or constraint selection MUST NOT reset sketch pan/zoom or the 3D camera.
7. Solver conflicts remain visible by stable constraint identity. The editor never deletes or
   weakens constraints automatically.
8. Pointer-drag previews remain local to the viewport and solver scheduler. The editor publishes
   exactly one global draft and one undo checkpoint when the gesture ends. Raw pointer samples are
   reduced to the latest sample per animation frame before inference and viewport-local React state.
   Continuous movement MUST restart a short solver idle delay instead of publishing through the
   parent workspace on every frame. A pause or release sends the original schema-valid sketch plus
   the latest separate drag target; release keeps that final overlay visible until the exact result
   settles. No drag-frame path may clone or schema-parse the complete sketch.
9. Large constraint lists scroll inside the fixed-height task panel. They never increase the CAD
   workspace row height or move sketch geometry outside the visible viewport.
10. Existing-point, segment-midpoint, bounded segment-intersection, point-on-line, horizontal,
    vertical, parallel, perpendicular, and endpoint-tangent candidates use deterministic priority
    and visible glyphs. Accepting a candidate persists its semantic constraint; holding `Shift`
    suppresses inference without changing the active tool.
11. Center-origin polygon previews show the construction circle, radius guide, outline, and side
    count before commit. Circumscribed Polygon places vertices on the construction circle;
    Inscribed Polygon places the construction circle tangent to the outline. Closed-loop-dependent
    constraints omit mathematically redundant relations so an exact valid polygon is not reported
    as over-constrained.

## View orientation

The modeling viewport keeps an always-visible camera-relative world-axis inset. X is red, Y is
green, and Z is blue in both themes. Orbiting updates the inset without reinitializing the viewport
or fitting the model. The unit/orientation badge says `XYZ`; sketch mode separately identifies its
active support plane and display unit.

## Follow-up sequence

1. Add remembered wake-up references, point-to-point horizontal/vertical alignment, arc midpoint and
   quadrant candidates, and projected/external geometry inference.
2. Extend Slot from a single selected line to analytical arcs and validated curve chains, then add
   ellipses and splines through exact analytical or solver-backed entities.
3. Add numeric point placement and coordinate editing.
4. Add reference dimensions and a driving/reference conversion command.
5. Add Trim, Extend, and Split with stable replacement identity and dependent-constraint repair.
6. Add guided over-constraint repair that presents a bounded conflicting set without automatic
   deletion.
