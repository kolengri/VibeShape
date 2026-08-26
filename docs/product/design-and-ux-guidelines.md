# Design and UX Guidelines

## Purpose

This document is the implementation contract for VibeShape's product design and interaction behavior. It governs the application shell, project library, modeling tools, sketcher, print workflow, empty states, errors, and accessibility.

The objective is not to make CAD look like a consumer dashboard. The objective is to make exact modeling **predictable, inspectable, reversible, and fast to operate** without hiding geometry failures or local-storage risks.

Normative terms follow the definitions in the [documentation overview](../README.md): **MUST**, **SHOULD**, and **MAY**.

## Product Experience Principles

1. **The model is the focus.** The viewport receives the largest area and the strongest visual hierarchy. Chrome recedes until it is needed.
2. **Design intent stays visible.** Features, references, dimensions, solver state, and rebuild failures are inspectable instead of being hidden behind direct manipulation.
3. **Preview before commit.** A modeling command shows its effect before it creates one atomic undo entry.
4. **Failure is explicit and recoverable.** VibeShape never silently repairs topology, discards parameters, or replaces geometry with a guessed result.
5. **One command, many entry points.** Toolbar, menu, context menu, command palette, and shortcut invoke the same application command and eligibility rules.
6. **Local state is described honestly.** "Saved in this browser" is distinct from "Exported as a file." Autosave is not presented as backup.
7. **Precision beats decoration.** Motion, color, icons, and spacing communicate state and hierarchy; they do not decorate empty space.
8. **Expert speed does not remove beginner clarity.** Frequent commands are compact and keyboard-friendly, while labels, previews, constraints, and diagnostics remain understandable.
9. **Accessibility is structural.** Keyboard behavior, focus, names, status announcements, zoom, and non-color cues are designed with the component, not added after it.
10. **Progressive disclosure protects the core workflow.** Default panels show the parameters needed to finish the current task; advanced controls remain discoverable without dominating the form.
11. **Spatial work stays spatial.** Geometry selection, inference, preview, dimension placement, constraint application, and direct modification complete in the viewport. Panels provide exact alternatives, diagnostics, and advanced parameters without interrupting the pointer workflow.

## Experience Targets

| Outcome | Product target |
|---|---|
| First useful result | A new user creates and exports the reference bracket in under 15 minutes without external documentation |
| Command predictability | Apply commits once; Cancel and `Escape` leave the document unchanged |
| Error recovery | Invalid operations preserve inputs and selections and provide at least one relevant next action |
| Keyboard coverage | The complete reference-bracket flow is possible without a pointer, except free-form sketch drawing |
| Local-first clarity | Users can tell whether work is only in browser storage or also exported as a file |
| Rebuild transparency | A failed or ambiguous downstream feature identifies its owner and affected dependents |
| Responsiveness | Pointer, keyboard, and camera input remain responsive while geometry work runs in the worker |
| Accessibility | Application chrome targets WCAG 2.2 AA and follows applicable ARIA Authoring Practices patterns |

These are acceptance targets, not marketing claims. They require task testing and automated coverage before release.

## Information Architecture

### Stable Application Regions

The desktop authoring shell has six persistent regions:

| Region | Responsibility | Must not contain |
|---|---|---|
| Application bar | Project identity, save/export state, undo/redo, global commands | Feature-specific parameter forms |
| Command toolbar | High-frequency creation, modeling, view, and analysis commands | Project settings or destructive project actions |
| Model tree | Ordered feature presentation, bodies, sketches, visibility, failure ownership | Arbitrary file navigation or log output |
| Viewport | Geometry, selections, sketching, dimensions, manipulators, transient previews | Long-form diagnostics or settings forms |
| Task panel | Active command parameters, properties, contextual help, diagnostics | Global navigation or the primary path for spatial selection and annotation placement |
| Status bar | Units, selection filter, solver/rebuild state, progress summary | Primary actions or critical errors that require a decision |

The active command may change the task panel and viewport overlays, but it MUST NOT move global project actions or silently replace the model tree.

### Primary Workspaces

VibeShape uses explicit workspaces rather than hidden modes:

- **Model** — feature creation, body operations, inspection, and measurements
- **Sketch** — sketch geometry, constraints, dimensions, and solver state
- **Print** — print orientation, build-volume context, checks, report, and export

Entering a workspace changes the visible tools and task-panel content. The application bar, project identity, save state, model tree, and escape behavior remain stable. Workspace changes MUST be announced visually and programmatically.

### Default Desktop Geometry

The target reference canvas is 1440 × 900 CSS px. The supported authoring minimum is 1024 × 720 CSS px.

| Element | Default | Allowed range |
|---|---:|---:|
| Application bar | 40 px | 40–44 px |
| Command toolbar | 36 px | 36–40 px |
| Status bar | 24 px | 24–28 px |
| Model tree | 240 px | 200–420 px |
| Task panel | 320 px | 280–480 px |
| Panel resize hit area | 8 px | At least 8 px |

Panel sizes are user preferences. Double-clicking a separator restores its default. The thin resize separator has an equivalent keyboard path plus labeled collapse and reset controls that meet the pointer-target baseline. Edge pixels are never the only resize or restore mechanism.

At widths below 1024 px, VibeShape MAY offer view, inspect, and export behavior, but it does not promise full authoring. It MUST explain the limitation instead of rendering an unusable compressed editor.

## Visual Design System

### Overall Direction

- Use the shadcn/ui `new-york` direction with Radix primitives.
- Ship dark, light, and system themes; dark is the initial default for the CAD workspace, not a hard-coded requirement.
- Use neutral or zinc foundational surfaces with one restrained primary accent.
- Separate working regions with borders, contrast, and resizable separators rather than nested cards.
- Do not use glassmorphism, large gradients, ornamental shadows, animated backgrounds, or oversized marketing typography in the editor.
- Use elevation only for temporary layers such as menus, popovers, tooltips, dialogs, and drag previews.
- Preserve the same semantic hierarchy in both themes; dark mode is not an inverted afterthought.

### Spacing and Density

Use a 4 px base grid. Default editor spacing is compact:

| Token | Value | Use |
|---|---:|---|
| `space-1` | 4 px | Icon-to-label gap, dense internal separation |
| `space-2` | 8 px | Control groups and compact padding |
| `space-3` | 12 px | Form-row and panel-section gap |
| `space-4` | 16 px | Panel padding and major group separation |
| `space-6` | 24 px | Empty states and dialogs only |

Do not mix comfortable dashboard spacing into the editor. A settings or onboarding screen MAY use a more comfortable density, but a single page must not switch density arbitrarily.

Pointer targets MUST be at least 24 × 24 CSS px or have the spacing required by WCAG 2.2. Primary toolbar targets SHOULD be 32 × 32 px. A later touch-authoring mode MUST use at least 44 × 44 px targets and cannot be created by simply scaling the desktop shell.

