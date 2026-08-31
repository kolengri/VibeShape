# Feature specification

## Priorities

- **P0 / alpha:** required to prove the core workflow.
- **P1 / v1:** required for regular practical use.
- **P2 / later:** expansion after the core is stable.
- **Out:** intentionally outside the foreseeable scope.

## Projects and local-first behavior

| Capability | Priority | Completion condition |
|---|---:|---|
| Local project library | P0 | Card, preview, timestamp, duplicate, and confirmed deletion |
| Autosave and crash recovery | P0 | Transaction journal restores the latest confirmed command |
| `.vshape` import/export | P0 | Round-trip without losing parametrics |
| Save/Open through system picker | P1 | Progressive enhancement with mandatory download/upload fallback |
| Named snapshots/versions | P1 | Immutable snapshot with restore |
| Branching and merge | P2 | Only after a formal operation-conflict model exists |
| Cloud synchronization | P2 | Separate opt-in adapter, never a core dependency |

The implemented persistence foundation immediately saves each accepted command through the transactional repository, recovers an interrupted page, and rebuilds the same variable-driven model after clean reopen in Chromium, Firefox, and WebKit. The project-library slices list bounded, strictly validated local summaries with exact-revision derived SVG previews or accessible placeholders; support persistent revisioned project rename, new-project creation, and switching by stable document ID; duplicate replay-verified semantic history under fresh document and command identities; and permanently delete an explicitly confirmed inactive project through an exact-revision, live-lease-checked transaction. `.vshape` v0 now downloads and opens the exact semantic snapshot plus full event journal without losing the project name, stable variable IDs, formulas, or feature parameter sources. Import verifies structure, checksums, schemas, and replay before atomic publication and never overwrites an existing document ID. This does not yet satisfy the complete project-library row above: active-project deletion and richer storage-state presentation remain open, alongside debounced editor commit policy, same-ID restore/copy UX, format migrations, backup prompts, bulk export, multi-tab ownership UX, and installed-build update handling.

## Viewport and navigation

| Capability | Priority | Notes |
|---|---:|---|
| Orbit, pan, zoom, fit, standard views | P0 | Predictable CAD mouse and trackpad presets |
| Perspective and orthographic modes | P0 | Orthographic by default in sketch mode |
| Body, face, edge, and vertex selection | P0 | Selection filters and hover preselection |
| Shaded, edges, and wireframe modes | P0 | No CAD retessellation required |
| Grid, axes, and origin planes | P0 | Visible units and grid spacing |
| Section/clipping plane | P1 | One interactive plane |
| Exploded view | P2 | Depends on assemblies |
| WebGPU renderer | P2 | Experimental adapter, not the baseline |

The first product viewport displays terminal authoritative meshes and selectable translucent Datum Plane reference geometry from a successful document rebuild through raw Three.js `0.185.1` and WebGL2. It provides shaded faces, derived feature edges, Z-up orthographic orbit/pan/zoom, automatic fit, an explicit Fit view action, responsive sizing, localized states, face preselection, exact rendered-face selection, accessible selection summaries, deterministic GPU disposal, and independent feature/datum visibility. Color-coded XY, XZ, and YZ origin planes remain visible by default, can be toggled independently, and can be selected before **Create sketch** so the command enters editing directly on that support. Command-first creation still supports viewport picking and the synchronized accessible select. A model face takes pointer-selection priority over an origin plane, and hiding a selected origin plane clears the transient selection. Rendered face IDs remain transient; persistent face and datum support use semantic `TopoRef` records. Standard view presets, perspective switching, body/edge/vertex picking, selection filters, general stable-selection repair, display-mode switching, clipping, and render-performance budgets remain open P0/P1 work.

## Sketcher

| Capability | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Point, line/polyline, rectangle | ✓ |  |  |
| Circle, center-point arc | ✓ |  |  |
| Three-point arc |  | ✓ |  |
| Elliptical arc |  | ✓ |  |
| Midpoint line, center/aligned/centered-aligned rectangle, three-point circle, tangent arc |  | ✓ |  |
| Construction geometry | ✓ |  |  |
| Trim and extend |  | ✓ |  |
| Straight, centered, and selected-line slot |  | ✓ |  |
| Polygon, full ellipse, spline |  | ✓ |  |
| Project/use edge |  | ✓ |  |
| Text and SVG contours |  | ✓ |  |
| Offset sketch entities |  | ✓ |  |
| Sketch patterns and mirror |  | ✓ |  |
| 3D sketch |  |  | ✓ |

