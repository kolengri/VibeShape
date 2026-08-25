# Associative Sketch and Feature Workflow Plan

- Status: **Planned; support and point-reference foundations are partial**
- Reviewed: **2026-08-21**
- Priority: **P0 modeling workflow**
- Scope: same-document Part Studio-style sketch placement, external references, ordered history, and feature creation

## Decision

VibeShape will use an **associative support-frame and reference workflow** for sketches. A sketch is
not positioned primarily by entering an arbitrary world-space transform. It is attached to a stable
origin plane, datum plane, planar model face, or reference coordinate system. Its geometry is then
positioned precisely with dimensions, constraints, projected geometry, intersections, and external
inference from earlier sketches and features.

Sketches and solid/reference features will appear in one ordered **History** list. Bodies remain a
separate result list. The persisted feature DAG stays authoritative for evaluation; the history order
adds the user-readable sequence, insertion cursor, rollback context, and validation boundary. Replacing
the accepted DAG with array-order evaluation is explicitly rejected.

The first complete vertical workflow is:

1. Draw a base sketch and extrude it.
2. Select the extrusion cap directly in the 3D viewport and create another sketch.
3. Keep the earlier model and eligible sketches visible while editing the new sketch.
4. Select a source edge or sketch entity graphically with **Use**.
5. Dimension or constrain new geometry from the projected reference.
6. Edit the base sketch or extrusion and see the dependent sketch and feature rebuild.
7. If a reference can no longer resolve, identify the exact source and require explicit repair.

This workflow is the release gate for declaring sketch-on-feature modeling usable.

## Onshape behavior used as the product baseline

This plan follows Onshape's interaction and dependency principles without copying its implementation,
branding, or visual identity.

| Onshape behavior | Product consequence for VibeShape |
| --- | --- |
| A Part Studio has one ordered Feature list containing sketches and features, plus a separate Parts list. | Show sketches, datum geometry, and modeling features in one History tree; show terminal bodies separately. |
| A sketch starts on one plane, planar face, or mate connector. | Persist a typed support frame. Do not make an unexplained XYZ transform the normal placement workflow. |
| A mate connector supplies a complete origin and axis orientation. | Add a first-class reference coordinate system for cases where a plane alone is insufficient. |
| Feature and sketch inputs are normally selected in the graphics area. | Make viewport selection primary; lists are accessible inspection and fallback surfaces, not the main spatial picker. |
| **Use** projects trackable sketch geometry or model edges into the active sketch. | Persist source selectors and resolve read-only external geometry against the active sketch frame. |
| **Intersection** creates the exact intersection of a selected face or surface with the sketch plane. | Compute analytical/B-Rep intersections in a worker; never infer them from the display mesh. |
| Automatic inferencing can reference eligible external geometry and records an external relation. | Add explicit, visible, suppressible external inference with stable source identity. |
| Editing or rolling back the Feature list shows the model only up to that history position. | Add a history cursor and evaluate the active sketch against earlier context only. |
| Feature rows and viewport geometry cross-highlight; parent and child dependencies are inspectable. | Use one selection model for History, viewport, diagnostics, and dependency inspection. |
| Visibility and suppression are different states. | Keep display toggles presentation-only; suppression remains a semantic history operation. |
| Missing or ambiguous selections are visible feature errors. | Fail closed and provide repair; never select the nearest topology candidate silently. |

Official behavior references:

