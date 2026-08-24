# Editor experience implementation plan

## Purpose

This plan turns the product-level rules in [Design and UX Guidelines](design-and-ux-guidelines.md) into an executable sequence for the authoring shell. It addresses the gap between a technically functional CAD flow and an interface that is predictable, compact, and fast enough for repeated modeling work.

VibeShape adopts proven interaction principles from established CAD systems without copying their visual identity, source code, cloud architecture, or every historical convention.

## Evidence and adopted patterns

| Source product | Pattern to adopt | VibeShape interpretation |
|---|---|---|
| Onshape | A stable graphics area, feature list, contextual toolbars, explicit feature dialogs, and a sketch toolbar that replaces unrelated feature tools while sketching | Keep the viewport and model tree stable; switch only the command surface and task content for the active mode |
| Autodesk Fusion | Contextual Sketch tab, persistent Browser, explicit Finish Sketch action, canvas selection, and chronological parametric history | Treat Sketch as a bounded command environment with a visible exit and one semantic commit |
| Shapr3D | Selection-driven adaptive tools and history filtered to the current selection | Promote valid next actions for the current selection; keep the complete command set searchable instead of showing every disabled action |
| FreeCAD Sketcher | Visible degrees of freedom, automatic-constraint candidates, and distinct snapping versus constraint creation | Show solver state continuously and never imply that a visual snap created design intent unless a constraint is accepted |
| SolveSpace | Direct constraint glyphs, editable dimension labels, reference dimensions, and bounded conflict suggestions | Put dimensions and constraints on the sketch canvas while retaining an accessible list and explicit conflict recovery |