Required P0 constraints:

- coincidence;
- horizontal/vertical;
- parallel/perpendicular;
- equal;
- tangent;
- concentric;
- midpoint and symmetric;
- point-on-line/curve;
- fixed;
- horizontal, vertical, and general distance;
- angle;
- radius/diameter.

The solver MUST report `under-constrained`, `fully-constrained`, and `over-constrained`, including the conflicting constraint set where possible. Automatically deleting constraints without confirmation is prohibited.

The implemented domain boundary covers every listed analytical entity and P0 constraint schema, variable-backed dimensions, exact-revision worker solving, continuation and drag, conflict IDs, deterministic endpoint-connected line, circular-arc, elliptical-arc, and circle profiles plus standalone exact full-ellipse profiles with outer, hole, and island nesting, and stable boundary selectors that fail closed on missing or ambiguous resolution. The product editor authors Point, Line/Polyline, Midpoint Line, corner Rectangle, Center Rectangle, Aligned Rectangle, Centered Aligned Rectangle, center-point and three-point Circle, Center-point Ellipse, Elliptical Arc, center-point, three-point, and Tangent Arc, Straight Slot, Centered Slot, and Slot from selected line, plus Construction geometry on XY, XZ, or YZ; supports the complete [mandatory sketch precision toolset](sketch-toolset.md), including Midpoint and Symmetric, selection-driven icon constraints and dimensions, selectable drawing glyphs, direct selected-line length dimensions, stable-identity dimension editing, constraint removal, point dragging, cascade deletion, local undo/redo, pan, zoom, live SolveSpace state, and visible solver conflicts; and preserves stable entity, constraint, plane, expression, and user-authored sketch-label identities through Finish, edit, rename, variable refactor, and reload. Center-point Ellipse stores a center and two perpendicular stable axis endpoints, renders one exact rotated analytical curve, and supports direct axis-point resizing, exact profile selection, Transform, Mirror, patterns, and extrusion. Elliptical Arc adds exact start and end loci through solver-owned trammels, follows the four-pick Onshape-oriented construction-ellipse workflow, participates in profiles, Transform, Mirror, patterns, and extrusion, and supports exact Trim, Split, and Extend against bounded line intersections while preserving retained identity and shared stable axes. Selecting either ellipse type now exposes variable-ready Primary axis diameter and Secondary axis diameter constraints; authored axis identity remains stable even when their relative lengths cross. Center Rectangle can reuse an inferred stable center point, shows a symmetric two-click preview, stores construction diagonals outside profile extraction, and records one undoable draft edit. Aligned Rectangle accepts a first side and signed perpendicular-width pick, then stores the four analytical sides with perpendicular and parallel intent in one edit. Centered Aligned Rectangle accepts a center, symmetric half-axis, and signed perpendicular half-width pick, then persists one construction axis plus three midpoint relations in one edit. Straight Slot accepts two centerline endpoints and a signed half-width; Centered Slot mirrors the centerline around its first center pick; Slot from selected line reuses exactly one selected line as its construction centerline. Every variant creates two analytical line sides and two analytical semicircular end caps. The endpoint topology and arc equations imply the end-cap tangency and equal radii; one nonredundant parallel constraint retains the boundary orientation without making SolveSpace report an over-constraint. Three-point Arc reuses inferred stable endpoints, renders the exact positive-sweep circumcircle preview after the second click, rejects collinear input, and records one undoable analytical arc edit. Tangent Arc requires an existing line endpoint, computes its analytical center from the authored tangent direction, stores a shared endpoint plus tangent constraint, and returns to Line after one edit. Point and line placement plus point dragging provide deterministic existing-point, line and positive-sweep circular-arc midpoint, bounded segment-intersection, point-on-line, distant horizontal/vertical point-alignment, exact circle or bounded-arc quadrant, full-ellipse quadrant and perimeter, and positive-sweep elliptical-arc perimeter inference; arc midpoints persist one dedicated constraint, follow endpoint edits, and win over a coincident quadrant; quadrants preserve point-on-curve intent plus center alignment. Line additionally persists horizontal, vertical, parallel, perpendicular, or endpoint-tangent intent. `Shift` suppresses inference, and drag inference/render work is limited to the latest sample per animation frame. The drag hot path sends the unchanged validated sketch plus a separate target instead of cloning or reparsing the full record on every sample. Ordinary drafts stream bounded exact dependent-geometry updates, dense drafts request them only after a pointer pause, and very dense drafts solve only on release; every mode keeps at most one solve in flight and one latest pending target. The viewport renders inference and applied-constraint glyphs plus authored dimension expressions. Saved sketches can be renamed from their model-tree icon or `F2` without changing geometry identity; Rename is blocked only while the same sketch draft is being edited. Solver-produced closed regions are selectable by stable boundary identity, including multiple profiles and holes, and one selected profile can drive exact new/add/remove/intersect extrusion. Automatic wake-up from visible earlier sketches and uniquely resolved coplanar model vertices, lines, circles, bounded circular arcs, full ellipses, or bounded elliptical arcs is implemented for Point and Line placement and for dragging an existing authored point. Acceptance atomically materializes one stable external reference plus the inferred relation; `Shift` suppresses the disposable candidate, and analytical drag candidates use a prebuilt spatial index instead of scanning every curve per pointer frame. Horizontal and vertical point alignment, curve quadrants, arc midpoints, and exact ellipse loci can materialize external point and curve identities without activating Use or duplicating one persisted curve reference. Non-coplanar or non-analytical model-topology wake-up, general projected geometry, curve-chain slots, ellipse-axis and offset reference measurements, remaining round and ellipse modification boundaries, guided conflict repair, and interior-intersection splitting remain open.

