# Canvas-first sketch experience

## Purpose

This document defines the interaction model required to make VibeShape's sketcher feel like a spatial CAD tool instead of a collection of forms. It is based on an official-documentation review of Onshape's browser sketch workflow performed on 2026-08-25.

VibeShape adopts the interaction principles, not Onshape's branding, visual styling, cloud architecture, or undocumented behavior. The normative product and accessibility rules remain in [Design and UX Guidelines](design-and-ux-guidelines.md).

## Research conclusion

Onshape's sketch experience is effective because the graphics area owns the complete primary loop:

```text
Choose a tool -> point at geometry -> see a candidate -> click to accept intent
    -> place the annotation or result -> type an exact value in place -> continue drawing
```

The side dialog confirms sketch-level state and exposes secondary diagnostics. It does not make the user repeatedly translate a spatial selection into a remote form.

Before SKX-1, VibeShape implemented many of the necessary domain operations, but several primary loops left the viewport at their most important moment. Dimension collected entities on the drawing and then moved focus to `#sketch-dimension-expression` in the task panel. The first SKX-1 slice removed that DOM focus bridge: Dimension now collects geometry, previews witness leaders at the pointer, places an anchored variable-aware editor, preserves the clicked annotation location, supports staged `Escape`, edits an existing value by double-click, and moves a label as presentation-only state without solving or rebuilding. The task-panel field remains the accessible fallback. Reference dimensions and durable cross-session label-layout metadata remain follow-up work.

## Observed Onshape interaction model

### One contextual sketch environment

- Creating or editing a sketch replaces unrelated feature tools with the sketch toolbar.
- Tool families use a compact dropdown. The family's primary icon remembers the most recently used member.
- `S` opens a customizable shortcut toolbar near the active graphics area.
- A saved sketch is a parametric feature in the feature list and reopens directly for editing.
- Extrude and Revolve are available from the sketch toolbar. Starting one accepts the current sketch, opens the feature command, and selects usable sketch regions automatically.

The important property is continuity: the viewport, model context, feature list, and active sketch remain one environment while the command surface changes around them.

### Geometry is authored under the pointer

- Geometry tools preview the unfinished result at the pointer.
- Repeating tools stay active when repetition is useful. Line continues as a connected chain.
- Some tools switch temporarily into a related tool. A line endpoint can continue as a tangent arc, then return to Line.
- Creation can be click-click or press-drag-release when the tool supports it.
- Immediately after geometry creation, supported tools show suggested dimensions in small input boxes. Typing creates exact dimensions without switching to the Dimension command.
- Multi-value tools let the user move among their transient inputs from the keyboard.

The exact value is therefore part of placement, not a later cleanup form.

### Inference is visible before it becomes intent

- Moving near a point or edge can "wake up" it as a reference candidate.
- Horizontal, vertical, coincident, midpoint, parallel, and similar candidates appear beside the pointer while drawing.
- Related source geometry highlights while an inference is active.
- The accepted relationship becomes a persistent constraint.
- Holding `Shift` suppresses automatic inference for the current placement.
- Coplanar points and edges from earlier sketches or features can participate without first being selected from a list.

This creates a predictable two-stage contract: show the candidate, then commit it with the placement click.

### Dimensions are drawing annotations

The Dimension command is a spatial sequence:

1. Activate Dimension or press `D`.
2. Select one or more compatible entities in the graphics area.
3. Move the pointer to choose dimension type, side, quadrant, and label location.
4. Click to place the annotation and open a compact numeric field at that location.
5. Type a value, expression, or variable and press `Enter`.

Pointer position disambiguates important cases. Moving horizontally or vertically produces a projected distance; moving diagonally produces a direct distance. Moving an angular dimension chooses its quadrant. Crossing a construction centerline changes a distance into a centerline dimension.

Placed dimensions remain interactive:

- drag the annotation to reorganize the drawing;
- double-click the value to edit it in place;
- delete it directly from the drawing;
- switch between driving and driven/reference behavior;
- display authored expressions when needed;
- use geometry-to-plane dimensions without moving the plane.

The visual annotation is the primary object. A list or inspector is a secondary representation of the same stable constraint identity.

### Constraints are attached to geometry

- Constraints can be applied tool-first or selection-first.
- Hovering a sketch entity reveals only its relevant constraints; holding `Shift` can keep all constraints visible while moving the pointer.
- Hovering a constraint highlights the geometry it relates to.
- Constraint glyphs can be dragged away from overlaps, selected, and deleted directly.
- Under-constrained, fully constrained, and conflicting geometry use distinct visual states.
- Dragging under-constrained geometry is an ordinary diagnostic technique for discovering remaining degrees of freedom.
- The Constraint manager is a filtered diagnostic surface for complex sketches. It is not the primary creation workflow.