### Typography

- Use the bundled system UI stack initially; CAD operation must not depend on network fonts.
- Default editor text is 13 px with a 18 px line height.
- Panel section headings and dialog body text are 14 px.
- Application and dialog titles are 16–18 px; large display headings do not belong in the editor.
- Labels use sentence case. Do not use all caps for navigation or section headings.
- Numeric fields use tabular numerals. Monospace is reserved for expressions, IDs, file diagnostics, and command shortcuts.
- Never communicate hierarchy only through font size; combine weight, spacing, and region structure.
- Text MUST remain usable at 200% browser zoom without clipped labels or unreachable controls.

### Radius, Borders, and Shadows

- Use one small radius scale: 3 px for dense controls, 4 px for panels and menus, and 6 px for dialogs.
- Pills are reserved for compact statuses, filters, or segmented choices; ordinary buttons are not pills.
- One-pixel semantic borders define panel and control boundaries.
- Focus rings are independent of borders and remain visible against adjacent surfaces.
- Working panels have no ambient shadow. Popovers and dialogs use one shared elevation token.

### Color and Semantic State

Every color is assigned through a semantic token. Foundational UI surfaces MUST NOT use ad hoc palette classes or hex values.

| Meaning | Required redundant cue |
|---|---|
| Selected | Strong outline or fill plus selected semantics |
| Hover preselection | Distinct outline style and cursor change |
| Fully constrained | Lock icon or explicit label plus line style |
| Under-constrained | Degrees-of-freedom label or icon plus line style |
| Conflict/error | Error icon, text, and affected-entity marker |
| Warning | Warning icon and text |
| Suppressed feature | Strikethrough or suppression icon plus reduced emphasis |
| Stale/rebuilding | Spinner or progress state plus text |
| Hidden body | Visibility icon state and tree styling |

Text contrast MUST meet WCAG 2.2 AA: at least 4.5:1 for normal text and 3:1 for large text. Essential non-text controls and state boundaries target at least 3:1 against adjacent colors. Color alone never identifies solver, selection, validity, axis, or diagnostic state.

The X, Y, and Z axes may use conventional red, green, and blue, but every axis MUST also carry its letter and a distinct orientation.

### Icons

- Use Lucide icons consistently at 16 px in dense controls and 20 px in larger actions.
- An icon represents one concept everywhere; do not reuse it for unrelated commands.
- Icon-only buttons require an accessible name and a tooltip that includes the command name and shortcut.
- Stable high-frequency actions in the application bar and command toolbar use icon-only controls instead of repeating the same label beside the icon. Task-panel actions, form submission, destructive confirmation, menus, and unfamiliar one-off actions retain visible text when the label carries essential meaning.
- Do not put icons on every menu item. Use them when they improve scanning or encode a stable command family.
- Destructive actions do not become safe merely because they use a red icon.
- Custom CAD icons use the same optical size, stroke weight, and view box as Lucide.

## Viewport Design

### Visual Priority

- The viewport background is quiet and uniform. A subtle gradient is permitted only if it improves depth perception and passes selection-contrast tests.
- Geometry shading, edges, selection, preview, and diagnostics have separate render layers and semantic tokens.
- Display-level tessellation is never presented as exact geometry in text or export behavior.
- Grid density adapts to zoom and fades between steps; it must not shimmer or dominate faces.
- Origin planes, axes, section planes, and print build volume remain individually togglable.
- The orientation widget has text alternatives and matching commands in the View menu and command palette.

### Selection and Preselection

- Hover provides preselection before click whenever hit testing is available.
- Selection highlights the exact subshape and identifies its type in the status area or selection summary.
- Hovering or keyboard-focusing a visible feature-tree row preselects that feature's exact rebuilt geometry in the 3D viewport. Activating the row opens edit and keeps the same feature highlighted until the task closes.
- Feature-level tree highlighting, command preview, and face selection are separate render layers. Historical feature geometry remains identifiable even when a downstream operation consumes it, while hidden features never reappear through highlighting.
- Empty-space click clears selection unless an active command defines a different, visible behavior.
- Additive and range selection conventions are platform-aware and documented in shortcut help.
- The active selection filter is always visible when it restricts results.
- A rejected click explains the required entity type without opening a modal.
- Selection never changes because a rebuild guessed a topological match. Ambiguous references enter repair UX.
- Tiny or occluded entities remain reachable through a bounded candidate list or cycle-selection command.

### Camera and Navigation

The alpha default is:

| Input | Behavior |
|---|---|
| Primary click | Select or place the active sketch entity |
| Primary drag | Orbit the 3D camera; movement beyond the click threshold never activates selection |
| `Shift` + primary drag | Pan |
| Middle-button drag | Orbit |
| `Shift` + middle-button drag | Pan |
| Wheel or trackpad pinch | Zoom toward the pointer |
| Secondary drag | Pan |
| `F` | Fit selection, or fit all when nothing is selected |

Trackpad gestures MUST have a complete preset and must not depend on browser-reserved gestures. Navigation profiles MAY be added later for familiar CAD conventions. Camera movement never commits document changes and remains available during a geometry rebuild unless the viewport itself is unavailable. Replacing preview or rebuilt meshes MUST preserve the current orbit, pan, and zoom. Automatic fit is limited to initial viewport creation; later fitting requires an explicit user command.

Sketch mode switches to an orthographic view normal to the sketch plane by default. Leaving sketch mode restores the previous model camera unless the user explicitly chooses another view.

### Viewport Overlays

- Dimensions and constraint symbols scale for readability without changing model units.
- Labels avoid overlap where practical; a focused label may temporarily displace lower-priority labels.
- Overlay controls have accessible DOM counterparts or equivalent commands.
- Diagnostic overlays include a legend and can be hidden independently.
- Print overhang, wall, and build-volume overlays identify that they are heuristic analyses, not guarantees.

### Sketch Editor Interaction

The sketch editor is a transient command surface over one analytical `SketchRecord`. It MUST keep authored geometry, stable IDs, constraints, dimension expressions, selection, and local history separate from solved display state.