Visible earlier sketch points and analytical curves now remain as muted normal-view context during downstream sketch editing and obey model-tree visibility. Curve centers use fixed-screen crosshair controls that cannot be mistaken for duplicate geometry. **Use** promotes earlier points, lines, circles, arcs, ellipses, and elliptical arcs plus exact model vertices, linear edges, circles, circular arcs, ellipses, and elliptical arcs in the normal or persistent 3D view. Model candidates come only from visible committed bodies; normal view projects them analytically onto the active support, while orbit view samples their exact world-space definition only for display and hit testing. The persisted reference keeps a stable semantic role, unambiguous lineage, geometric signature, expected source type, and projected identities instead of renderer-local candidate IDs, samples, or coordinates. Analytical curves project exactly across non-degenerate support-frame transforms, retain stable source and projected identities, and recursively resolve earlier solved source intent through the document graph. Used geometry replaces its passive or selectable overlay with one read-only referenced presentation. When normal-view Use candidates overlap, a bounded labeled chooser commits only the graphically chosen stable source. Compatible model-backed and sketch-backed references can be replaced graphically while preserving reference, projected-entity, and constraint identities across save and reopen. A source-entity edit may leave persisted broken intent; the dependent sketch labels the missing geometry explicitly and filters replacement picks to compatible earlier-sketch candidates. Sketch support can likewise be replaced graphically with an earlier origin plane, Datum Plane, or supported planar face while preserving the complete authored sketch and one-step local undo. Constraint annotations resolve anchors from both authored entities and solved read-only projected geometry. Relations that consume a projected identity remain selectable, carry a link marker and external-relation accessible name, and use the semantic reference-context color after Finish and reopen. Spline and other non-analytical feature-edge Use, general ambiguous-reference repair, and multi-link chain failure navigation remain open.

Selection-first **Pierce** is implemented for an authored point and a visible earlier-sketch line on a
different support. The orbitable picker exposes only finite lines with one exact transverse crossing, stores
stable source-line and projected-point identities, adds Coincident, and recomputes the crossing after source
edits and reopen. Parallel, coplanar, degenerate, and outside-segment cases fail closed. Curved and model-edge
Pierce remain open.

