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
| Point | Place a stable analytical point with inference | Implemented |
| Line | Place a stable segment with endpoint reuse and horizontal/vertical inference | Implemented |
| Midpoint Line | Place a segment symmetrically from its midpoint with persistent midpoint intent | Implemented |
| Corner Rectangle | Author four lines as one local history edit | Implemented |
| Center Rectangle | Author symmetric geometry and construction diagonals as one local history edit | Implemented |
| Center-point Circle | Author a center and analytical radius | Implemented |
| Three-point Circle | Author an exact circle through three non-collinear points | Implemented |
| Center-point Arc | Author center, start, end, and positive sweep | Implemented |
| Three-point Arc | Author an exact circumcircle arc from three non-collinear points | Implemented |
| Construction | Mark reference geometry that participates in constraints but not profiles | Implemented |
| Local Undo/Redo | Reverse or restore one authored draft operation without a document revision | Implemented |

The command toolbar groups related variants like Onshape: Line and Midpoint Line; Corner and Center
Rectangle; Center-point and Three-point Circle; and Three-point and Center-point Arc. The family
button invokes the active or last-used variant, while its adjacent menu exposes every variant with
the standard shortcut when one exists. Center construction is a property of the geometry family,
not a requirement to duplicate every command with an artificial center mode.

Aligned Rectangle, Tangent Arc, Trim, Extend, Split, mirror/pattern authoring, ellipses, slots,
polygons, splines, and projected external geometry remain follow-up tools. They require new exact
domain and solver behavior and MUST NOT be simulated only in the toolbar.

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
   exactly one global draft and one undo checkpoint when the gesture ends.
9. Large constraint lists scroll inside the fixed-height task panel. They never increase the CAD
   workspace row height or move sketch geometry outside the visible viewport.

## View orientation

The modeling viewport keeps an always-visible camera-relative world-axis inset. X is red, Y is
green, and Z is blue in both themes. Orbiting updates the inset without reinitializing the viewport
or fitting the model. The unit/orientation badge says `XYZ`; sketch mode separately identifies its
active support plane and display unit.

## Follow-up sequence

1. Add Aligned Rectangle and Tangent Arc to complete the current Onshape-style core families.
2. Add midpoint, center, tangent, perpendicular, and intersection inference candidates with explicit
   acceptance rules.
3. Add ellipses, slots, polygons, and splines through exact analytical or solver-backed entities.
4. Add numeric point placement and coordinate editing.
5. Add reference dimensions and a driving/reference conversion command.
6. Add Trim, Extend, and Split with stable replacement identity and dependent-constraint repair.
7. Add guided over-constraint repair that presents a bounded conflicting set without automatic
   deletion.