| Interaction | Required behavior |
|---|---|
| Place geometry | Point finishes after one position; Line remains chain-active after a segment; Midpoint Line finishes after midpoint and endpoint; corner Rectangle, center Rectangle, and center-point Circle finish after the required second point; Center-point Ellipse finishes after center, first-axis endpoint, and perpendicular second-axis radius; Elliptical Arc finishes after center, primary-axis endpoint, secondary-radius/start point, and endpoint; three-point Circle finishes after three circumference points; center-point Arc finishes after center, start, and end; three-point Arc finishes after start, end, and point-on-arc; Straight and Centered Slot finish after centerline and width definition; Slot from selected line finishes after one width pick |
| Select | Primary activation replaces selection; the platform additive modifier toggles entities; empty-space activation clears selection |
| Dimension | `D` activates a persistent dimension mode; one click selects a line or round curve, sequential clicks collect two points or two lines without requiring a modifier, pointer movement chooses the annotation kind and placement, and placement opens an anchored variable-aware value editor; points remain selectable but cannot be dragged in this mode |
| Drag point | Keeps the latest pointer position in viewport-local preview state, renders only the affected point and curves over the last valid exact solution on each animation frame, streams exact dependent-geometry feedback only when the sketch complexity budget permits it, retains at most one solve in flight plus the latest pending target, forwards continuation state, publishes one global draft plus one local undo checkpoint only when the gesture ends, and always requests the final exact solve on release |
| Modify geometry | Trim and Split target a line, arc, or circle under the pointer; Extend targets a line or arc; Mirror reflects preselected geometry after an axis pick or accepts an axis followed by repeated source picks; Transform accepts preselection or post-selection, keeps pointer preview local, exposes a relocatable point-snapping pivot plus exact variable-aware values, and commits once; Linear Pattern repeats the same selection in one or two exact directions; Circular Pattern repeats it around an exact center as a closed circle or open sweep; previews are capped and every successful mode commits one local undo checkpoint |
| Delete / Backspace | Removes selected entities plus invalid dependent geometry and constraints; shared points remain when still referenced |
| Escape | Cancels the in-progress placement before it exits the active sketch command |
| Undo / redo | Operates on the active sketch draft through buttons and `Ctrl/Cmd+Z`; it does not rewrite committed document history |
| Pan / zoom | Middle or secondary drag pans; wheel or trackpad zoom targets the pointer and never changes sketch units |
| Finish sketch | Performs one asynchronous, single-flight semantic add or update; double activation cannot create a second revision |
| Extrude selected profile | Saves the active sketch through the same single-flight revision-checked add or update, then opens Extrude only after persistence succeeds; failure preserves the complete draft and reports the save error |
| Cancel | Discards the complete draft and leaves the committed sketch unchanged |