Saved-sketch visibility is transient presentation state rather than authored model intent. Each saved sketch has an independent icon-only Show/Hide action. The model-tree header and the shared `Shift+H` command toggle every current saved sketch without changing document semantics, suppression, rollback, or the active editable draft; individual visibility can then be overridden again. The same state filters analytical normal-view context and saved Three.js orbit displays without duplicating geometry.

The exact ellipse inference slice extends the sketch baseline above: authored full ellipses,
earlier-sketch full ellipses, and uniquely resolved coplanar model circles projected as ellipses expose
all four exact axis extrema and the complete analytical perimeter. Quadrant acceptance persists the selected
primary or secondary axis plus positive or negative side, so a later axis reversal cannot switch the intended
endpoint. Generic perimeter acceptance persists one exact Point on ellipse locus. Authored and earlier-sketch
elliptical arcs expose only their positive bounded sweep and persist one exact Point on elliptical arc locus.
Both perimeter relations are also available deliberately by selecting one point and the compatible curve and
invoking Point on curve.

## Parametric 3D features

| Operation | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Extrude: new/add/remove/intersect | ✓ |  |  |
| Revolve: new/add/remove/intersect | ✓ |  |  |
| Boolean union/cut/common | ✓ |  |  |
| Fillet/chamfer | ✓ |  |  |
| Mirror feature/body |  | ✓ |  |
| Linear/circular pattern |  | ✓ |  |
| Shell |  | ✓ |  |
| Sweep/pipe |  | ✓ |  |
| Loft |  | ✓ |  |
| Draft, split, replace face |  |  | ✓ |
| Direct face move/delete |  |  | ✓ |
| Surface modeling |  |  | ✓ |

Every feature requires:

- a stable `FeatureId`;
- typed parameters with units;
- inputs referenced through `TopoRef`/`EntityRef`;
- `active`, `suppressed`, or `error` state;
- a diagnostic message;
- a deterministic input hash;
- atomic apply and cancel behavior.

Persisted feature labels are editable through an icon-only model-tree action and `F2`. Rename uses the ordinary revisioned feature-update path, retains the stable feature ID and complete parameter/reference payload, and survives browser reload and `.vshape` round-trip.

The first sketch-driven operation implements exact new/add/remove/intersect extrusion from a stable `SketchProfileSelector`. The semantic feature stores the selector, a literal or `#variable` distance `Quantity`, symmetric state, and operation intent. An origin plane, a stable planar-face `TopoRef`, or a first-class signed offset Datum Plane supplies the sketch frame. The initial model-face support set covers every planar Box face, Cylinder cap, recursively resolved Extrusion cap, and `datum.plane`; unsupported or missing topology fails closed. `New` has no B-Rep body dependency but may have support evaluation dependencies, while every modifying operation stores exactly one explicit terminal-feature target plus any distinct support dependency. Each rebuild solves the referenced sketch once, resolves the selector and support fail-closed, and passes bounded transient analytical curves plus an exact right-handed frame to geometry protocol v12. The same protocol publishes rebuild-local exact vertex, linear-edge, circle-edge, arc-edge, ellipse-edge, and elliptical-arc-edge geometry for fail-closed model references without persisting transient topology IDs. The sketcher exposes those records graphically in normal and orbit views and persists only stable `TopoRef` intent. OCCT creates one exact prism, then applies Fuse, Cut, or Common for a modifying operation. The product supports operation and target editing, variable-driven rebuild, preview, reload, and dependency-safe deletion. Datum Plane features accept an origin plane or selected supported face, retain signed literal or `#variable` offsets, rebuild dependent sketches, render as selectable translucent reference geometry with independent visibility, and remain excluded from body ownership, project thumbnails, and STEP/STL/3MF export. Multi-profile feature input, spline and other non-analytical curved model references, additional datum construction modes, and general topology repair remain open. See [ADR-0019](../adr/0019-selector-backed-new-body-extrusion.md), [ADR-0023](../adr/0023-explicit-target-extrusion-operations.md), [ADR-0024](../adr/0024-stable-planar-face-sketch-support.md), and [ADR-0025](../adr/0025-first-class-offset-datum-planes.md).