### External geometry is selected visually

- Use projects an earlier sketch edge, part edge, or trackable silhouette onto the active sketch plane.
- Hover shows the projected result before selection.
- The projected entity updates with its source and carries visibly external constraint styling.
- Existing coplanar geometry can also wake up for inferred constraints without being permanently projected first.
- Cross-plane attachment uses explicit operations such as Pierce or Intersection rather than silently flattening arbitrary geometry.

This distinction matters for VibeShape: temporary wake-up references, persistent projected geometry, and cross-plane intersection are different semantic operations and need different visual states.

### Direct modification stays direct

- Trim removes the segment under the pointer; dragging through multiple segments applies Trim repeatedly.
- Mirror supports both selection-first and tool-first workflows. The canvas prompt changes from mirror line to source entities, and results appear as entities are selected.
- Transform exposes a manipulator on the selected geometry and commits from the graphics area.

These commands require a form only for optional exact refinement. Pointer target, preview, and commit remain visible together.

## VibeShape gap analysis

| Area | Current behavior | Required behavior |
|---|---|---|
| Dimension creation | Canvas selection focuses a remote task-panel form | Canvas selection enters annotation placement, then opens an anchored inline expression editor |
| Dimension editing | Clicking a label selects it and exposes the panel editor | Double-click edits at the label; drag moves the annotation; the panel remains an accessible fallback |
| Dimension meaning | Kind is chosen mainly from a select field | Pointer direction, selected entity types, and placement side determine the default kind; a compact menu resolves genuine ambiguity |
| Geometry precision | Exact values are generally added after creation | Supported tools show transient length, radius, angle, width, and count input immediately after placement |
| Inference | Several candidates are implemented, but the system is not yet a consistent cursor language | Every candidate has source highlight, guide, glyph, accepted state, and `Shift` suppression |
| Constraints | Compatible actions appear in a compact toolbar and a panel list | Selection-driven mini-toolbar stays near the selection; glyphs own hover, edit, move, and delete; the list becomes diagnostics |
| External references | Use candidates exist in 2D/3D, with panel duplication | Default flow is hover-preview-click in the viewport; panels show provenance, broken references, and repair only |
| Trim | Click targeting works | Add preselection preview and drag-through trimming while keeping one undo boundary per gesture |
| Mirror | Both selection orders exist | Replace generic status copy with cursor-local prompts and immediate mirrored preview |
| Sketch completion | Persistent footer exposes Finish/Cancel/Extrude | Keep a compact stable confirmation surface, but allow valid Extrude/Revolve to continue directly from selected regions |
| Diagnostics | Solver and constraint lists are persistent panel content | Keep compact solver status always visible; open the full manager only for filtering, conflicts, and repair |

## Target visual grammar

Every sketch command MUST express the following states in the viewport:

| State | Required visual response |
|---|---|
| Idle tool | Active tool cursor and concise status-bar instruction |
| Hover candidate | Exact target preselection plus entity type |
| Inference candidate | Guide line or marker, relationship glyph, and source highlight |
| Collected selection | Stable selected styling and the next required target near the pointer |
| Preview | Analytical result distinct from committed geometry |
| Placement | Movable annotation, manipulator, or result under the pointer |
| Inline input | Small anchored editor with unit/expression support and validation |
| Valid commit | Immediate local draft result and one sketch-local undo checkpoint |
| Invalid commit | Preserve preview and input; mark the exact conflicting geometry or value |
| Escape | Cancel only the most recent visible stage |

Generic top-center instruction cards SHOULD be replaced by cursor-local or selection-local guidance when the instruction concerns a spatial target. The status bar provides the persistent accessible equivalent.

## Canvas-first command contracts

### Dimension

```text
Idle -> Collecting references -> Placing annotation -> Editing value -> Committed
          | Escape                 | Escape             | invalid
          v                        v                    v
        Select                 Collecting          Editing value
```

- A compatible final selection creates a transient `DimensionPlacement`, not a constraint.
- Pointer movement resolves candidate kind, witness geometry, side/quadrant, and label anchor.
- The placement click opens an anchored expression editor without moving pointer context to the task panel.
- `Enter` validates and appends one stable constraint. `Escape` first closes the editor and returns to placement; a second `Escape` clears the collected references; a third exits Dimension.
- Bare numbers use the active project unit. `#` opens variable suggestions inside the anchored editor.
- Double-clicking an existing annotation opens the same editor over the same stable constraint.
- Dragging an existing annotation changes presentation metadata only and creates no geometry rebuild or document revision.
- The task-panel list exposes the same field for keyboard and assistive-technology access, but never steals focus from a pointer-driven placement.