- [Part Studios](https://cad.onshape.com/help/Content/PartStudio/part_studios.htm)
- [Feature and Parts lists](https://cad.onshape.com/help/Content/PartStudio/features_and_parts_lists.htm)
- [Sketch Basics](https://cad.onshape.com/help/Content/sketch_basics.htm)
- [Use](https://cad.onshape.com/help/Content/Sketch/use.htm)
- [Intersection](https://cad.onshape.com/help/Content/Sketch/intersection.htm)
- [Automatic inferencing](https://cad.onshape.com/help/Content/Sketch/automatic_inferencing.htm)
- [Working with Constraints](https://cad.onshape.com/help/Content/Sketch/working_with_constraints.htm)
- [Plane](https://cad.onshape.com/help/Content/PartStudio/plane.htm)
- [Mate Connector](https://cad.onshape.com/help/Content/Assembly/assembly_mate_connector.htm)
- [Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm)

## Current VibeShape gap

VibeShape already has stable sketch identities, analytical entities, SolveSpace constraints, selected
profiles, exact extrusion, origin planes, signed offset Datum Planes, and stable planar face support.
Those pieces do not yet form a complete associative workflow.

| Capability | Current behavior | Required behavior | Priority |
| --- | --- | --- | --- |
| Sketch history | Sketches and features are stored and presented as separate collections. | One interleaved History sequence with a validated cursor and separate body results. | P0 |
| Evaluation dependencies | The feature DAG does not treat sketches as graph nodes. | One document dependency graph spanning sketch and feature nodes while retaining the feature DAG evaluator. | P0 |
| Sketch support | Origin planes, Datum Plane, and a bounded set of planar feature faces work. | A typed support-frame union with stable origin/orientation and an explicit reference-coordinate-system option. | P0 |
| Support selection | Supported planes and faces can be picked before editing. | The same graphical selection model must work for support replacement and all reference inputs. | P0 |
| Editing context | The normal-to-plane canvas keeps earlier visible solved sketch points, lines, circles, arcs, ellipses, and elliptical arcs as muted context; the mounted 3D scene retains earlier model and datum geometry. Model-tree visibility controls both representations. | Add source hover and overlap cycling. | P0 |
| External references | Points, lines, circles, arcs, ellipses, and elliptical arcs from earlier sketches project analytically across non-degenerate support frames, and ordered sketch-to-sketch chains resolve recursively through the document graph. Stable model vertex, linear-edge, circle-edge, and arc-edge records also resolve through exact rebuild-local geometry without persisting transient topology IDs. | Add non-circular curved feature edges, intersection records, and repair diagnostics. | P0 |
| External selection | Use external geometry selects earlier sketch points, lines, and analytical curves plus visible committed model vertices, linear edges, circles, and circular arcs in 2D or the persistent 3D viewport with source labels. Passive, selectable, and committed layers are mutually exclusive, and renderer-local candidate IDs never persist. | Add non-circular curved feature-topology candidates, source filters, and overlap cycling. | P0 |
| Intersection | Not implemented. | Select a face/surface and create an exact, associative sketch-plane intersection. | P0 |
| External constraints | A projected point supports Coincident; a projected line is selectable and supports compatible line and point-on-line relations. | Add Point on curve, Tangent, Concentric, Pierce/Intersection, and curve dimensions where mathematically valid. | P0/P1 |
| Datum construction | Signed offset only. | Offset, Plane point, Line angle, Point normal, Three point, Mid plane, Curve point, and Tangent modes. | P1 |
| History tools | No rollback cursor, interleaved reorder, or parent/child view. | Rollback, insert-at-cursor, dependency inspection, validated reorder, and suppression. | P0/P1 |
| Extrude references | One stable profile, distance, symmetric state, and New/Add/Remove/Intersect are supported. | Graphical profiles, direction/start references, richer end conditions, second direction, and explicit merge scope. | P1 |
| Repair | Topology resolution fails closed, but the product repair path is incomplete. | Source-owned missing/ambiguous diagnostics with graphical repair candidates. | P0 |

The most important architectural mismatch is the lack of an interleaved document dependency model.
The current `features` array can express feature-to-feature B-Rep dependencies, while sketches live in a
separate ordered array. A sketch can depend on a supporting feature, and an extrusion can depend on a
sketch profile, but that complete cycle-sensitive relationship is not represented by one graph or one
history order.

## Product model

### 1. Ordered History and separate bodies

The Model tree gains these stable groups:

```text
History
  Origin
    XY plane
    XZ plane
    YZ plane
  Sketch 1
  Extrude 1
  Sketch 2
  Extrude 2

Bodies
  Body 1
```

- History contains sketches, reference features, and modeling features in authored presentation order.
- Bodies contain current terminal solid results, not duplicate feature rows.
- Selecting, hovering, renaming, hiding, editing, diagnosing, and deleting a History row and its viewport
  geometry use the same stable owner identity.
- Editing `Sketch 2` places the history cursor immediately after `Sketch 2`. Later features are absent or
  visibly rolled back, never selectable as valid inputs.
- Creating a new operation inserts it at the active cursor. With no rollback, it appends at the end.
- A reorder is accepted only if the resulting presentation order is topologically valid.
- The user can request **Show dependencies** to highlight parents and children in both History and viewport.
- Visibility does not affect evaluation. Suppression is an explicit document command and blocks descendants.

### 2. Document-wide dependency graph

Add a pure document graph with typed nodes:

```text
SketchNode(sketchId)
FeatureNode(featureId)
```

The graph includes:

- feature B-Rep dependency → feature;
- feature support/reference dependency → feature;
- sketch profile source → feature;
- sketch support feature → sketch;
- external sketch entity → sketch;
- external feature topology → sketch;
- future datum point, axis, plane, or coordinate-system source → sketch or feature.

The graph MUST:

- reject missing owners, forward references, self-reference, and cycles;
- expose parents, children, and transitive dependents by stable ID;
- provide a deterministic topological evaluation order separate from presentation order;
- mark dependent sketches and features dirty when a source changes;
- protect deletion using incoming graph edges instead of command-specific scans;
- preserve independent branches when one reference fails;
- remain independent of React, Three.js, persistence, and native geometry.

Feature handlers that consume semantic non-B-Rep sources, such as an extrusion profile, contribute those
dependencies through a trusted typed contract. An extension or MCP client cannot inject arbitrary graph
edges outside its validated schema and ordinary command path.

### 3. Unified sketch support frame

Replace the current `plane` plus optional `support` interpretation with an explicit discriminated support
contract in the next document schema:

```text
SketchSupportFrame
  origin-plane
    plane: xy | xz | yz
  datum-plane
    featureId + semantic datum reference
  planar-face
    stable planar TopoRef
  reference-frame
    stable reference-coordinate-system ID
```

Every resolved support supplies a right-handed frame:

```text
origin: [x, y, z]
xAxis: normalized [x, y, z]
yAxis: normalized [x, y, z]
normal: normalized xAxis × yAxis
```

The persisted record stores identity and orientation intent, never a tessellation face ID, OCCT index,
Three.js object, solved world coordinates, or untracked matrix. Optional flip and quarter-turn orientation
choices are semantic parameters of the support relationship.

For an arbitrary origin or orientation, add a **Reference frame** feature analogous to the useful part of
an Onshape mate connector. It can be defined from stable combinations such as:

- a planar face plus vertex/point origin;
- an edge plus endpoint or midpoint;
- three points;
- a point plus normal and X-direction reference;
- a sketch point and sketch line;
- an existing reference frame plus offsets/rotation.

This is preferable to a free world-space sketch transform because a reference frame retains design intent
and follows its sources. A temporary Transform tool remains appropriate for moving authored geometry
inside the sketch plane.

### 4. External sketch geometry

Generalize the current point-only record into a versioned `ExternalSketchEntity`:

```text
id
schemaVersion
mode: use | intersection | inferred
source
  sketch-entity: sketchId + entityId + sub-element
  feature-topology: featureId + TopoRef
projectionPolicy
resolutionState
```

Only source identity and intent persist. Resolved 2D curves, fixed solver inputs, display paths, candidate
IDs, and native geometry remain disposable worker output.

Supported reference results are analytical point, line, circle, arc, ellipse, elliptical arc, and a
bounded exact spline representation when the solver contract later supports it. Used and intersected
entities are read-only, cannot form a profile by themselves, and have a distinct line style, source icon,
visibility control, and diagnostic state.

Evaluation rules:

1. Resolve the source against the document graph at the active history position.
2. Resolve both source and target support frames.
3. Transform the source into world space.
4. Project or intersect it with the target frame using the declared policy.
5. Produce exact bounded analytical solver input or fail with a typed diagnostic.
6. Cache by source semantic hash, source frame hash, target frame hash, and projection policy.

Ordered point-and-line chains are enabled because the document graph validates earlier-source ordering,
rejects cycles, and gives the worker a deterministic recursive solve order. Diagnostics still need a
complete user-facing provenance path before feature-topology and curved-reference chains are enabled.

### 5. Shared 3D sketch-editing viewport

Sketch mode must no longer feel like a disconnected drawing page. Keep the existing Three.js model scene
alive and layer the analytical sketch interaction surface over it:

```text
Three.js context scene
  earlier feature bodies
  origin and datum geometry
  saved earlier sketches
  active support plane
  preselection and selection

Analytical sketch interaction layer
  active draft geometry
  dimensions and constraints
  inference and external-reference previews
  tool cursors and manipulators
```

The normal-to-sketch orthographic view remains the default, but the user can orbit to inspect the sketch
in context and return with **Normal to sketch**. Sketch points are always computed by ray/plane
intersection against the active support; camera orientation does not change sketch coordinates.

While editing:

- the active plane has a labeled outline and subtle fill;
- earlier saved sketches and model features retain independent visibility;
- later history items are rolled back and cannot be selected as sources;
- model faces, edges, vertices, sketch points, and sketch curves expose hover preselection;
- a selection summary names type, source History row, and resolution stability;
- overlapping candidates can be cycled or chosen from a bounded, labeled candidate list;
- the active selection filter is visible;
- graphical selection is primary, while the task panel lists current selections and provides a keyboard
  equivalent;
- camera motion, selection, dimension editing, and worker rebuilds do not reset the current view.

A single selection broker converts transient viewer hits into stable semantic candidates. The viewer owns
raycasting and preselection only; it never chooses or persists design intent.

### 6. Support and reference interaction

The canonical sketch creation flow is:

1. Start **Create sketch** with no support, or preselect a plane/face/reference frame first.
2. The viewport enters a support selection filter and highlights only eligible candidates.
3. Hover identifies the exact candidate; primary click accepts it.
4. The task panel names the support and its stability class.
5. The editor opens immediately on that support with prior model context still visible.

Inside the active sketch:

- **Use** accepts earlier sketch entities, feature edges, or vertices directly in the viewport.
- **Intersection** accepts an eligible face or surface.
- Hovering an external candidate previews the projected/intersection result before click.
- Placement and dragging can wake external candidates and show the relation glyph before acceptance.
- `Shift` suppresses automatic inference without hiding explicit Use or Intersection selections.
- The external-reference manager filters Internal, External, Missing, Ambiguous, and Conflict states,
  cross-highlights the source and dependent entities, and supports removal or repair.
- Replacing the sketch support is an explicit command with a full preview and reference compatibility
  report. It never silently reinterprets local coordinates.

### 7. Datum and reference geometry

The existing signed offset Datum Plane remains the first mode. Extend the same first-party reference
geometry owner in this order:

1. **Mid plane** between two parallel planes/faces.
2. **Plane point** through a point and parallel to a plane/face.
3. **Line angle** through an edge/axis/sketch line with a variable-ready angle.
4. **Point normal** through a point normal to an edge/axis/sketch line.
5. **Three point** plane.
6. **Curve point** normal to a curve at a selected point.
7. **Tangent** plane to a supported analytical surface with an orientation reference.
8. Datum Point, Datum Axis, and Reference frame as first-class reference results.

All inputs are selected graphically, use stable selectors, remain independently visible, and are excluded
from manufacturing bodies and export.

### 8. Feature creation parity after the sketch foundation

Extrude remains the first feature consumer. Complete its selection and termination contract after the
support/reference slices:

- select one or more stable sketch regions graphically;
- operation: New, Add, Remove, Intersect;
- explicit target/merge scope for modifying operations;
- end: Blind, Symmetric, Through all, Up to next, Up to face, Up to part, Up to vertex;
- optional start offset from sketch plane or selected entity;
- optional direction reference and flip;
- optional second direction with independent end condition;
- exact preview and stable input summary before Apply.

Each entity end condition persists a stable selector and fails closed. A numeric distance is not silently
substituted when an entity reference breaks.

## Ownership and dependency direction

No new generic utility package or installable extension owns this capability.

| Layer | Ownership |
| --- | --- |
| `packages/domain` | History item schema, document dependency graph, support/reference selectors, constraints, deletion/reorder validation, typed diagnostics |
| First-party sketching module | Sketch support and external-reference schemas, commands, eligibility, migrations, and product tool descriptors |
| First-party reference-geometry module | Datum Plane, Datum Point, Datum Axis, and Reference frame feature contracts |
| First-party part-design module | Extrude selection and end-condition contracts |
| `packages/document-worker` | Deterministic evaluation order, support-frame resolution, external-geometry preparation, caching, and disposable display results |
| Geometry worker/adapter | Exact B-Rep edge projection, face intersection, topology candidates, feature construction, and deterministic native disposal |
| Viewer | Raycasting, hover preselection, render layers, and transient hit-to-candidate data |
| `apps/web` | Command workflow, selection filters, task panels, accessible tree/list equivalents, localized diagnostics, and scoped UI state |

Dependency direction remains:

```text
web UI -> application commands -> domain records
document worker -> domain/application contracts -> geometry port
geometry adapter -> OCCT
viewer <- serializable derived geometry
```

React, Three.js, Zustand, persistence, and OCCT do not enter `packages/domain`. The editor-session Zustand
store may own the active selection, history cursor presentation, active tool, and transient visibility,
but it does not own committed history, semantic references, solved geometry, or worker caches.

## Document evolution

This direction changes the native history model. The accepted
[document dependency and interleaved History decision](../adr/0026-document-dependency-graph-and-interleaved-history.md)
defines:

- the interleaved `HistoryItemRef` schema and document schema version;
- the document-wide sketch/feature dependency graph;
- how feature handlers declare semantic sketch dependencies;
- rollback and insertion semantics;
- migration from the separate `sketches` and `features` arrays;
- protocol version changes for resolved support and external geometry;
- archive compatibility and deterministic replay.

Legacy migration uses full verified event order when available. If that prefix is missing, corrupt,
inconsistent with the selected valid snapshot, or absent from a snapshot-only archive, migration performs a
stable topological merge using existing feature dependencies, sketch support, extrusion profile sources,
external sketch sources, and existing array order as the final tie-breaker. The merge changes only
presentation order, is reported as snapshot-derived degraded recovery, and never retargets a reference or
changes evaluation identity. Documents with an impossible graph fail import with a bounded diagnostic.

The accepted feature DAG and `TopoRef` decisions remain in force. ADR-0026 extends them; it does not
rewrite old decisions in place.

## Delivery plan

### Slice 0A — non-authoritative document graph foundation

- Add the history/dependency ADR.
- Build a pure document graph spanning sketches and features.
- Add bounded cycle, missing-owner, forward-reference, stable-order, and relation-query tests.
- Keep persistence, command behavior, worker protocols, and visible product behavior unchanged.

**Exit:** the pure graph contract is tested and available to later slices, but is not yet authoritative for
deletion, reorder, scheduling, persistence, or UI eligibility.

### Slice 0B — command and replay integration

- Validate the document graph after candidate command reduction and during replay.
- Replace command-specific deletion checks with graph-owned incoming-dependency checks.
- Project sketch changes through document relations into feature dirty roots.
- Add command, replay, deletion-blocking, rollback, and failure-isolation tests.

**Exit:** document mutation and replay share one dependency authority without changing the persisted schema.

### Slice 0C — versioned History migration

- Add persisted `HistoryItemRef` ordering and explicit semantic-input declarations.
- Add deterministic migration from complete legacy journals and snapshot-topological degraded recovery when a
  complete verified journal prefix is unavailable, corrupt, or inconsistent.
- Add old-format, corrupt-prefix, late-snapshot recovery, archive round-trip, and exact-replay fixtures.
- Add revisioned History insertion and reorder commands only after the migration matrix passes.

**Exit:** every schema-version-1 document has one validated interleaved History order, while recoverable legacy
documents remain openable without changing geometry or overwriting their source records prematurely.

### Slice 1 — understandable History and editing context

Status: in progress. The context layer keeps the same Three.js viewport mounted across Model/Sketch
transitions and resolves the active sketch's exact support frame for origin planes and the currently
supported planar feature and Datum Plane roles. Normal mode aligns the existing orthographic camera to that
frame and leaves pointer ownership with the transparent analytical sketch surface. **Orbit 3D view** hides
and makes that surface inert, switches the viewer to camera-only interaction, and displays the unsaved solved
draft in world coordinates beside the model and reference geometry. While **Use external geometry** is
active, earlier eligible sketch points and lines remain graphically selectable in orbit mode with hover
preselection and source labels; selection creates the same stable reference used by the normal-to-sketch
drawing and task panel. Normal mode also renders every visible earlier analytical sketch curve as muted,
non-interactive context; center points use a distinct square marker rather than appearing as duplicate
circles. Cross-support point and line references are transformed through exact source and target frames
before solve, and valid ordered reference chains recursively solve their earlier source intent. **Normal to sketch** restores the exact
support-aligned editing view without recreating the viewer or changing the draft, local history, profile, or
selection. Graphical curved/feature source selection, History rollback, and bounded candidate cycling remain
open parts of this slice.

- Replace separate Sketches/Features presentation with History plus Bodies.
- Add cross-highlighting, support/source summaries, parent/child inspection, and distinct visibility states.
- Add a history cursor and rollback presentation while editing an earlier sketch or feature.
- Keep the Three.js context scene mounted under the analytical sketch interaction layer.
- Show earlier bodies, datum geometry, and saved sketches during sketch edit. Implemented for solved
  analytical sketch context and model-tree visibility.
- Add Normal to sketch and orbit-in-context. Implemented for resolved support frames with a temporary
  world-space display of the active draft.
- Add a visible selection filter and bounded candidate cycling.

**Exit:** a user can identify where a sketch exists, what supports it, and which earlier objects are
eligible without leaving the viewport.

### Slice 2 — complete sketch-to-sketch Use (implemented for analytical entities)

- Generalize the point-only schema to analytical sketch entities. Implemented.
- Keep cross-support point selection and add graphical source-curve selection. Implemented in 2D and
  the persistent 3D context.
- Project read-only line, circle, arc, ellipse, and elliptical-arc references. Implemented with exact
  affine projection and stable projected identities.
- Add supported external relations and the external-reference manager. Relations and removal are
  implemented; dedicated repair UI remains open.
- Extend graph-protected ordered reference chains and provenance validation to analytical curves.
  Implemented with recursive source solving and fail-closed type/rank validation.
- Add source visibility, hover preview, remove, missing, and conflict states.

**Exit:** a layout sketch can associatively drive a detail sketch on the same support frame.

### Slice 3 — model edge Use and cross-frame projection

- Add stable edge and vertex selection from feature topology candidates.
- Project eligible analytical feature edges into any resolved target sketch frame.
- Add source-frame/target-frame transform caching and repair diagnostics.
- Preserve stable semantic roles through supported primitive and extrusion changes.
- Reject unsupported or ambiguous topology without creating a draft reference.

**Exit:** a sketch on an extrusion cap can Use its boundary edges and remain associated after upstream
dimension changes.

### Slice 4 — Intersection and external inference

- Add exact plane/face and plane/surface intersection preparation in the geometry worker.
- Represent supported results analytically and provide Intersection/Pierce relations.
- Wake eligible external points, curves, and directions during placement and drag.
- Add `Shift` suppression, deterministic candidate ranking, and visible relation previews.

**Exit:** cross-plane ribs, holes, and locating geometry can be constrained from existing solids without
manual coordinate duplication.

### Slice 5 — reference frames and complete Datum Plane modes

- Add Reference frame, Datum Point, and Datum Axis semantic features.
- Add Mid plane, Plane point, Line angle, Point normal, Three point, Curve point, and Tangent planes.
- Select every input in the viewport with a synchronized accessible selection list.
- Support flip, orientation, and variable-ready offsets/angles without persisting raw matrices.

**Exit:** a sketch can be located and oriented from stable design references wherever a planar face alone
is insufficient.

### Slice 6 — committed history operations and repair

- Insert at the rollback cursor, suppress/unsuppress, and reorder with graph validation.
- Add committed command-level undo/redo for history changes.
- Add graphical missing/ambiguous reference repair with before/after preview.
- Keep the last valid geometry only as explicitly stale, non-authoritative context.

**Exit:** editing early design intent either rebuilds correctly or identifies the exact broken downstream
reference and a bounded repair action.

### Slice 7 — richer Extrude inputs and end conditions

- Add multi-profile selection and merge scope.
- Add Through all, Up to next/face/part/vertex, start offset, direction reference, and second direction.
- Use the shared viewport selection broker and stable selector diagnostics.
- Preserve one preview/Apply command path for UI, extensions, and future MCP proposals.

**Exit:** ordinary printable brackets, enclosures, ribs, bosses, and through-cuts no longer require direct
primitive workarounds.

## Required acceptance scenarios

### A. Face-supported hole

1. Create a constrained rectangle on XY and extrude it as a new body.
2. Select the top cap in the viewport and create a sketch.
3. Use two cap edges, constrain a circle center by distances from them, and remove material with Extrude.
4. Change the base width, height, and extrusion distance.

Expected: the support frame, projected edges, circle location, and cut rebuild. No world coordinate or
transient face index is persisted.

### B. Layout-driven detail

1. Create a construction layout sketch with centerlines and variable dimensions.
2. Create a second sketch on the same support.
3. Use a line, circle, and point from the layout and constrain a printable outline from them.
4. Change the layout variables.

Expected: external geometry and downstream solid update; the dependent sketch remains editable and clearly
identifies every external source.

### C. Cross-plane rib

1. Create and extrude a base body.
2. Create a mid-plane through the body.
3. Create a sketch on the mid-plane and intersect the body faces.
4. Constrain and extrude a rib with Add.

Expected: the intersection and rib follow the body and plane. Unsupported topology fails visibly.

### D. Reference-frame placement

1. Create a reference frame at a selected feature vertex with X aligned to a selected edge.
2. Start a sketch on that frame.
3. Change the upstream feature dimensions.

Expected: the sketch origin and orientation follow the semantic references without storing a detached
world transform.

### E. History rollback and insertion

1. Roll back before a downstream cut.
2. Insert a new sketch and feature.
3. Restore the end cursor and inspect dependencies.
4. Attempt an illegal reorder that would place a dependency after its consumer.

Expected: the inserted branch rebuilds deterministically, and the invalid reorder is rejected with a
specific parent/child explanation.

### F. Reference failure and repair

1. Use a stable extrusion edge in a dependent sketch.
2. Change the upstream profile so the semantic edge disappears or becomes ambiguous.
3. Open the dependent sketch and choose a valid replacement candidate.

Expected: VibeShape never binds automatically to a merely nearby edge. The owning History row, stale
reference, dependents, and repair candidates are all cross-highlighted.

## Verification contract

Every slice includes the smallest relevant deterministic suite:

- domain schema, migration, graph, command, deletion, reorder, and cycle tests;
- property tests for stable ordering and reference failure under source edits;
- document-worker frame, projection, caching, dirty propagation, restart, and stale-result tests;
- geometry-worker exact projection/intersection and native ownership tests;
- topology corpora for resolved, missing, ambiguous, split, suppressed, and restored sources;
- component tests for task-panel selection state, keyboard paths, focus, and localized diagnostics;
- Chromium Playwright flows for the acceptance scenarios above;
- save/reload, `.vshape` round-trip, interrupted recovery, and worker restart;
- camera-preservation, pointer-centered zoom, and sketch-drag performance checks;
- Fallow changed-code audit for every TypeScript, TSX, CSS, or manifest slice.

Interaction budgets:

- hover and preselection do not perform document parsing, solving, or B-Rep work;
- raw pointer samples remain outside the global Zustand store;
- reference projection does not run on a camera-only change;
- a sketch drag does not rebuild the document graph or recreate the Three.js scene;
- external resolution is cached by semantic source and frame identities;
- camera orbit, pan, and zoom remain responsive while the worker evaluates geometry.

## Explicit non-goals for the first release

- Free-space 3D sketch entities.
- Cross-document Derived references.
- Assembly in-context references and context snapshots.
- Mesh-derived or approximate semantic references.
- Automatic topology repair or nearest-candidate substitution.
- Arbitrary NURBS projection before a bounded analytical/solver representation exists.
- Public extension or MCP mutation contracts before the first-party workflow is stable.

## First implementation target

Implementation should begin with **Slice 0 and Slice 1**, then immediately deliver the face-supported hole
scenario through **Slice 3**. Completing more isolated sketch drawing tools before this path works would
increase surface area without fixing the user's ability to build a dependent parametric model.

The short-term success criterion is not feature count. It is that a user can select an extrusion face,
see the relevant existing model while sketching, project an edge, constrain new geometry from it, edit the
upstream model, and understand the resulting rebuild or failure from the History tree and viewport.