The bounded support set now also includes line-generated planar Extrusion sides. A side support persists `extrusion.side.<sourceEntityId>`, resolves that role against current evaluated topology, requires one uniquely resolved planar candidate with an oriented normal, and derives its deterministic right-handed frame by projecting the persisted selection near-point onto the current plane. Tangential face growth therefore does not drift existing sketch coordinates. No mesh face ID or OCCT face order persists. Arbitrary unannotated planar B-Rep support remains out of scope until it has an equally durable identity and repair contract.

Exact Revolve uses one stable selected sketch profile around the sketch support frame's X or Y origin axis. It retains a literal or `#variable` angle from greater than zero through a full revolution, reuses the deterministic outer/hole profile materialization from Extrude, and passes only transient world-axis and analytical-loop data to the geometry worker. `New` creates an independent body; `Add`, `Remove`, and `Intersect` retain one explicit terminal-feature target as the first ordered dependency plus any distinct sketch-support dependency. OCCT builds one disposable revolved tool and applies Fuse, Cut, or Common for a modifying operation. The single-solid, positive-volume invariant rejects invalid, axis-crossing, disjoint, or empty results without replacing the last valid derived model. Create and edit expose operation and cycle-safe target selection with reactive preview, single-flight submission, History identity, reload, and dependency-safe deletion. Version-1 new-body records remain readable, while new and edited features use the version-2 explicit-target contract. Arbitrary selected axes, multi-body merge scope, additional end conditions, stable Revolve output roles, and sketch support on Revolve faces remain open. See [ADR-0028](../adr/0028-selector-backed-origin-axis-revolve.md) and [ADR-0030](../adr/0030-explicit-target-revolve-operations.md).

## Variables and expressions

P1 includes:

- named document variables;
- arithmetic with `+ - * / ^` and parentheses;
- literals using `mm`, `cm`, `m`, `in`, `deg`, and `rad`;
- `min`, `max`, `abs`, `round`, `sin`, `cos`, and `tan`;
- dimensional checking: a length cannot be added to a dimensionless number;
- cycle detection;
- `.` as the serialized decimal separator, with localized UI input.

Arbitrary JavaScript is prohibited in documents. Native files must not be executable.

The implemented foundation is intentionally narrower: document variables have stable UUIDv7 identity, case-sensitive ASCII names, arbitrary DAG dependencies, `#name` references, unit literals, unary signs, `+ - * /`, parentheses, dimensional checking, cycle detection, revisioned add/update/remove/rename and whole-table replacement commands, persistence acceptance, interrupted-page recovery, clean save/reopen rebuild, and document-worker recovery. Revisioned project preferences select any supported length display unit (`um`, `mm`, `cm`, `m`, `in`, or `ft`) and angle display unit (`deg` or `rad`) without changing canonical millimeter/radian geometry. The preference survives reload and `.vshape` round-trip, converts derived values and new-field defaults, and makes the active unit explicit when a dimensionally known field commits a bare numeric literal. The product Variables panel provides a semantic table, an uncontrolled raw-input contract with TanStack Form integration, live resolved results in the current project unit, adjacent validation, referenced-removal protection, async single-flight Apply, and an explicit async rename mode. Rename preserves the variable UUID and atomically refactors exact references in variable formulas and project Quantity feature parameters before IndexedDB persistence and geometry rebuild. Shared state-agnostic parameter and sketch-dimension fields keep presentation independent of form state, while Box, Cylinder, Sketch Dimension, and Extrusion TanStack Form adapters preserve authored Quantity expressions, resolve literals or committed `#variables`, report adjacent dimensional/range errors, guard asynchronous double submission, and serve their owning create or edit workflow. Direct Box and Cylinder records additionally store an authored `{ x, y, z }` placement origin. Old records normalize to the world origin; new and edited records preserve signed literals or `#variables`, include resolved placement in geometry identity, and rebuild OCCT geometry at that exact position. Non-centered height starts at placement Z, while centered height straddles it. Feature creation emits the ordinary persisted feature-add command. The interactive sketcher creates a complete transient analytical draft through pure domain operations, solves it through document protocol v17, and commits only on Finish through the ordinary sketch-add or sketch-update command. Activating an existing record restores exact entity, constraint, plane, and expression identities. Centered primitive state and placement, sketch geometry, compound line-chain Offset intent and dimensions, and extrusion selector/symmetric state are retained through edit and reload. The product Boolean/Subtract workflow selects ordered target and tool solids through a native uncontrolled select composition and separate TanStack adapter, excludes duplicate and cycle-forming inputs, persists the two dependency slots through the same add/update path, and restores them after reload. An edit task can remove a leaf feature through the ordinary revisioned destructive command; direct dependents block removal with their visible labels, and the controlled AlertDialog closes only after persistence and rebuild succeed. Referenced sketches cannot be removed until their extrusion features are removed. The removal events retain exact prior records for tamper-resistant replay, while the geometry worker prunes any native shape not represented by a successful current content hash. Every implemented mutation rebuilds only after semantic persistence, while geometry reuse compares resolved values, prepared sketch-profile content, and ordered dependency hashes. Interactive primitive manipulators, arbitrary primitive rotation, Boolean union/common, exponentiation, functions, compound dimensions, localized authoring, declared extension refactor contributions, committed document undo/redo, and spreadsheet-style interaction remain P1 completion work. See [ADR-0015](../adr/0015-document-variables-and-dimensional-expressions.md), [ADR-0017](../adr/0017-atomic-variable-rename-and-reference-refactor.md), [ADR-0019](../adr/0019-selector-backed-new-body-extrusion.md), and [ADR-0022](../adr/0022-project-display-unit-preferences.md).