### Geometry with immediate precision

- The final placement click keeps the new geometry provisional for one short precision stage.
- A compact HUD presents only values meaningful for that tool: line length/angle, circle radius/diameter, rectangle width/height, slot length/width, polygon radius/count, or arc radius/angle.
- Typing immediately routes to the primary field; pointer movement may continue without accepting a value.
- `Tab` or `Alt` plus arrow moves between multiple values; `Enter` accepts the active exact values; `Escape` leaves valid geometry undimensioned and returns to drawing.
- Line-chain continuation begins after this precision stage and retains the previous endpoint.

### Automatic inference

- Candidate generation remains deterministic and screen-tolerance based.
- Hovering a source may add it to a short-lived wake-up set for the current gesture. Wake-up state is viewport-local and never persisted.
- Accepting placement persists only the selected relationship, using stable semantic IDs.
- Source highlights and glyphs disappear when the candidate is no longer eligible.
- `Shift` disables candidates without disabling ordinary point placement.

### Constraints

- Selection-first is the default discovery path: compatible constraint icons appear in a compact toolbar adjacent to the selection bounds.
- Tool-first remains available from the command toolbar, palette, shortcuts, and `S` shortcut surface.
- Applying a constraint animates no geometry fiction: the exact solver result replaces the preview, and conflicts remain marked.
- Constraint glyphs support hover-related highlighting, click selection, drag layout, Delete, and a context menu.
- Glyph layout is presentation metadata keyed by stable constraint ID. It is not solver input.

### Use and external references

- Activating Use makes eligible earlier edges and sketch entities preselectable in the persistent 3D context and normal sketch view.
- Hover renders the projected analytical preview on the active support plane.
- Click creates one persistent external reference and projected entity.
- A model-backed reference row exposes an icon-only Replace action. Replace re-enters graphical Use selection, restricts candidates to a compatible subshape from the same producing feature, preserves the reference and projected-entity identities, and returns to Select after one pick.
- Canceling Replace keeps the existing association unchanged. Repair never silently chooses a candidate or exposes renderer and topology internals as user-facing labels.
- Ordinary inference may wake compatible coplanar source geometry without creating a projected entity.
- Source provenance, update failure, and repair belong in the task panel and model tree.

## Role of the task panel

The sketch task panel remains useful, but its responsibility narrows to:

- sketch support identity and reference provenance;
- complete accessible selection and numeric-edit equivalents;
- solver status, conflict filtering, and repair;
- searchable applied-constraint and dimension inventory;
- profile inventory when regions overlap or are inaccessible;
- advanced transform and pattern parameters that cannot be placed clearly on the canvas;
- stable Finish, Cancel, and feature-transition actions.

It MUST NOT be the required next focus after a normal pointer selection, dimension placement, constraint application, external-reference pick, or common geometry creation.

## Architecture and state ownership

- `packages/domain` owns pure dimension/constraint definitions, compatibility, validation, and atomic sketch edits.
- The geometry worker owns exact solving and returns stable-ID results and failures.
- The editor-session Zustand store owns active tool stage, collected references, active inline editor identity, selected annotations, wake-up candidates, and presentation-only label offsets.
- Pointer-rate preview positions remain component-local or in a dedicated viewport interaction controller; they MUST NOT publish the entire sketch into the global store per frame.
- TanStack Form may power the anchored numeric editor and accessible panel adapter, but it does not own selection or command state.
- The task panel and canvas consume the same command state and stable constraint identities. They do not synchronize by querying DOM element IDs.
- Product copy, accessible names, validation, and status messages remain in typed ICU catalogs.

The first structural correction removed `document.getElementById("sketch-dimension-expression")?.focus()` as the bridge between the viewport and panel. Typed sketch interaction state now carries dimension placement and the editor request; selection-first Dimension activation uses the same registered editor tool instead of querying a panel element.

## Delivery plan

### SKX-1 — spatial dimension placement

- Add transient dimension-placement state and analytical witness/leader previews.
- Infer default dimension kind from entity types and pointer placement.
- Open a variable-aware inline expression editor at the placed label.
- Support `Enter`, staged `Escape`, delete, double-click edit, and draggable label offsets.
- Keep an accessible task-panel adapter without automatic focus transfer.

Exit criterion: a user creates and edits line length, point distance, projected distance, angle, radius, and diameter dimensions without looking away from the drawing.

### SKX-2 — creation-time numeric HUD