- Geometry tools MUST call shared pure domain editing operations. React components do not assemble unvalidated entity or constraint records ad hoc.
- Direct modification tools expose only supported curve kinds as pointer targets. Trim uses neighboring bounded analytical intersections around the click; Extend uses the clicked-near open-curve endpoint and nearest reachable bounded line, arc, or circle; and Split projects one point onto a line or arc but requires two distinct projected points for a closed circle. The retained curve keeps its stable identity. Complementary circle arcs keep equal-radius intent without giving SolveSpace duplicate internal equations. Detached endpoint-only constraints are removed, while points and constraints still owned by adjacent geometry remain. Unsupported or degenerate actions leave the draft unchanged.
- Mirror follows the standard two-order CAD workflow. A preselection is reflected as one draft edit after the axis line is picked, then the editor returns to Select. Without a preselection, the first line pick becomes a visibly highlighted axis; each following point or curve pick produces one mirrored draft edit and keeps Mirror active until `Escape`. A localized live status names the required step. Shared endpoints stay shared in the mirrored graph, on-axis points are reused, and explicit Symmetric or equal-radius intent is added only where it does not duplicate exact solver equations.
- Transform keeps free or axis translation, rotation, and positive uniform scale in a selected-geometry SVG overlay until explicit apply. Moving its origin preserves the current affine mapping and snaps to authored points by screen-space tolerance. Exact origin, translation, rotation, and scale fields are state-agnostic expression inputs wrapped by TanStack Form; known dimensions normalize bare numbers to the active project unit and offer committed `#variable` suggestions. Apply creates one local history edit, while Cancel or `Escape` leaves the draft unchanged.
- Linear Pattern keeps one or two direction definitions transient until explicit apply. Counts are integers that include the seed, spacing is positive, the Cartesian product is limited to 100 total instances, and the viewport previews no more than ten total instances. Each occurrence owns new stable entity and constraint identities, preserves shared points inside its seed graph, clones only internal compatible constraints, and never copies crossing or fixed intent. Materialized copies are independent until a versioned associative-pattern model is accepted.
- Circular Pattern uses the same preselection and post-selection grammar. Its visible center marker and exact project-unit-aware center fields define the pivot; count includes the seed and is limited to 100. Closed mode distributes occurrences over exactly 360°, while open mode includes both ends of a nonzero sweep below 360°. The viewport previews no more than ten total instances, Apply creates one local undo checkpoint, and compatible internal constraints rotate with each materialized occurrence. Direct center dragging and associative editing remain explicit follow-up work.
- A completed placement MUST leave a schema-valid draft. Degenerate placement stays transient and does not create hidden entities.
- Rectangle corners share point identities and receive explicit horizontal and vertical constraints; visual alignment is never the only design intent.
- Center Rectangle shows a symmetric preview from the picked center, stores non-profile construction spokes, and uses only the nonredundant equal/parallel diagonal intent required to keep the center stable.
- Centered Aligned Rectangle shows a symmetric construction axis after its second pick, derives a signed perpendicular half-width from the third pick, and persists the center plus both opposite side midpoints instead of relying on initial coordinates.
- Slot variants preview the complete analytical outline before commit. Straight Slot keeps the authored centerline, Centered Slot mirrors that centerline around its first pick, and Slot from selected line is enabled only for exactly one line and converts that line to construction geometry. A completed slot contains two line sides and two semicircular arc end caps; redundant explicit constraints are not added merely to duplicate relationships already implied by shared endpoints and analytical arc equations.
- Midpoint Line shows the complete mirrored segment after its midpoint pick and persists one Midpoint constraint instead of baking symmetry into display coordinates only.
- Three-point Circle previews the exact circumcircle after two circumference picks, reuses inferred point identities, rejects repeated or collinear input, and persists each point-on-curve relation.
- Three-point Arc previews the exact circumcircle after two endpoint picks, reuses inferred endpoint identities, rejects collinear input without hidden geometry, and preserves the sweep passing through the third pick.
- Polygon variants use one remembered split family. Both begin at the center, preview the construction circle and complete outline, accept 3–50 sides, expose the live count beside the radius guide, and commit once only after the radius and side count are valid. Circumscribed Polygon interprets the second pick as a vertex radius; Inscribed Polygon interprets it as the tangent-circle radius. Number keys replace pointer-derived count, `Backspace` edits it, `Enter` commits it, and `Escape` cancels the current placement.
- Point and line placement use deterministic screen-tolerance inference. Existing-point snaps reuse the stable point identity; midpoint, bounded segment-intersection, and point-on-line candidates persist the corresponding relations; and line direction candidates persist horizontal, vertical, parallel, perpendicular, or endpoint-tangent intent. Point dragging accepts the same point-relation candidates in its single release commit. Holding `Shift` suppresses inference for precise unconstrained placement.
- Committed external points and lines participate in that same inference language without becoming editable sketch entities. A snap to an external point creates a local point plus explicit Coincident intent; a snap to an external line creates the applicable Midpoint, Point on line, or bounded Intersection relations. The preview glyph appears before acceptance, and `Shift` suppresses the proposal for the current pointer sample.
- Placement tools accept pointer picks over existing authored curves and route them through the same inference pipeline as empty-canvas picks. Existing geometry must not become a dead input zone in dense sketches.
- Point-drag client-coordinate samples are reduced to the latest sample per animation frame before sketch-coordinate conversion, inference, and viewport-local React publication. The spatial inference index is prepared when exact geometry or the quantized screen-tolerance scale changes and reused across gestures and ordinary pan or zoom frames; drag start only snapshots the viewport rectangle and identifies the affected curves. Each frame queries tolerance-neighbor candidates, excludes the dragged point and its incident lines, and runs the same deterministic inference rules without forcing browser layout or scanning the complete sketch. Stationary geometry retains one indexed, memoized base presentation, while a transient overlay redraws only the dragged point and incident curves. Smaller drafts stream exact constrained feedback at a bounded cadence. Dense drafts debounce exact feedback until the pointer has paused for 120 ms, so continuous motion remains viewport-local. Very dense drafts defer exact solving until release. The scheduler permits one request in flight and retains only the newest pending target, so slower solves drop stale intermediate targets instead of building a queue. Every solve reuses the unchanged schema-valid sketch, and release immediately submits the final target, preserves its overlay until the exact result settles, and records exactly one draft edit. Full-record cloning, schema parsing, full-solution copying, full inference-reference reconstruction, full-reference inference scans, index construction, repeated layout reads, and unbounded solver-result rendering belong outside pointer capture and uninterrupted pointer motion.
- Construction state is explicit per entity. Construction curves participate in solving but never create selectable solid profiles.
- Selected geometry, construction geometry, closed regions, solver conflicts, and under-constrained geometry require distinct non-color cues.
- Constraint actions are enabled from compatible selections only. Repeating the same semantic constraint is idempotent.
- A driving dimension uses a state-agnostic field primitive and a separate TanStack Form adapter. Its primary pointer path places a drawing annotation and edits through an anchored canvas field; the task-panel field is the accessible and diagnostic equivalent and does not receive automatic focus from a pointer selection. A selected line exposes its endpoint distance directly. Existing dimensions can be moved and edited without replacing their constraint identity or references. Authored unit or `#variable` expressions remain visible in the constraint list and viewport and survive save, edit, rename refactor, and reload.
- The worker owns live solving. The main thread sends a complete validated transient draft against the exact rebuilt revision and ignores stale responses; preview requests never enter document history.
- Solver status, degrees of freedom, and profile measurements remain visible without covering the geometry being edited. An over-constrained result preserves the draft and names or marks every failed constraint the solver can identify.
- Closed regions render behind entity strokes. Region activation stores a stable boundary-entity selector; transient profile indices are display-only.
- The accessible task panel exposes every geometry tool, constraint, dimension, profile, undo, redo, Finish, and Cancel action. Pointer-free coordinate entry and canvas placement remain documented alpha accessibility limitations.
- Related geometry variants use one split family action. The primary icon invokes the active or last-used variant; the adjacent Radix menu exposes every variant through keyboard navigation and a localized accessible name.
- The application shell occupies exactly the visible viewport. Model-tree and task-panel overflow scroll inside their own grid areas; adding entities or constraints never changes the sketch canvas height.
- **Use** enables only point and edge reference picking. **Intersection** explicitly enables planar-face hover and one committed face pick, rejects parallel support before mutation, then returns the sketch tool to Select without resetting the orbit camera.
- Entering sketch edit keeps the existing Three.js viewport mounted so ordinary Model/Sketch transitions do not reset its camera or dispose its scene. Normal mode aligns that existing orthographic camera to the exact resolved support frame, keeps model and reference context visible below the transparent analytical sketch surface, and gives pointer ownership to 2D editing. Each eligible earlier sketch has exactly one rendering owner in this mode: the analytical SVG layer draws its projected ordinary geometry as muted solid strokes and construction geometry as reduced-emphasis dashed strokes, while the Three.js layer omits that same saved-sketch display. This prevents doubled circles, points, and other curves when the two layers are aligned. The viewport rolls back at the active History item: it hides the active sketch's committed display and every later sketch or feature, including independent later items, while preserving earlier support and model context. Terminal-body presentation is recomputed after that transient rollback, so the latest upstream body state replaces a hidden consuming feature; an ordinary user Hide action never reveals historical geometry. **Show final result** may reveal the downstream result as explicitly labeled, display-only context without making any rolled-back item selectable, inferable, or eligible for **Use**. Turning it off restores rollback presentation immediately. **Orbit 3D view** MUST keep the analytical editor mounted but visually hidden and inert, give the viewer camera-only pointer ownership, suppress ordinary model picking and selection callbacks, and restore the earlier saved-sketch displays to the Three.js context together with exactly one current unsaved solved sketch. **Normal to sketch** MUST restore analytical ownership and support alignment without changing the authored draft, selected entities, selected profile, local undo/redo, final-context preference, or document state. These view commands use distinct icon-only actions with localized tooltips and active state; three identical visibility icons are not an acceptable substitute. Graphical external-reference picking remains a separate selection-broker capability and MUST NOT be inferred from camera motion.
- XY, XZ, and YZ are persistent translucent origin datums in the model viewport. Each visibility control uses a distinct, always-visible XY, XZ, or YZ plane symbol plus tooltip and accessible action name; three visually identical eye icons are not acceptable. The symbol is crossed out when hidden, so state does not depend on color. Origin datums become pickable only during sketch-support selection, so visible references never steal solid-selection clicks. Sketch editing retains the same independent visibility state as non-interactive active-plane and perpendicular-reference overlays; 2D sketch tools do not activate until support is accepted. A synchronized labeled native select and explicit `Start sketch` action remain the keyboard-accessible equivalent.
- A supported planar model face may replace the origin plane as sketch support. If the face is already selected, `Create sketch` enters editing immediately; during support selection the 3D viewport accepts either a visible origin plane or an eligible face. A model face under the pointer takes precedence over an overlapping origin datum, so origin-plane helpers never block sketching from an extrusion cap or other eligible face. The task panel identifies the support as a model face and does not expose a misleading editable origin-plane choice. Unsupported faces preserve selection and require a different support rather than silently falling back.
- Every committed feature row exposes one icon-only, tooltip-labeled visibility toggle. Visibility is presentation state, does not suppress or rebuild the feature, clears selection when the hidden feature owns it, and does not affect project thumbnails or export. Independent bodies keep stable display colors derived from feature identity; operation previews retain a separate non-selectable appearance.
- Every committed sketch row exposes independent icon-only, tooltip-labeled visibility and Delete actions. Delete opens an explicit confirmation and is unavailable for the currently edited sketch, read-only documents, an extrusion-owned sketch, or a source sketch with incoming external references. A visible saved sketch renders its solved curves and points in the model viewport on the exact origin, planar-face, extrusion-cap, or Datum Plane support frame. Construction geometry uses a distinct dashed, reduced-emphasis treatment. Sketch display is derived worker output, never semantic document content, topology identity, or selectable solid geometry. Finishing a sketch returns to the model viewport with that sketch visible and its selected closed profile retained for Extrude; activating the sketch row re-enters editing directly.

