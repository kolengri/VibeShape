# Sketch-first modeling implementation plan

The cross-sketch, feature-history, support-frame, and 3D reference workflow is specified in the
[Associative Sketch and Feature Workflow Plan](associative-sketch-and-feature-workflow-plan.md).

## Decision

VibeShape's primary modeling workflow is **Sketch → select closed profile → Feature**. Direct Box and Cylinder commands remain supported as secondary advanced tools, but they do not define the product's default path.

This follows the proven parametric-CAD interaction model without copying Onshape's implementation or visual identity. In Onshape, sketches are parametric feature-list entities created on a plane, and solid Extrude consumes selected sketch regions or planar faces. VibeShape uses the same user-level sequence while preserving its local-first worker, stable-selector, extension, and automation boundaries.

Primary references:

- [Onshape Sketch Basics](https://cad.onshape.com/help/Content/Sketch/sketch_basics.htm)
- [Onshape Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm)
- [Onshape dialogs and selection fields](https://cad.onshape.com/help/Content/Home/dialogs.htm)

## Product invariants

1. **A sketch is a first-class historical record.** It owns stable entity and constraint identities, its support plane, and authored dimension expressions.
2. **Selection and editing share one stable owner identity.** Hover and focus preselect the same viewport geometry. Activating a saved sketch enters its editor directly; feature activation opens its edit task without an extra redundant action.
3. **A feature consumes design intent.** Extrude stores a stable profile selector, never a response-local profile or loop index.
4. **Tool eligibility follows selection.** Extrude is available only when the selected sketch contains a supported closed region. Later Add, Remove, and Intersect modes additionally require compatible target bodies.
5. **Every command previews before commit.** Parameter and selection changes remain transient until one asynchronous, single-flight Apply action persists an ordinary document command.
6. **History remains ordered and replayable.** Sketch and feature edits preserve stable identities, rebuild downstream operations, and never mutate derived B-Rep or mesh state directly.
7. **The ordinary command path is universal.** First-party UI, extensions, and future MCP tools use the same schema-backed draft, preview, validation, and commit contracts.

## Canonical interaction

```mermaid
flowchart LR
    A["Select Sketch"] --> B["Select support plane"]
    B --> C["Draw and constrain 2D geometry"]
    C --> D["Finish sketch"]
    D --> E["Select closed profile"]
    E --> F["Choose Extrude"]
    F --> G["Preview distance and operation"]
    G --> H["Commit feature"]
    H --> I["Add another sketch or feature"]
```

The product now authors sketch geometry interactively. The former rectangle-parameter form has been removed from the product path; the retained domain rectangle helper remains a deterministic compatibility and test utility.

## Delivery sequence

### Slice 1 — make the implemented path sketch-first

Status: implemented in the product shell.

- Make Create sketch the primary empty-document action.
- Present Sketch and eligible Extrude before direct-solid commands.
- Treat model-tree sketch activation as selection, not immediate editing.
- After Finish sketch, keep the saved profile selected and make Extrude selected profile the primary next action.
- Keep Box and Cylinder in an explicitly secondary advanced path for compatibility and fast blocking.
- Cover the selection boundary, command eligibility, async Finish, extrusion commit, rebuild, edit, and reopen in component and cross-browser tests.

### Slice 2 — plane selection in the modeling viewport

Status: partially implemented. Command-first creation now renders and raycasts the XY, XZ, and YZ origin planes in the 3D modeling viewport, preserves a labeled native select as the keyboard-accessible equivalent, and enters the normal-to-support 2D workspace only after a valid choice. The same mounted viewer aligns to resolved origin-plane, supported planar-face, extrusion-cap, and Datum Plane frames. The user can temporarily orbit the active unsaved sketch in world-space context and return with **Normal to sketch** without losing the draft. Preselection-first entry from an idle viewport remains open.

- Render XY, XZ, and YZ origin planes as selectable transient datum entities during command-first creation. Implemented.
- Support both preselection-first (`select plane → Sketch`) and command-first (`Sketch → select plane`) entry.
- Use viewport preselection and primary-click picking as the command-first primary interaction while retaining the synchronized native select as an accessible equivalent. Implemented.
- Enter a normal-to-support orthographic camera only after the support is valid. Implemented for every support role resolved by the shared support-frame authority.
- Add Escape, invalid-selection guidance, keyboard traversal, and touch-sized selection targets. Escape and the keyboard select path are implemented; rejected-entity guidance and dedicated touch targets remain open.

Exit criterion: a new user can start a sketch from the viewport without reading documentation.

### Slice 3 — interactive sketch authoring

Status: core P0 interaction implemented.

- Point, Line/Polyline, corner Rectangle, center Rectangle, Aligned Rectangle, Centered Aligned Rectangle, center-point and three-point Circle, center-point, three-point, and Tangent Arc, and Construction modes author analytical geometry.
- Select, additive select, point dragging, cascade Delete, Escape placement cancel, local undo/redo, pan, zoom, and stable draft identities are implemented.
- Rectangle placement adds horizontal and vertical intent automatically. Center Rectangle adds stable construction spokes plus the minimum equal/parallel intent needed to retain its picked center without over-constraining SolveSpace. Three-point Arc reuses inferred endpoint identities, previews the exact circumcircle after the second endpoint, and records its oriented analytical arc as one draft edit. Point and Line placement plus point dragging provide deterministic existing-point, line and circular-arc midpoint, bounded segment-intersection, point-on-line, distant horizontal/vertical point alignment, and exact circle or bounded-arc quadrant inference; Line additionally previews and persists horizontal, vertical, parallel, perpendicular, or endpoint-tangent intent. Arc midpoint inference uses half the positive analytical sweep rather than the chord midpoint and persists dedicated midpoint intent that follows endpoint edits. Quadrants retain both point-on-curve intent and horizontal/vertical alignment to the stable curve center. `Shift` suppresses automatic inference for the current pointer sample. Applied geometric constraints and driving expressions render as viewport glyphs. Remembered wake-up references cover visible earlier-sketch geometry and uniquely resolved coplanar model points, lines, circular curves, and their stable centers without duplicating one materialized curve reference. General projected geometry remains open. Live solver state and degrees of freedom are visible.
- Compatible selections expose every P0 constraint schema. A selected line exposes its endpoint distance directly. Direct length and angle dimensions retain literal or committed `#variable` expressions through TanStack Form adapters and can be edited without replacing their stable constraint identity.
- Preserve analytical entities; sampled display geometry never becomes semantic source data.
- Preserve over-constrained drafts and failed constraint identities without silently deleting constraints; richer repair suggestions remain open.

Exit criterion: the reference flange and bracket profiles can be created, fully constrained, edited, saved, and reopened.

### Slice 4 — profile-region selection and extrusion preview

Status: stable single-profile selection implemented; multi-profile feature input and solid preview remain open.

- Render solver-produced closed regions as selectable areas behind entity strokes.
- Persist only canonical stable boundary-entity selectors.
- Detect and list multiple regions, holes, and islands within the bounded profile contract; the current extrusion accepts one selected profile.
- Preview the transient solid in the 3D viewport while distance, direction, and symmetric state change.
- Show the exact selection set in the task panel and preserve it after validation failures.

Exit criterion: users can choose among multiple regions without relying on creation order or transient indices.

### Slice 5 — feature operations

- Extend Extrude from New to Add, Remove, and Intersect with explicit merge scope.
- Sketch-on-planar-face and signed offset Datum Plane support are implemented. Add mid-plane, angular, three-point, axis, and point reference modes after stable edge/vertex selection.
- Add Revolve, Hole, Fillet, Chamfer, Shell, Pattern, and Mirror as ordinary ordered features.
- Keep command availability driven by selected geometry and registered module capabilities.

Exit criterion: a printable bracket can be built without direct primitives and remains valid across its parameter-change matrix.

### Slice 6 — history and repair

- Active-sketch draft undo/redo is implemented. Add rollback-aware committed history editing, suppression, reorder validation, and command-level undo/redo.
- Highlight downstream failures at the owning feature.
- Resolve stable topology references conservatively; ambiguous references open repair UI instead of guessing.
- Expose the same bounded repair choices through automation contracts.

Exit criterion: editing an early sketch or feature either rebuilds deterministically or identifies the exact downstream operation that needs repair.

## Extension and MCP consequences

A modeling module contributes feature schemas, eligibility predicates, task-panel metadata, preview/evaluation handlers, and migrations. It does not own the document or bypass commands. Sketch tools contribute analytical entity and constraint commands through a narrower registered capability.

Future MCP tools operate on stable IDs and revision-tagged drafts:

1. query selectable planes, sketches, profiles, bodies, and registered feature types;
2. create a disposable sketch or feature draft;
3. set selections and parameters;
4. request solver or geometry preview plus diagnostics;
5. commit only against the exact base revision and declared confirmation class.

The MCP surface must never expose transient solver handles, native OCCT objects, Three.js objects, or response-local profile indices.

## Verification gates

Each slice requires:

- pure domain tests for stable identity, commands, selectors, and failure invariants;
- worker tests for solve, profile materialization, geometry, cancellation, and recovery;
- focused React tests for selection versus edit, eligibility, accessibility, and async single-flight actions;
- local Chromium, Firefox, and WebKit Playwright coverage for the complete visible workflow;
- Fallow changed-code analysis and deterministic local verification before merge;
- synchronized English documentation that distinguishes implemented behavior from planned behavior.