- Add immediate numeric entry to Line, rectangle families, circle families, arc families, slot families, ellipse, and polygon.
- Preserve continuous Line and tangent-arc continuation.
- Share variable suggestions, unit normalization, validation, and expression parsing with existing fields.

Exit criterion: the reference bracket's primary outline can be drawn to exact size without activating Dimension after every entity.

### SKX-3 — inference and constraint language

- Standardize cursor glyphs, guide lines, source highlights, accepted-state feedback, and suppression across every implemented inference.
- Add remembered wake-up references for coplanar earlier sketch and feature geometry.
- Move selection-driven constraint actions next to the selection and make glyphs draggable and directly deletable.
- Add focused related-entity highlighting on glyph hover.

Exit criterion: users can predict which relation will be created before clicking and can inspect it without opening the constraint list.

### SKX-4 — visual external geometry

- Keep Use fully hover-preview-click in normal and orbit context. Overlapping normal-view sources use a
  compact pointer chooser. Overlapping orbit-view sources expose the viewer's closest-first hit stack through
  Select Other: grave accent cycles forward, Shift+grave accent cycles backward, Enter or pointer activation
  commits, and Escape dismisses without changing the draft.
- Separate wake-up inference, persistent Use projection, Intersection, and Pierce in state and rendering.
- Add broken-reference and provenance inspection in the task panel.

Exit criterion: a new sketch can be positioned from earlier sketches, extrusion faces, and model edges through visual selection rather than candidate lists.

### SKX-5 — direct modification polish

- Add drag-through Trim with preselection preview.
- Add cursor-local Mirror, Offset, Pattern, and Transform prompts.
- Keep exact optional values in anchored HUDs or compact manipulators.
- Apply one sketch-local undo checkpoint per completed gesture.

Exit criterion: Trim, Mirror, Offset, Transform, and patterns complete their normal path without a mandatory remote form.

### SKX-6 — sketch-to-feature continuity

- Promote Extrude and Revolve from an open valid sketch.
- Finish through the same validated persistence path and automatically carry selected valid regions into the feature preview.
- Keep sketch geometry visible as contextual reference while editing downstream features.

Exit criterion: sketching and creating the first solid feel like one continuous modeling operation.

## Verification strategy

Each slice requires:

- pure state-machine tests for click, pointer move, `Enter`, staged `Escape`, and invalid input;
- domain invariant tests for every new or edited constraint definition;
- component tests for anchored editor focus, variable completion, and keyboard alternatives;
- browser tests at 1440 × 900, 1024 × 720, and 200% zoom;
- dark and light visual evidence for hover, inference, placement, conflict, and selected states;
- a pointer task in which the user completes the flow without opening the task-panel editor;
- an equivalent keyboard-accessible task-panel flow;
- performance evidence that pointer motion does not publish full-sketch global state or queue solves.

## Usability acceptance tasks

The canvas-first work is not complete until representative users can perform these tasks without external instructions:

1. Draw a rectangle, enter exact width and height during creation, and understand which constraints were inferred.
2. Add a hole concentric with earlier model geometry by waking or projecting that reference visually.
3. Place a line-length dimension, move its label, edit it by double-clicking, and change it to `#wall`.
4. Add horizontal and tangent constraints from selection and identify the related entities from glyph hover.
5. Drag under-constrained geometry and identify the remaining degree of freedom.
6. Trim several segments in one gesture, mirror the result, and undo each gesture once.
7. Start Extrude from the open sketch and receive the intended region automatically.
8. Diagnose and remove one conflicting constraint using the canvas before opening the manager.

Record completion time, wrong turns, panel visits, command cancellations, assistance, and confidence. The primary success metric is not visual similarity to Onshape; it is whether spatial work remains spatial and exact values remain immediate.

## Official references

- [Onshape Sketch Basics](https://cad.onshape.com/help/Content/Sketch/sketch_basics.htm)
- [Onshape Sketch Tools](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm)
- [Onshape Line](https://cad.onshape.com/help/Content/Sketch/line.htm)
- [Onshape Dimension](https://cad.onshape.com/help/Content/Sketch/dimension.htm)
- [Onshape Automatic Inferencing](https://cad.onshape.com/help/Content/Sketch/automatic_inferencing.htm)
- [Onshape Working with Constraints](https://cad.onshape.com/help/Content/Sketch/working_with_constraints.htm)
- [Onshape Use](https://cad.onshape.com/help/Content/Sketch/use.htm)
- [Onshape Trim](https://cad.onshape.com/help/Content/Sketch/trim.htm)
- [Onshape Sketch Mirror](https://cad.onshape.com/help/Content/Sketch/sketch_mirror.htm)