## Bodies, parts, and assemblies

| Capability | Priority |
|---|---:|
| Multiple bodies in one document | P0 |
| Visibility, color, name, material label | P0 |
| Multi-body boolean | P0 |
| Components/instances | P1 |
| Simple rigid transforms | P1 |
| Assemblies and mates | P2 |
| BOM | P2 |
| Drawings | P2 |

## Measurement and analysis

- P0: point-to-point and minimum distance, edge length, angle, radius/diameter, face area, body volume, bounding box, and center of mass.
- P0: OCCT shape validity and closed-solid checks.
- P0: mesh manifoldness, inverted/degenerate triangles, and disconnected shells.
- P1: approximate minimum wall, minimum hole/feature, overhang visualization, build-volume collision, and clearance/interference.
- P2: tolerance stack, draft analysis, material-density mass, and basic FEA adapter.

A printability warning is a heuristic, not a guarantee of a successful print.

## Import and export

| Format | Import | Export | Role |
|---|---:|---:|---|
| `.vshape` | P0 | P0 | Parametric native project |
| STEP AP242/AP214 | P0 | P0 | Exact B-Rep exchange |
| Binary STL | P0 | P0 | Mesh compatibility |
| 3MF Core | P1 in alpha, P0 for v1 | P0 | Primary printing exchange |
| SVG/DXF 2D | P1 | P1 | Sketches and templates |
| OBJ/glTF | P2 | P2 | Visual mesh workflows |
| IGES | P2 | P2 | Legacy CAD |
| Proprietary CAD | Out | Out | Requires commercial SDKs or converters |

STL import creates a `MeshBody`, not a fake exact `SolidBody`. Automatic mesh-to-B-Rep conversion is not promised.

The implemented export dialog downloads successful terminal bodies as deterministic multi-object 3MF with fixed print tessellation, exact B-Rep STEP, or binary STL. It can also send that 3MF to a remembered OrcaSlicer, Bambu Studio, PrusaSlicer, Snapmaker Orca, or UltiMaker Cura choice through the explicitly paired local bridge in ADR-0020, with an honest download fallback. Signed bridge installers, configurable print profiles, placement, reports, and deeper slicer integration remain later work.

## Undo, redo, and history

- P0: undo/redo at user-command granularity, not per pointer event.
- P0: edit an early feature and rebuild downstream features.
- P0: suppress/unsuppress.
- P1: reorder with DAG validation.
- P1: compare two snapshots by feature, parameter, and geometry metrics.
- P2: branch/merge.

