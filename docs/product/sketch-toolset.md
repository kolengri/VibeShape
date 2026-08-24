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
| Center-point Ellipse | Define a center, first axis endpoint, and perpendicular second-axis radius as one exact analytical curve | Implemented with stable primary- and secondary-axis diameter dimensions; direct curve modification remains open |
| Elliptical Arc | Define a center, primary-axis endpoint, secondary radius and start point, then the endpoint along a temporary construction ellipse | Implemented as one exact analytical curve with solver-owned trammel constraints and direct Trim/Extend/Split against bounded lines |
| Circumscribed Polygon | Define a center, vertex radius, and 3–50 sides; keep every vertex on one construction circle with equal side intent | Implemented |
| Inscribed Polygon | Define a center, tangent-circle radius, and 3–50 sides; keep side midpoints on the construction circle with equal side intent | Implemented |
| Center-point Arc | Author center, start, end, and positive sweep | Implemented |
| Three-point Arc | Author an exact circumcircle arc from three non-collinear points | Implemented |
| Tangent Arc | Continue from a line endpoint with a shared point and persistent tangent intent | Implemented |
| Straight Slot | Define two centerline endpoints and a signed half-width with analytical semicircular end caps | Implemented |
| Centered Slot | Define a center, symmetric centerline endpoint, and signed half-width | Implemented |
| Slot from selected line | Convert exactly one selected line into a construction centerline and define its signed half-width | Implemented |
| Trim curve | Remove the clicked line, arc, or circle portion bounded by neighboring analytical curve intersections while preserving the original identity on one retained remainder | Implemented |
| Extend open curve | Move the clicked-near line or arc endpoint to the nearest reachable bounded line, arc, or circle intersection while preserving the curve identity | Implemented |
| Split curve | Divide a line or arc at one projected point; divide a circle at two projected points into complementary equal-radius arcs | Implemented |
| Mirror | Reflect selected or subsequently picked points, lines, arcs, circles, and ellipses across a sketch line while preserving shared-point and symmetry intent | Implemented |
| Offset | Offset one line or a connected non-branching line chain/loop with live signed preview and one variable-ready driving dimension | Implemented for lines |
| Transform | Move, axis-translate, rotate, or uniformly scale preselected or subsequently selected sketch geometry with one transient manipulator, relocatable point-snapping origin, variable-aware exact values, and one local history commit | Implemented |
| Linear Pattern | Repeat preselected or subsequently selected sketch geometry in one or two exact directions with count, spacing, and angle controls; preview at most ten total instances and commit once | Implemented as bounded analytical copies; associative pattern editing remains open |
| Circular Pattern | Repeat preselected or subsequently selected geometry around an exact center as a closed 360° distribution or an open signed sweep; preview at most ten total instances and commit once | Implemented as bounded analytical copies; draggable center and associative pattern editing remain open |
| Construction | Mark reference geometry that participates in constraints but not profiles | Implemented |
| Local Undo/Redo | Reverse or restore one authored draft operation without a document revision | Implemented |

The command toolbar groups related variants like Onshape: Line and Midpoint Line; Corner, Center,
Aligned, and Centered Aligned Rectangle; Center-point and Three-point Circle plus Center-point Ellipse; Inscribed and
Circumscribed Polygon; Elliptical, Three-point, Tangent, and Center-point Arc; and Straight, Centered, and
selection-driven Slot. The family
button invokes the active or last-used variant, while its adjacent menu exposes every variant with
the standard shortcut when one exists. Every family exposes a center-origin variant when its
geometry has a stable, unambiguous center construction. Free-form or selection-driven tools are not
duplicated with artificial center modes.

Trim and Split operate on analytical lines, arcs, and circles. Extend operates on open analytical
lines and arcs because a closed circle has no endpoint. Mirror accepts a sketch line as its axis and
reflects points or analytical curves through shared pure domain operations. Offset accepts a
preselected line set or expands one clicked line to its connected non-branching component, previews
the signed side and miter intersections, and commits one compound constraint whose dimension drives
every line pair plus both open-chain endpoints. Ellipse-to-round and ellipse-to-ellipse modification boundaries, spline, drag-through Trim, free-end Extend,
round-curve Offset, associative pattern authoring, curve-chain slots, and projected
external geometry remain follow-up work. Linear Pattern currently materializes independent copies
and clones only constraints wholly internal to the seed selection; it intentionally omits crossing,
fixed, and rotation-incompatible projected constraints. Circular Pattern follows the same
materialized-copy contract, supports an exact project-unit-aware center and a closed or open angular
distribution, and rotates orientation constraints only when their exact quarter-turn meaning is
preserved. These capabilities require exact domain and
solver behavior and MUST NOT be simulated only in the toolbar.