## Command and Tool Interaction

### Command Lifecycle

Every modeling command follows `Idle -> Preview -> Validating -> Committed` or returns to `Preview` with an actionable error. The canonical state machine is defined in [UX and core flows](ux-flows.md#command-states).

- Starting a command moves focus to its first incomplete requirement or parameter.
- The task panel names the command, describes the next required selection, and shows Apply and Cancel in a stable footer.
- Preview geometry is visually distinct from committed geometry.
- Apply is disabled only when the UI can state why; the reason is available next to the action, not only in a tooltip.
- Apply creates exactly one domain command and one undo entry.
- Cancel restores the pre-command UI selection when it still exists and does not change the document.
- Repeated commands require an explicit repeat or keep-active preference; they are not silently sticky.

### Escape Hierarchy

`Escape` performs one visible level of cancellation at a time:

1. Close the transient tooltip, menu, or popover that currently owns interaction.
2. Stop drawing the in-progress sketch segment or manipulator drag.
3. Cancel the active command preview.
4. Clear selection.

`Escape` MUST NOT navigate away, close the project, or discard committed work. Modal dialogs follow their primitive's accessibility behavior; a destructive action never occurs on `Escape`.

### Undo, Redo, and Confirmation

- Undo and redo operate at user-command granularity.
- Do not show confirmation for frequent, immediately undoable edits.
- Use `AlertDialog` for destructive or difficult-to-recover actions such as deleting a project, discarding recovery data, or replacing an external source.
- The dialog title names the consequence, its body names the affected object, and the destructive action uses a specific verb such as `Delete project`.
- Default focus goes to the safest reasonable action.
- A confirmation cannot substitute for an unavailable backup or undo strategy.

## Forms, Parameters, and Units

### Field Structure

Every editable field has:

- a persistent visible label;
- a unit or expected format when applicable;
- current value and optional expression source;
- validation text connected programmatically to the input;
- `aria-invalid` when invalid;
- a stable position while errors appear.

Placeholder text is an example, never the only label or required instruction.

### Numeric Behavior

- The document's internal length unit is millimeters, but fields display the chosen document or field unit.
- The application bar exposes one project Units dialog for `um`, `mm`, `cm`, `m`, `in`, or `ft` length display and `deg` or `rad` angle display; the status bar and modeling view keep the active choice visible.
- Preserve the user's raw text while editing. Parse and normalize on committed change, not on every keystroke.
- When the collapsed caret follows `#` in an expression field, open a bounded autocomplete list filtered by the variable-name fragment at that caret. Arrow keys move the active option, `Enter` or `Tab` inserts the exact `#name` token, pointer selection preserves input focus, and `Escape` closes only the list. Inserting a suggestion replaces only the active token and never replaces authored text with its resolved value.
- Accept signed decimals and explicit units in P0; expressions follow the P1 expression grammar. In a dimensionally known field, commit a bare finite numeric literal with the current project unit made explicit so a later preference change cannot alter the model.
- A preference change converts displayed canonical results and defaults for new fields. It never rewrites an existing authored expression or changes physical geometry.
- Show the normalized value after successful commit when it differs from the entered representation.
- Empty, incomplete, non-finite, dimensionally invalid, and out-of-range values receive different messages.
- Do not change a focused numeric value on wheel scroll. Arrow stepping requires an explicit field behavior and documented modifier scale.
- Constraints and feature parameters MUST state whether zero and negative values are meaningful.
- Validation must not destroy a previously valid committed value.

### Variables Table

Document variables use a dedicated panel reachable from the model tree and command palette. The initial composition is a semantic table, not an ARIA grid: each editable cell contains an ordinary labeled form control, each row has an accessible name, and native `Tab` order remains predictable until spreadsheet-style keyboard behavior is implemented completely.

The table has these columns:

| Column | Contract |
|---|---|
| Name | Shows the authored ASCII name with a persistent visual `#` prefix. A committed name is read-only until the user starts the explicit atomic Rename action. |
| Expression | Preserves raw text while editing and commits only after table-level syntax, reference, cycle, dimensional, and range validation. |
| Result | Read-only resolved value in the current display unit, with the canonical dimension available to assistive technology. |
| Status | Uses text and iconography for valid, invalid, missing-reference, cycle, or affected-feature state; color is supplementary. |
| Actions | Contains specifically labeled row actions such as `Remove variable`; busy and double-activation behavior follows the shared Button contract. |

- `Add variable` creates an uncontrolled editing row and focuses its name field; it does not change the committed document until Apply succeeds.
- The uncontrolled table component owns raw incomplete input. Its TanStack Form integration supplies validation, dirty state, submission, and command construction without replacing the primitive's DOM contract.
- A committed expression may reference any row with `#name`; row order is presentation only and never changes evaluation semantics.
- Expression autocomplete uses the same current table draft so newly authored names are available immediately, but excludes the owning row by stable variable ID to prevent suggesting a direct self-reference.
- Errors stay adjacent to the owning row and the panel exposes an error summary that moves focus to the first invalid control.
- Apply validates the exact visible table and emits one ordinary `org.vibeshape.variable.replace-table` command inside a persisted draft against the displayed base revision. Stale revisions preserve the editing buffer and offer rebase or discard rather than silently overwriting newer work.
- Removing a referenced variable is unavailable and names the dependent variable, feature parameter, or sketch dimension. The application never converts a broken reference into a numeric fallback.
- A formatting-only edit may advance the document revision while reusing geometry when the resolved value is unchanged; the UI reports a successful semantic save without implying that geometry rebuilt.
- Result cells use tabular numerals; authored expressions use the expression typography token. Long expressions truncate visually only when the complete source remains available on focus and to assistive technology.
- Table virtualization is deferred. If later required, it must retain form state, focus, row error ownership, and accessible row/column position.

### Parameter Panel

- Required parameters appear first in modeling order.
- Optional and advanced parameters use a labeled collapsible section.
- Interdependent values show their relationship near the controls.
- A selection field shows entity type, user-facing name, source feature, and missing or ambiguous state.
- Ordered Boolean inputs are labeled by role rather than position alone: the target remains and the tool is removed. The same feature, the edited feature itself, suppressed features, and transitive dependents that would create a cycle are unavailable as input choices.
- A finite list of local feature inputs uses the native select contract for keyboard navigation and typeahead. A searchable combobox is introduced only when measured list size or disambiguation needs justify it.
- Create and edit reuse the same non-modal task-panel composition. Edit restores the authored source string, preserves stable feature identity and untouched record fields, and commits only through the ordinary update command.
- A direct solid primitive never relies on an unexplained hidden location. Its form exposes an explicit placement origin in the current project unit, supports the same signed unit and `#variable` expressions as other length fields, explains how centering changes the Z extent, and restores those authored values during edit.
- Validation or persistence failure keeps the visible editing buffer and adjacent diagnostics. A successful save closes the task only after semantic persistence; geometry rebuild does not bypass that ordering.
- Reset restores the command's initial value, not a hidden global default.
- Parameter changes use a short debounce for preview but Apply always validates the exact visible values.
- A parameter that accepts variables preserves the authored expression in the field; a resolved value may be shown alongside it but never silently replaces `#name` source text.
- Variable autocomplete behavior is identical in feature parameters, sketch dimensions, and variable formulas; forms integrate the same state-agnostic expression input through their TanStack Form value callback.

## Model Tree

The model tree is a dedicated accessible tree, not a styled table.

- `Up` and `Down` move through visible nodes; `Left` collapses or moves to the parent; `Right` expands or moves to the first child.
- `Enter` activates the primary edit action; `Space` toggles selection when supported; `F2` renames.
- Multi-selection follows platform conventions and never changes feature order.
- Visibility, suppression, active, warning, error, and stale states have independent controls or indicators.
- Pointer hover and keyboard focus use the same feature preselection contract; active edit uses persistent selection semantics rather than relying on row color alone.
- An error badge identifies the owning feature and opens its diagnostic; it is not only a count on an ancestor.
- Reordering is unavailable until DAG validation can explain whether a move is legal.
- Context-menu actions are duplicated in the command palette or an accessible action menu.
- Virtualization MUST preserve focus, selection, accessible position, and programmatic names.

## Menus, Toolbars, and Command Palette

### Toolbars

- Use the ARIA toolbar pattern with one tab stop per toolbar and arrow-key movement among controls.
- Group commands by creation, modification, view, and analysis; separate groups visually and semantically.
- The active toggle or tool has `aria-pressed` or equivalent state and a non-color visual cue.
- Overflow preserves command labels, shortcuts, enabled state, and grouping.
- A disabled command exposes a nearby reason when the user is likely to need it.

### Menus

- Menus use platform-consistent arrow, Home, End, Enter, Space, and Escape behavior from the underlying primitive.
- A menu label that opens another dialog ends with an ellipsis, for example `Export…`.
- Check and radio menu items express persistent choices; ordinary actions do not imitate selection.
- Menus close after invoking an action unless the action is explicitly a toggle designed for repeated use.

### Command Palette

- `Ctrl/Cmd+K` opens a searchable list of registered application commands.
- Results show command name, group, shortcut, and current enabled state.
- Search matches familiar synonyms, but the canonical command name remains stable.
- Disabled results explain their missing precondition and do not disappear merely because context changed.
- Recent commands MAY improve ranking locally; no usage data leaves the device.
- The palette does not become a second implementation of command behavior.

## Dialogs, Popovers, Tooltips, and Sheets

- Every `Dialog`, `Sheet`, and future `Drawer` includes a programmatic title; visually hidden titles are allowed only when another visible heading is unambiguous.
- Dialogs include a concise description when the consequence or required input is not obvious.
- Focus moves into the layer, remains trapped only while modal, and returns to the invoking control on close when that control still exists.
- Use a non-modal task panel for normal modeling parameters. Modal dialogs are reserved for project-level boundaries, blocking choices, imports, exports, and confirmations.
- Use `AlertDialog` for destructive confirmation, never an ordinary `Dialog` styled red.
- Popovers contain short contextual controls. Long forms and multi-step tasks do not belong in popovers.
- Tooltips supplement accessible names; they never contain required instructions, errors, or interactive content.
- A hover-opened surface remains dismissible and does not cover the control or model entity the user must inspect.
- The application-level `Export…` dialog names each format by purpose, blocks format actions until a valid rebuilt solid exists, and keeps pending, success, or failure status discoverable in the application bar after the modal closes.
- The preferred slicer is a device/browser preference, not document content. Save a valid selection immediately and reuse it across projects.
- “Open in slicer,” “sent to slicer,” “downloaded,” “sliced,” and “printed” are different states. If local handoff fails, download the 3MF and say so; never claim that a slicer opened.

## Feedback, Progress, and Diagnostics

### Feedback Hierarchy

| Feedback | Surface | Lifetime |
|---|---|---|
| Field error | Under the field and in command summary | Until corrected or canceled |
| Command precondition | Task panel near the blocked action | While blocked |
| Rebuild/solver status | Status bar and affected tree nodes | While active or stale |
| Recoverable warning | Persistent diagnostic panel or report | Until resolved or acknowledged |
| Brief success | Status message or optional toast | Short and non-blocking |
| Data-loss/security decision | Modal dialog or recovery screen | Until explicit decision |

Toasts MUST NOT be the only record of an error, topology ambiguity, save failure, or export result. Important results remain discoverable in the task panel, tree, project state, or report.

Status changes that do not move focus use the appropriate live-region semantics. Routine progress is polite; immediate failures that require attention may be assertive. Repeated preview updates MUST be coalesced to avoid overwhelming assistive technology.

### Long-Running Operations

- An action that starts asynchronous work becomes single-flight until that attempt settles. Its control exposes a named loading state, blocks accidental double activation, preserves its accessible name, and does not hide rejection behind an indefinitely spinning indicator.
- Disabling the initiating control does not disable unrelated navigation or inspection. Conflicting actions use the same operation state instead of implementing independent timers.
- Show named stages such as `Reading STEP`, `Healing geometry`, `Rebuilding features`, and `Tessellating`.
- Show a percentage only when the underlying operation reports meaningful progress.
- Otherwise use indeterminate progress with elapsed time after an appropriate delay.
- Keep camera navigation and unaffected document inspection responsive.
- Distinguish `Cancel requested` from `Canceled`; logical cancellation may wait for the active kernel call to return.
- Discard stale worker generations and state this in diagnostics only when relevant.
- After a worker crash, preserve the last committed snapshot and offer restart and recovery export.

### Error Message Formula

A useful error contains:

1. **What failed:** `Fillet could not be created.`
2. **Where:** `Feature Fillet 3, edge from Pocket 1.`
3. **Why, when known:** `The radius is larger than the adjacent face.`
4. **What to try:** `Use a radius below 2.4 mm or choose fewer edges.`
5. **Details:** a copyable diagnostic code and optional local technical detail.

Never replace this structure with a raw exception, a generic `Something went wrong`, or a fabricated explanation. If the kernel does not provide a cause, say that the exact cause is unknown and offer evidence-based next actions.

## Project Library, Empty States, and Onboarding

- The project library prioritizes `New project`, `Open .vshape`, recent local projects, and recovery state.
- Each project card shows name, exact-revision 3D preview when available, modification time, storage state, and an accessible action menu. Preview generation is derived and non-authoritative: a failed write must not be marked complete and receives one bounded retry; an unavailable or stale preview remains an explicit placeholder.
- Deletion uses a specific confirmation and does not imply that exported copies are deleted.
- The first-run screen offers the versioned bracket example and a short `Create sketch -> Extrude -> Print check` path.
- Do not force a multi-step product tour. Use dismissible contextual tips attached to stable UI regions.
- Empty states explain what the region will contain and provide one relevant action; they do not use promotional illustration as the primary content.
- Sample projects and fixtures clearly identify that edits create a local copy.

## Local-First and Save Language

Use these states consistently:

| State | Preferred copy |
|---|---|
| Transaction committed to browser storage | `Saved in this browser` |
| Write pending | `Saving locally…` |
| Local write failed | `Could not save in this browser` |
| Native file written or downloaded | `Project file exported` |
| Persistent storage granted | `Browser storage protected from automatic cleanup where supported` |
| Offline application ready | `Available offline` |

Do not use `Synced`, `Backed up`, or cloud icons unless an actual opt-in sync or backup exists. The project header exposes the latest local save and latest file export as separate facts.

## Accessibility Contract

### Baseline

- Target WCAG 2.2 AA for application chrome and HTML-based workflows.
- Use semantic HTML and tested Radix/shadcn primitives before custom ARIA.
- Every core command has a keyboard path that does not require a context menu.
- Focus is always visible with an indicator equivalent to at least a 2 CSS px perimeter and sufficient contrast.
- No keyboard trap exists outside a correctly implemented modal layer.
- Status, validation, and progress changes are programmatically announced without unnecessary focus movement.
- Motion respects `prefers-reduced-motion`; essential state changes remain understandable without animation.
- At 200% zoom, controls reflow or panels scroll without losing commands or form labels.
- UI meaning never depends only on color, hover, spatial position, or a pointer gesture.

### Canvas and 3D Content

The WebGL canvas cannot be the only representation of document structure or state.

- Bodies, features, sketches, selections, measurements, and diagnostics have accessible HTML representations.
- The active viewport selection is exposed in a labeled selection summary.
- Standard views, fit, display modes, section controls, and selection filters are available outside the canvas.
- Free-form spatial sketching is an acknowledged accessibility limitation for alpha; numeric editing and existing-entity operations remain keyboard reachable.
- A release notes known limitations instead of claiming complete canvas accessibility.

### Shortcut Safety

- Do not trigger single-letter shortcuts while focus is in an input, textarea, content-editable element, or active text composition.
- Platform browser and assistive-technology shortcuts take precedence.
- Shortcut help is searchable and shows macOS versus Windows/Linux notation.
- Shortcut remapping is P1 and detects conflicts before saving.
- Holding a key does not create repeated irreversible commands.

## Responsive and Input Strategy

| Environment | Support level |
|---|---|
| Desktop mouse and keyboard | Primary alpha authoring target |
| Desktop trackpad and keyboard | Primary alpha authoring target |
| Tablet with keyboard and pointer | P1 evaluation target |
| Touch-only tablet | Later dedicated interaction design |
| Phone | View, inspect, download, and export only where practical |

Responsive behavior prioritizes model visibility:

1. Collapse the task panel into a labeled sheet.
2. Collapse the model tree into a labeled sheet.
3. Move low-frequency toolbar actions into grouped overflow.
4. Preserve project state, selection summary, active command, and Cancel.

Do not hide Apply, Cancel, errors, save state, or the active selection filter solely to fit a narrow viewport.

## Automation and MCP Experience

AI automation is an inspectable participant in the existing command workflow, not an invisible cursor. Pairing and document sharing are separate explicit user actions.

The automation surface shows:

- the connected client name, session state, shared document scope, and a persistent Disconnect action;
- currently running tool, owning first-party module or extension, real progress stage, cancellation, and elapsed time;
- an automation draft separate from committed history, with affected features, diagnostics, geometry-invariant summary, and viewport preview;
- the base document revision and a clear conflict state when the document changed during the proposal;
- the exact commands proposed for commit, grouped as one undoable transaction when valid;
- MCP actor and client provenance in history without storing private model prompts by default.

Mutating proposals use host-owned **Review changes**, **Apply**, and **Discard** controls. Destructive effects require an explicit confirmation that names the affected features or data. A client-provided description or MCP tool annotation cannot replace host copy or suppress confirmation.

Disconnect, cancellation, timeout, browser close, worker restart, extension revocation, or validation failure discards or preserves the draft for explicit review according to recovery policy; none silently commits. The user can continue manual modeling while a draft exists, but a changed base revision forces the automation proposal into a visible conflict state rather than automatic rebasing.

The interface never presents model output as validated geometry merely because a tool call succeeded. Preview, committed, stale, blocked, invalid, and unverified-analysis states remain visually and programmatically distinct.

The technical boundary is defined in [Automation and MCP architecture](../architecture/automation-and-mcp.md).

## Extension Experience

Third-party extensions follow the same interaction grammar as built-in functionality, while their trust and ownership remain explicit.

### Extension manager

The extension manager distinguishes **Installed**, **Enabled**, and **Granted** states and shows:

- package name, stable ID, exact version, source, integrity, publisher identity, and license;
- declared contribution points and activation conditions;
- capabilities grouped by document data, mutation, files, clipboard, and network;
- every allowed network origin with the extension author's reason;
- documents that still require an installed version;
- compatibility, quarantine, update, runtime, and resource-limit diagnostics;
- direct Disable, Review permissions, Inspect details, Roll back, and Uninstall actions when eligible.

Installation, enablement, permission approval, update, and uninstall are separate decisions. A permission dialog names the requested capability and concrete effect; it does not use a single broad "Trust this extension" checkbox. The safe default is to keep new authority denied.

Updating an extension shows added or removed permissions, version/API changes, affected documents, and disposable rebuild results before commit. Declining an update keeps the exact installed version available. Uninstall warns when local documents still reference the artifact and must not make those documents unrecoverable without explicit confirmation.

### Project open and failure

Opening a project never installs or executes an unavailable extension. Missing, disabled, incompatible, timed-out, or failed extensions are shown on the owning feature-tree rows and in a persistent document-level summary.

The primary recovery actions are:

- locate or install the exact required package;
- enable it or review denied permissions;
- keep the project in restricted mode;
- replace the version through an explicit migration preview;
- remove the owning feature through an ordinary document command;
- export the untouched original archive.

Last valid geometry may remain visible only with a persistent **Stale preview** label and styling. It is not selectable as validated geometry for downstream authoring or silently exported.

### Contributions

- Extension commands use the shared command registry, palette, eligibility, preview, Apply/Cancel, async busy, double-activation, cancellation, and undo contracts.
- The UI identifies the owning extension in command details and diagnostics without adding noisy badges to every normal toolbar action.
- Extension panels occupy declared host slots and cannot cover the application bar, save state, permission UI, or critical diagnostics.
- Sandboxed panels inherit semantic theme values but remain responsible for keyboard access, focus, 200% zoom, localization, and non-color cues.
- Extension UI cannot imitate host permission, file picker, save, destructive confirmation, or recovery surfaces.
- Host-owned security and permission copy always uses VibeShape catalogs; extension copy cannot redefine the meaning of a capability.

The technical trust and lifecycle contract is defined in [Extension architecture](../architecture/extensions.md).

## Content and Terminology

- Canonical product copy is English and uses sentence case.
- All user-facing labels, accessible names, descriptions, validation, status, recovery, and error copy originates in typed ICU message catalogs, even before another locale ships.
- Do not concatenate translated fragments or use translated copy as a command, domain, persistence, analytics, or diagnostic identifier.
- Locale is a local UI preference. Changing it updates the document language but never creates an undo entry, rebuilds geometry, changes project data, or requires network access.
- Buttons use specific verbs: `Create sketch`, `Apply fillet`, `Export 3MF`.
- Use established CAD terms when they improve precision, with short contextual help for new users.
- Use `body`, `solid`, `face`, `edge`, `vertex`, `sketch`, `feature`, and `constraint` consistently with the domain model.
- Do not use `part`, `object`, and `model` interchangeably when the distinction matters.
- State the unit next to dimensions and in exported reports.
- Use positive instructions for recovery. Prefer `Reduce the radius` over `Invalid input`.
- An ellipsis indicates that a command opens a dialog or requires more input; it does not decorate labels.
- Avoid blame, jokes in errors, fake urgency, and anthropomorphic kernel messages.

## Motion

- Default transitions last 100–160 ms for hover, selection, disclosure, and layer entry.
- No editor transition should exceed 200 ms unless it represents real asynchronous progress.
- Geometry previews update as data arrives; they do not tween between topologically unrelated shapes.
- Camera animation is optional, interruptible, and disabled or reduced under `prefers-reduced-motion`.
- Do not animate diagnostic color continuously. Use static emphasis and a progress indicator when work is active.
- Skeletons are for initial structural loading, not for known long-running kernel work with meaningful status.

## shadcn/Radix Component Mapping

| Product need | Base primitive | VibeShape rule |
|---|---|---|
| Command palette | `Command` + `Dialog` | Registered application commands only; show shortcut and disabled reason |
| Global and row actions | `DropdownMenu` | Keep grouping and keyboard behavior; context menu is not the sole entry point |
| Viewport context action | `ContextMenu` | Operates on explicit hit target or current selection; never silently changes selection and acts in one step |
| Feature parameters | `Field`, `Input`, `Select`, `Checkbox` | Persistent labels, units, inline validation, stable layout |
| Destructive confirmation | `AlertDialog` | Specific consequence and action verb; safe default focus |
| Import/export boundary | `Dialog` | Title and description required; show file, units, scope, and result |
| Narrow-screen panel | `Sheet` | Restore focus and preserve active command state |
| Short hint | `Tooltip` | Name and shortcut only; no required instructions |
| Status | `Badge`, `Progress`, `Alert` | Always pair color with text/icon; persistent when action is required |
| Panel resizing | `Resizable` | Enforce minimums, keyboard path, and default reset |

Generated shadcn source is reviewed as project code. Component variants express semantic intent such as `toolbar`, `quiet`, `selected`, and `destructive`; product features do not accumulate repeated arbitrary utility strings.

## Prohibited Patterns

- Hidden modes with no visible workspace or active-tool indicator
- Silent autosave language that implies an external backup
- Committing geometry on every preview change
- Disabling Apply without explaining the unmet requirement
- Destructive actions in an ordinary dialog or toast
- Required information available only in a tooltip or on hover
- Context-menu-only commands
- Modal parameter editing for every feature
- Nested cards as the primary editor layout
- Color-only solver, selection, axis, or error state
- Browser `alert`, `confirm`, or `prompt`
- Fake percentages for kernel operations
- Raw stack traces as the primary user message
- Auto-dismissed export, save, topology, or data-loss failures
- Tiny unlabeled icon buttons packed without target spacing
- Capturing shortcuts while the user is typing
- Rebuilding the model because the user only changed theme, panels, or camera
- Sending analytics or crash data without a separate explicit opt-in decision
- Installing, enabling, granting, updating, or downloading an extension merely because a project was opened
- One-click blanket trust that hides individual extension capabilities or network origins
- Extension panels that imitate VibeShape permission, save, file, or destructive-confirmation UI

## Definition of Done for UI Work

A UI or UX change is complete only when:

- it invokes a registered application command or a clearly UI-local preference;
- loading, empty, disabled, error, success, and cancellation states are designed;
- keyboard operation and visible focus are verified;
- accessible names, roles, descriptions, validation, and status announcements are verified;
- dark and light themes pass contrast and screenshot review;
- 200% zoom and the 1024 px authoring width are checked;
- long text and future localization do not clip critical actions;
- pointer targets and spacing meet the accessibility baseline;
- the command remains available without a context menu;
- undo, recovery, and data-persistence effects are explicit;
- worker delay, stale results, and worker failure are covered where applicable;
- component, integration, or E2E tests cover the highest-risk behavior;
- design tokens and shared component variants are used instead of one-off styling.

## UX Review and Validation

### Required Design Review Artifacts

- state inventory covering idle, hover, focus, selected, disabled, loading, warning, error, and empty;
- keyboard map and focus order for composite widgets;
- dark and light screenshots at 1440 px and 1024 px widths;
- copy for validation, failure, cancellation, and recovery;
- command and undo boundary;
- accessibility notes for any custom canvas or tree interaction.

### Alpha Usability Tasks

Test with representative makers and 3D-print users:

1. Start from an empty project and create the reference bracket.
2. Find and edit an early dimension.
3. Diagnose an over-constrained sketch.
4. Repair an ambiguous downstream reference.
5. Discover why a fillet failed and recover without losing inputs.
6. Run Print Check and distinguish warnings from blocking export errors.
7. Export a `.vshape` backup and a 3MF print file.
8. Reopen offline and recover after a simulated worker or tab crash.

Record completion, critical errors, wrong turns, time on task, assistance, and qualitative confidence. Do not optimize only for completion time: silent misunderstanding of save state or geometry correctness is a critical failure even when the task is fast.

## Standards Basis

The implementation basis is recorded in [Research and Primary Sources](../research-sources.md#ux-accessibility-and-component-behavior). When this document conflicts with an accepted architecture decision, the ADR controls architecture and this guideline must be updated. When a prototype reveals an interaction failure, update this specification together with the test or research evidence.