Primary references are recorded in [Research and Primary Sources](../research-sources.md#cad-editor-interaction-models).

## Current-state problems

The 2026-08-15 browser review at 1440 × 900 identified these concrete problems:

- the active sketch kept model-only Box, Cylinder, and Subtract commands in the primary toolbar;
- geometry tools, undo/redo, construction mode, plane selection, every constraint, constraint history, and Finish/Cancel competed inside one narrow task panel;
- incompatible constraints remained visible as a dense disabled-button wall instead of explaining or adapting to the selection;
- an unimplemented Print control looked actionable;
- an empty sketch was reported as fully constrained with zero degrees of freedom;
- the sketch task had no persistent title or explanation of the active mode;
- Finish and Cancel could scroll away with long constraint content;
- workspace switching could discard an active command buffer without first finishing or canceling it;
- the shell had no command palette, complete shortcut layer, responsive task-panel sheet, or saved panel-size preferences before UX-2 started.

## Target interaction model

### Stable shell

The shell keeps five stable regions during authoring:

1. **Application bar** — product identity, project name, local-save state, project management, export, undo/redo when document history exists, and global commands.
2. **Contextual command toolbar** — only commands that make sense for the current workspace or active command.
3. **Model tree** — origin references, sketches, ordered features, bodies, visibility, failures, and the current history position.
4. **Viewport** — geometry, preselection, selection, manipulators, dimensions, constraints, previews, and compact transient status.
5. **Task panel and status bar** — active-command inputs and persistent Apply/Cancel on the right; units, filters, selection, solver, and rebuild state at the bottom.

The viewport remains the largest region. Opening a task changes task content, not the position of global actions or the model tree.

### Contextual command toolbar

| Context | Primary groups |
|---|---|
| Model, no active command | Sketch and feature creation; valid selection-driven follow-up commands; view controls |
| Active sketch | Select; create geometry; modify geometry; construction mode; constraints; local undo/redo |
| Selected saved sketch/profile | Edit sketch, Extrude, Revolve, visibility, and inspection |
| Active feature command | Selection requirements and lightweight manipulators; parameter editing remains in the task panel |
| Print workspace | Orient, arrange, print checks, export, and remembered slicer handoff |

The toolbar uses one tab stop with arrow-key navigation. It may overflow into labeled groups, but it never silently drops the active tool, Cancel, or a required next action.

### Selection-driven actions

The same command registry supplies toolbar, command palette, context menu, shortcuts, extension contributions, and future MCP descriptions. Eligibility returns both an enabled state and a reason.

- No selection exposes creation commands.
- A sketch profile promotes Extrude and Revolve.
- One face promotes sketch-on-face and face-specific inspection.
- Compatible sketch entities promote only the constraints and dimensions that can be created from that selection.
- Incompatible commands remain discoverable in search with their unmet requirement; they do not occupy the primary panel as a disabled wall.
- A rejected viewport click keeps the command active and explains the required entity type non-modally.

### Sketch lifecycle

```text
Select support -> Enter Sketch mode -> Draw and constrain -> Finish -> Select region -> Create feature
       |                 |                    |               |
       +---- Cancel -----+---- local undo ----+---- edit -----+
```

- Creating a sketch starts with a selected plane or a clear plane-selection request.
- The camera moves normal to the plane only after a valid support exists.
- Geometry tools live in the contextual toolbar; the task panel owns support, constraint details, dimensions, conflicts, and Finish/Cancel.
- `Escape` cancels an in-progress placement first, then the active tool, then the sketch command, then selection.
- A tool shortcut never fires while focus is in an input, textarea, editable element, or IME composition.
- Snapping is a geometric aid. An inferred relation becomes persistent only when the corresponding constraint is accepted.
- Finish creates one asynchronous, single-flight semantic command. Cancel leaves the committed document unchanged.
- Starting Extrude or Revolve from a valid open sketch may finish the sketch only through the same validated commit path; it never bypasses persistence or error handling.

### History and tree behavior

- Tree, viewport, and task-panel selection stay synchronized by stable semantic identity.
- Single activation selects; `Enter`, explicit Edit, or double activation opens the feature when double activation can be made accessible and unambiguous.
- The tree shows origin planes as selectable datum nodes and separates sketches, ordered features, and result bodies.
- Selecting geometry filters or highlights related history without deleting unrelated rows.
- Rollback, suppression, visibility, and failure are separate states.
- Reordering remains unavailable until dependency validation can explain legal and illegal destinations.

### Feature command behavior

Every feature uses `Idle -> Selecting -> Preview -> Validating -> Committed`.

- Selection fields name the required type and accept viewport or tree input.
- Parameter edits update an unsaved preview without changing document history.
- Apply validates the exact visible values and creates one command.
- Failure preserves values and selection and offers a relevant recovery action.
- Cancel restores the pre-command selection when it still exists.
- Editing an early feature shows downstream geometry as rolled-forward preview or clearly identifies temporarily unavailable dependents; it never presents stale geometry as current.

### Responsive behavior

- At 1440 px, model tree and task panel are both visible and resizable.
- At 1024 px, the viewport remains usable; low-frequency toolbar groups move to overflow before panels disappear.
- Below the authoring minimum or at 200% zoom, the task panel becomes a labeled sheet and the tree becomes a separate labeled sheet.
- The active command, Apply, Cancel, errors, save state, selection filter, and solver state remain reachable.
- Touch-only authoring is a separate later interaction mode, not a scaled desktop layout.

## Delivery sequence

### UX-1 — contextual command surface

Status: initial slice implemented.

- Replace the passive toolbar with the Radix toolbar roving-focus contract.
- Show sketch geometry tools only while a sketch is active.
- Move construction and local sketch undo/redo to the sketch toolbar.
- Remove controls for unimplemented workspaces.
- Keep active-command workspace switching locked until Finish or Cancel.
- Add a persistent sketch task header and footer.
- Replace incompatible constraint walls with selection-driven compatible actions.
- Correct empty-sketch solver copy.

Exit criterion: the user can identify the active mode, select every implemented geometry tool from the top command surface, and finish or cancel without searching or scrolling.

The initial slice meets this criterion at 1440 px and keeps the page bounded at 1024 px. Grouped command overflow and responsive panel sheets remain part of UX-7.

### UX-2 — command registry, palette, shortcuts, and cancellation

Status: initial registry and palette slice implemented.

- Register every first-party action once with ID, label, group, icon, shortcut, eligibility reason, and invocation.
- Implement `Ctrl/Cmd+K`, searchable disabled reasons, recent local ranking, and extension contribution ownership.
- Implement the documented `Escape`, `Enter`, delete, undo/redo, fit, and safe single-letter sketch shortcuts.
- Preserve focus and selection across command start, completion, cancellation, and failure.

The initial slice composes serializable, owner-attributed descriptors with trusted handlers and fails closed on duplicate, missing, orphaned, or owner-mismatched registrations. The same resolved catalog now drives the contextual toolbar, the localized command palette, and safe sketch-tool, sketch-history, cancellation, and palette shortcuts. Disabled commands remain searchable with their current eligibility reason, recent successful choices rank locally, `Ctrl/Cmd+K` remains available from text fields, single-letter tools do not capture text or IME input, and `Escape` participates in the placement-first cancellation hierarchy. Component and cross-browser tests cover registry composition, keyword search, disabled reasons, focus restoration, palette invocation, and shortcut dispatch.

Context-menu projection, extension-provided presentation descriptors, `Enter`, delete, fit, view shortcuts, committed document undo/redo, and complete selection restoration remain open. The UI presentation registry is not itself an automation or MCP contract; future external exposure must map to the versioned domain command descriptors and host policy described in the automation architecture.

Exit criterion: toolbar, palette, shortcut, and context menu invoke the same command and eligibility logic.

### UX-3 — model tree and selection synchronization

- Add collapsible Origin, Sketches, Features, and Bodies nodes with meaningful icons and counts.
- Add keyboard tree navigation, visibility controls, rename, selection synchronization, and diagnostic ownership.
- Add viewport selection filters and candidate cycling for occluded entities.
- Add selection-related history filtering without hiding the full history permanently.

Exit criterion: a user can locate, select, edit, hide, and diagnose any authored item without relying on the canvas alone.

### UX-4 — production sketch interaction

- Existing-point, segment-midpoint, bounded segment-intersection, point-on-line, horizontal, vertical, parallel, perpendicular, and endpoint-tangent candidates now provide inference guides and accepted persistent constraints. Remembered wake-up references, point-to-point alignment, arc midpoint/quadrant candidates, and projected geometry remain open.
- The [mandatory sketch precision toolset](sketch-toolset.md) is implemented for geometry, 13 geometric constraints, and eight driving dimensions. The registered Dimension command is available from the toolbar, palette, and `D`; it collects compatible canvas selections without a modifier and focuses the variable-aware exact-value field. Selection-driven icon tools still use the complete selection, applied canvas glyphs are selectable, and a selected dimension label opens the accessible expression editor.
- Add reference dimensions, numeric placement, and coordinate editing without converting reference measurements into solver constraints.
- Center Rectangle, Aligned Rectangle, Centered Aligned Rectangle, Midpoint Line, Three-point Circle, Center-point Ellipse, Elliptical Arc, both 3–50-side regular Polygon variants, Three-point Arc, and Tangent Arc are implemented with exact previews, persistent intent, one-step local history, and grouped toolbar/palette presentation. Center-point Ellipse uses three stable points, one solver-internal perpendicular axis equation, exact profile geometry, and exact OCCT extrusion. Elliptical Arc follows the center → primary axis → secondary radius/start → endpoint workflow, previews a temporary construction ellipse, and constrains both visible endpoints to the analytical ellipse through solver-owned trammels. Click-targeted Trim and Split support lines, circular arcs, circles, full ellipses, and elliptical arcs; Extend supports open lines, circular arcs, and elliptical arcs. Ellipse operations currently use exact bounded line intersections. Linear and center-based Circular Pattern provide bounded variable-aware previews and materialize one undoable set of analytical copies. These exact domain operations preserve retained identity, repair detached endpoint dependencies, preview the two-point closed-circle split, and create one local history edit. Primary- and secondary-axis diameter dimensions are implemented for both ellipse entity types. Round and ellipse boundaries for ellipse modification, spline authoring, associative patterns, direct circular-pattern center dragging, drag-through Trim, free-end Extend, and guided conflict repair remain open.

Exit criterion: the reference bracket can be drawn, fully constrained, diagnosed, edited, and reopened without using the constraint list as the primary spatial interface.

### UX-5 — feature previews and history repair

- Exact unsaved Extrude preview is implemented; multi-profile selection remains open.
- Add, Remove, and Intersect operation intent is implemented; Revolve and Hole remain open.
- Add manipulators paired with exact task-panel fields.
- Add rollback/edit context and stable-reference repair UI for missing or ambiguous downstream inputs.

Exit criterion: early-parameter editing and topology ambiguity remain understandable and recoverable through the normal task workflow.

### UX-6 — print workspace

- Add build-volume context, orientation, placement, Print Check, persistent report, and configurable 3MF quality profiles.
- Keep project export, print export, slicer handoff, slicing, and printing as distinct states.
- Promote the remembered slicer action only after a valid rebuilt solid and report state exist.

Exit criterion: a maker can inspect print risks, export 3MF, and understand whether a slicer was opened or a file was downloaded.

### UX-7 — responsive, accessibility, themes, and usability evidence

- Add resizable panels, persisted UI-local sizes, keyboard reset/collapse, and narrow-screen sheets.
- Verify dark and light themes, 1440 px, 1024 px, 200% zoom, reduced motion, long English copy, and target spacing.
- Run the representative maker tasks from the design guidelines and record wrong turns, time, assistance, and confidence.

Exit criterion: automated and manual evidence meets the UI definition of done rather than only producing plausible screenshots.

## Acceptance journey

The editor plan is complete only when a new user can perform this sequence without external documentation:

1. Create a project and understand that it is saved in this browser.
2. Select XY, XZ, YZ, or a valid planar support and enter an unmistakable Sketch mode.
3. Draw the reference bracket profile using inference and dimensions.
4. Diagnose and repair one intentional over-constraint.
5. Finish the sketch and create a variable-driven Extrude.
6. Edit an early dimension and understand which downstream feature is rebuilding or broken.
7. Run Print Check, export a `.vshape` backup, and open or download the 3MF for a remembered slicer.
8. Reload offline and recover the same semantic design intent.

## Explicit non-goals

- Do not reproduce Onshape, Fusion, Shapr3D, FreeCAD, or SolveSpace visual styling.
- Do not expose controls for behavior that does not exist.
- Do not turn every feature into a modal dialog.
- Do not hide selection, solver, rebuild, storage, or automation state behind hover-only UI.
- Do not let adaptive recommendations become the only way to discover a command.
- Do not let direct manipulation bypass exact fields, validation, persistence, or one-command undo boundaries.