## Onshape-oriented parity baseline

VibeShape follows the interaction grammar of Onshape without copying its visual design. The
baseline is derived from the official
[Sketch tools](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm),
[Circumscribed Polygon](https://cad.onshape.com/help/Content/Sketch/circumscribed_polygon.htm),
[Inscribed Polygon](https://cad.onshape.com/help/Content/Sketch/inscribed_polygon.htm),
[Trim](https://cad.onshape.com/help/Content/Sketch/trim.htm),
[Extend](https://cad.onshape.com/help/Content/Sketch/extend.htm), and
[Sketch Split](https://cad.onshape.com/help/Content/Sketch/sketch_split.htm), and
[Sketch Mirror](https://cad.onshape.com/help/Content/Sketch/sketch_mirror.htm), and
[Offset](https://cad.onshape.com/help/Content/Sketch/offset.htm), and
[Sketch Transform](https://cad.onshape.com/help/Content/Sketch/sketch_transform.htm),
[Linear Sketch Pattern](https://cad.onshape.com/help/Content/Sketch/sketch_linear_pattern.htm), and
[Circular Sketch Pattern](https://cad.onshape.com/help/Content/Sketch/sketch_circular_pattern.htm), and
[Ellipse](https://cad.onshape.com/help/Content/Sketch/ellipse.htm), and
[Elliptical Arc](https://cad.onshape.com/help/Content/Sketch/elliptical_arc.htm)
documentation.

| Family | Current parity | Remaining production gap |
|---|---|---|
| Line | Line and center-origin Midpoint Line in one remembered split family | Infinite construction line and richer wake-up inference |
| Rectangle | Corner, Center, Aligned, and Centered Aligned variants | Selection-driven conversion and numeric placement |
| Circle and ellipse | Center-point and Three-point Circle plus exact Center-point Ellipse with primary- and secondary-axis diameter dimensions and analytical line-bounded Trim/Split | Tangent circle and round/ellipse modification boundaries |
| Polygon | Inscribed and Circumscribed variants; center, radius/apothem, pointer or typed side count; 3–50 sides | Numeric radius entry and side-count editing after creation |
| Arc | Elliptical, Three-point, Tangent, and Center-point variants | Fillet and selection-driven arc repair |
| Slot | Straight, Centered, and selected-line variants | Analytical arc/curve-chain selection |
| Modify | Delete, direct point manipulation, line/arc/circle/ellipse/elliptical-arc Trim and Split, open line/arc/elliptical-arc Extend, point/line/arc/circle/ellipse Mirror and Transform, signed connected-line Offset, one/two-direction Linear Pattern, and center-based closed/open Circular Pattern | Ellipse-to-round and ellipse-to-ellipse boundaries, drag-through Trim, free-end Extend, round-curve Offset, spline modification, draggable circular-pattern center, and associative pattern editing |
| Curves | Analytical lines, circles, circular arcs, full ellipses, and elliptical arcs | Spline, other conics, and projected/external geometry |

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
| Primary axis diameter | Exactly one ellipse/elliptical arc | Length | Implemented |
| Secondary axis diameter | Exactly one ellipse/elliptical arc | Length | Implemented |

Dimensions accept an explicit unit, a bare value in the active project display unit, or a committed
`#variable` expression. Authored text is preserved while solving uses canonical millimeters and
radians. Length dimensions MUST be positive; angle inputs MUST resolve to an angle.

Reference/driven dimensions, arc length, point coordinates, and construction measurements remain
follow-up work. They require an explicit reference-versus-driving model and MUST NOT be simulated by
adding solver constraints.

## Interaction contract

1. The viewport is selection-first. `D` activates the persistent Dimension tool from the same
   registered command used by the toolbar and command palette. The tool accepts one line or round
   curve, or collects two points or two lines through sequential clicks without a modifier. A
   compatible selection focuses the exact driving-value field. The compact icon-only precision
   toolbar remains available from ordinary Select mode for selection-first constraint work.
2. Every icon has a localized accessible name and tooltip. Standard technical glyphs are preferred
   over repeated icon-and-text controls in the canvas.
3. The task panel provides the keyboard-accessible equivalent, the focused variable-aware dimension
   expression form, the applied-constraint list, conflict state, and removal controls.
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
   reduced to the latest sample per animation frame before sketch-coordinate conversion, inference,
   and viewport-local React state. Drag start MUST snapshot the viewport rectangle once; subsequent
   drag frames MUST NOT force layout. Below the bounded interactive-complexity limit, continuous
   movement replaces and postpones the scheduled exact solver target until a brief pointer pause.
   Denser drafts retain the last exact base and solve only after pointer release. Neither path
   publishes through the parent workspace on every frame. The scheduler sends the original
   schema-valid sketch plus the latest separate drag
   target, permits one request in flight, and retains only the newest pending target. Release keeps
   the final overlay visible until the exact result settles. No drag-frame path may clone or
   schema-parse the complete sketch.
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
12. Trim, Extend, and Split are direct curve actions rather than selection-list commands. The curve
    under the pointer is the target, the canvas uses a crosshair cursor, and one successful
    operation produces one schema-valid draft and one local undo entry. Lines and arcs split with
    one projected point; a closed circle requests two points and previews both complementary arcs
    before commit. The retained curve keeps the original identity, including when Trim converts a
    circle into an arc. A detached endpoint and constraints that depend only on it are removed; a
    point still shared by other geometry and its constraints remain. Unsupported or degenerate
    actions and operations without a valid bounded result do not mutate the draft.
13. Mirror supports both standard CAD selection orders. With selected source geometry, activating
    Mirror and selecting a line reflects the complete selection as one local history edit and
    returns to Select. With no preselection, activating Mirror requests the axis first, highlights
    it, then reflects each subsequently selected point or curve while the tool remains active;
    `Escape` finishes that sequence. Shared source points produce one shared mirrored point, points
    on the axis retain their identity, off-axis point pairs receive Symmetric intent, and mirrored
    round geometry retains equal-radius intent without redundant solver equations. Invalid axes,
    missing sources, and attempts to mirror the axis itself leave the draft unchanged.
14. Transform supports preselection and post-selection of points, lines, arcs, circles, and ellipses. A
    center manipulator exposes free translation, sketch-X and sketch-Y translation, rotation, and
    positive uniform scale. The overlay transforms only selected presentation geometry while the
    pointer moves; it does not clone, schema-parse, solve, or publish the complete sketch on a drag
    frame. `Shift` snaps rotation to 15-degree increments and scale to tenths. `Enter` or a primary
    click on empty canvas applies the current transform as one schema-validated draft and one local
    undo entry; `Escape` cancels without mutating the draft. Internal transform-invariant
    constraints remain. Exact quarter turns swap Horizontal and Vertical intent, while fixed,
    directed, scaled dimensional, and selection-boundary-crossing constraints are removed when
    retaining them would block or misstate the transformed result. With canvas focus, arrow keys
    move by 1 mm, `Shift` plus an arrow moves by 10 mm, brackets rotate by 15 degrees, and minus or
    equals changes uniform scale by one tenth, providing a keyboard path without pointer handles.

## View orientation

The modeling viewport keeps an always-visible camera-relative world-axis inset. X is red, Y is
green, and Z is blue in both themes. Orbiting updates the inset without reinitializing the viewport
or fitting the model. The unit/orientation badge says `XYZ`; sketch mode separately identifies its
active support plane and display unit.

## Follow-up sequence

1. Add remembered wake-up references, point-to-point horizontal/vertical alignment, arc midpoint and
   quadrant candidates, and projected/external geometry inference.
2. Extend Slot from a single selected line to analytical arcs and validated curve chains, then add
   splines through exact analytical or solver-backed entities.
3. Add numeric point placement and coordinate editing, plus variable-aware Transform values and a
   relocatable manipulator origin.
4. Add reference dimensions and a driving/reference conversion command.
5. Extend ellipse Trim and Extend from bounded line intersections to round and ellipse boundaries,
   then add future spline entities, drag-through Trim, and explicit free-end Extend behavior.
6. Add guided over-constraint repair that presents a bounded conflicting set without automatic
   deletion.
