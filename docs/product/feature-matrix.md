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

The first product viewport now displays terminal authoritative meshes from a successful document rebuild through raw Three.js `0.185.1` and WebGL2. It provides shaded faces, derived feature edges, Z-up orthographic orbit/pan/zoom, automatic fit, an explicit Fit view action, responsive sizing, localized empty/failure states, hover face preselection, exact rendered-face selection, an accessible selection summary and clear action, and deterministic GPU disposal. Command-first sketch creation also works in an empty model: it displays transient color-coded XY, XZ, and YZ origin planes, raycasts hover preselection and primary-click acceptance, and synchronizes the current datum with an accessible DOM control before entering the 2D editor. Rendered face IDs and datum meshes are transient and do not satisfy stable `TopoRef` requirements. Standard view presets, perspective switching, persistent grids/axes/origin visibility, idle-viewport plane-first commands, body/edge/vertex picking, selection filters, stable selection references, display-mode switching, clipping, and render-performance budgets remain open P0/P1 work.

## Sketcher

| Capability | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Point, line/polyline, rectangle | ✓ |  |  |
| Circle, center-point arc | ✓ |  |  |
| Three-point arc |  | ✓ |  |
| Construction geometry | ✓ |  |  |
| Trim and extend |  | ✓ |  |
| Slot, polygon, ellipse, spline |  | ✓ |  |
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
- point-on-line/curve;
- fixed;
- horizontal, vertical, and general distance;
- angle;
- radius/diameter.

The solver MUST report `under-constrained`, `fully-constrained`, and `over-constrained`, including the conflicting constraint set where possible. Automatically deleting constraints without confirmation is prohibited.

The implemented domain boundary covers every listed analytical entity and P0 constraint schema, variable-backed dimensions, exact-revision worker solving, continuation and drag, conflict IDs, deterministic endpoint-connected line/arc/circle profiles with outer, hole, and island nesting, and stable boundary selectors that fail closed on missing or ambiguous resolution. The product editor authors Point, Line/Polyline, corner Rectangle, Circle, center-point Arc, and Construction geometry on XY, XZ, or YZ; supports compatible-selection constraint and dimension authoring, constraint removal, point dragging, cascade deletion, local undo/redo, pan, zoom, live SolveSpace state, and visible solver conflicts; and preserves stable entity, constraint, plane, and expression identities through Finish, edit, variable rename, and reload. Solver-produced closed regions are selectable by stable boundary identity, including multiple profiles and holes, and one selected profile can drive exact new-body extrusion. Viewport inference, constraint and dimension glyphs, center rectangle, three-point Arc, trim/extend, guided conflict repair, and interior-intersection splitting remain open.

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

The first sketch-driven operation implements exact new-body extrusion from a stable `SketchProfileSelector`. The semantic feature stores only the selector, a literal or `#variable` distance `Quantity`, symmetric state, and operation intent. Each rebuild solves the referenced sketch once, resolves the selector fail-closed, and passes bounded transient analytical line/arc/circle loops to geometry protocol v8; solved coordinates and profile indices are never persisted. OCCT creates one exact prism with stable start-cap, end-cap, and uniquely attributable profile-side roles. The product offers every solver-produced region for selection by stable boundary identity, including profiles with holes, and supports extrusion create, edit, variable-driven rebuild, reload, and referenced-sketch deletion protection. Multi-profile feature input, add/remove/intersect, interactive unsaved solid preview, and downstream `TopoRef` authoring remain open. See [ADR-0019](../adr/0019-selector-backed-new-body-extrusion.md).

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

The implemented foundation is intentionally narrower: document variables have stable UUIDv7 identity, case-sensitive ASCII names, arbitrary DAG dependencies, `#name` references, unit literals, unary signs, `+ - * /`, parentheses, dimensional checking, cycle detection, revisioned add/update/remove/rename and whole-table replacement commands, persistence acceptance, interrupted-page recovery, clean save/reopen rebuild, and document-worker recovery. The product Variables panel provides a semantic table, an uncontrolled raw-input contract with TanStack Form integration, live resolved results, adjacent validation, referenced-removal protection, async single-flight Apply, and an explicit async rename mode. Rename preserves the variable UUID and atomically refactors exact references in variable formulas and project Quantity feature parameters before IndexedDB persistence and geometry rebuild. Shared state-agnostic parameter and sketch-dimension fields keep presentation independent of form state, while Box, Cylinder, Sketch Dimension, and Extrusion TanStack Form adapters preserve authored Quantity expressions, resolve literals or committed `#variables`, report adjacent dimensional/range errors, guard asynchronous double submission, and serve their owning create or edit workflow. Feature creation emits the ordinary persisted feature-add command. The interactive sketcher creates a complete transient analytical draft through pure domain operations, solves it through document protocol v6, and commits only on Finish through the ordinary sketch-add or sketch-update command. Activating an existing record restores exact entity, constraint, plane, and expression identities. Centered primitive state, sketch geometry and dimensions, and extrusion selector/symmetric state are retained through edit and reload. The product Boolean/Subtract workflow selects ordered target and tool solids through a native uncontrolled select composition and separate TanStack adapter, excludes duplicate and cycle-forming inputs, persists the two dependency slots through the same add/update path, and restores them after reload. An edit task can remove a leaf feature through the ordinary revisioned destructive command; direct dependents block removal with their visible labels, and the controlled AlertDialog closes only after persistence and rebuild succeed. Referenced sketches cannot be removed until their extrusion features are removed. The removal events retain exact prior records for tamper-resistant replay, while the geometry worker prunes any native shape not represented by a successful current content hash. Every implemented mutation rebuilds only after semantic persistence, while geometry reuse compares resolved values, prepared sketch-profile content, and ordered dependency hashes. Boolean union/common, exponentiation, functions, compound dimensions, localized authoring, declared extension refactor contributions, committed document undo/redo, and spreadsheet-style interaction remain P1 completion work. See [ADR-0015](../adr/0015-document-variables-and-dimensional-expressions.md), [ADR-0017](../adr/0017-atomic-variable-rename-and-reference-refactor.md), and [ADR-0019](../adr/0019-selector-backed-new-body-extrusion.md).

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