## Interface and accessibility

- All interface work follows the normative [Design and UX Guidelines](design-and-ux-guidelines.md) and the vertical delivery order in the [Editor experience implementation plan](editor-experience-plan.md).
- Desktop-first, minimum working width of 1024 px.
- Every core action is available through commands/shortcuts and the command palette.
- Focus indicators, semantic labels, and keyboard-operable dialogs.
- State color is reinforced with shape, iconography, or text.
- Save, export, rebuild, solver, and topology failures remain persistent and recoverable rather than toast-only.
- Application chrome targets WCAG 2.2 AA; free-form canvas-authoring limitations are documented explicitly.
- Touch/tablet authoring comes later; phones are view/export-only.
- The architecture supports localization, but alpha may ship with one language.

## Modules, extensions, and automation

The microkernel, extension, and automation boundaries are designed during Phase 0. SPK-006 accepts only a reduced extension sandbox boundary; executable third-party support remains post-alpha until the production modeling, memory, document, and recovery gates pass. MCP is not published until one real draft/preview/commit scenario passes its local pairing and real-client gate.

| Capability | Priority | Completion condition |
|---|---:|---|
| Stable built-in feature and command registries | P0 | Core types use owned identifiers and registry metadata without a public plugin runtime |
| Cohesive first-party module descriptors | P0 | Sketch, part-design, exchange, print-analysis, and measurement ownership is explicit and acyclic without a package-per-feature requirement |
| Automation-ready query and command contracts | P0 | Bounded revisioned views, machine-readable schemas, drafts, previews, revision preconditions, cancellation, and actor provenance pass domain tests |
| Preserve extension locks and unknown feature payloads | P0 | `.vshape` can open, inspect, and re-export safely without executing or installing code |
| Restricted-mode document open | P1 | Missing or disabled extensions preserve the document and visibly block affected DAG nodes |
| Deterministic parametric feature modules | P2 | Accepted no-import WebAssembly seam gains a modeling ABI, hard memory policy, exact document locks, and recovery rebuild |
| Capability-based workspace extensions | P2 | Declarative and opaque iframe contributions pass; any executable controller requires a stronger isolation design |
| Compute and codec modules | P2 | Dedicated worker/WASM host passes hostile-input and termination tests |
| Local or self-hosted package catalogs | P2 | Immutable package retrieval, integrity verification, and offline retention pass |
| Official public marketplace | P2 | Publisher governance, review, signing, revocation, abuse, and update policy exist |
| Local MCP bridge | P2 | Explicit local pairing, bounded resources, schema-backed tools, draft confirmation, cancellation, provenance, and real-client E2E pass |

Extension rules:

- Parametric feature modules have no network, time, randomness, DOM, file, storage, clipboard, or raw-kernel access.
- Interactive extensions cannot mount React components into the application tree or mutate application state directly.
- Exact extension versions and integrity hashes are part of document and feature identity.
- Updates, permissions, installation, and enablement are always explicit and reversible.
- Opening a project never executes embedded code or silently retrieves a missing extension.
- Extension commands follow the same preview, busy, double-activation, validation, cancellation, undo, localization, and accessibility contracts as built-in commands.
- First-party modules share contribution and command semantics with extensions without pretending trusted kernel services are optional packages.
- MCP uses the same command path, exposes no generic execution tool, and never grants an extension additional authority.

See [Extension architecture](../architecture/extensions.md), [Automation and MCP architecture](../architecture/automation-and-mcp.md), [ADR-0012](../adr/0012-capability-based-extension-platform.md), and [ADR-0013](../adr/0013-microkernel-modules-and-mcp-automation.md).

## Explicitly deferred

- Executable third-party extensions and a public marketplace until the SPK-006 production follow-ups and stable command/feature contracts pass.
- Real-time multi-user editing.
- Direct G-code delivery to printers.
- Generative or AI CAD before a deterministic command API, draft/preview boundary, local pairing gate, and sandbox exist.
- Claims of complete compatibility with Onshape, FreeCAD, or SolidWorks.
