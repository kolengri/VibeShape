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

The implemented persistence foundation immediately saves each accepted command through the transactional repository, recovers an interrupted page, and rebuilds the same variable-driven model after clean reopen in Chromium, Firefox, and WebKit. This is not yet the complete autosave product: debounced editor commit policy, project-library UI, `.vshape`, backup prompts, multi-tab ownership UX, and installed-build update handling remain open.

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

The first product viewport now displays terminal authoritative meshes from a successful document rebuild through raw Three.js `0.185.1` and WebGL2. It provides shaded faces, derived feature edges, Z-up orthographic orbit/pan/zoom, automatic fit, an explicit Fit view action, responsive sizing, localized empty/failure states, and deterministic GPU disposal. Standard view presets, perspective switching, grids/origin overlays, hover preselection, body/face/edge/vertex picking, selection summaries, display-mode switching, clipping, and render-performance budgets remain open P0/P1 work.

## Sketcher

| Capability | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Point, line/polyline, rectangle | ✓ |  |  |
| Circle, center/three-point arc | ✓ |  |  |
| Construction geometry, trim, extend | ✓ |  |  |
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

The implemented foundation is intentionally narrower: document variables have stable UUIDv7 identity, case-sensitive ASCII names, arbitrary DAG dependencies, `#name` references, unit literals, unary signs, `+ - * /`, parentheses, dimensional checking, cycle detection, revisioned add/update/remove and whole-table replacement commands, persistence acceptance, interrupted-page recovery, clean save/reopen rebuild, and document-worker recovery. The product Variables panel provides a semantic table, an uncontrolled raw-input contract with TanStack Form integration, live resolved results, adjacent validation, immutable committed names, referenced-removal protection, async single-flight Apply, atomic IndexedDB persistence, and reload/reopen coverage. The first product parameter panel preserves raw Box width, depth, and height expressions, resolves literals or committed `#variables`, reports adjacent dimensional/range errors, guards asynchronous double submission, commits through the ordinary persisted feature command, lists the feature in the model tree, and restores it after reload. Cylinder quantities also resolve through trusted handlers, and geometry reuse compares resolved values. Interactive geometry preview, existing-feature editing, exponentiation, functions, compound dimensions, atomic rename/refactor, localized authoring, and spreadsheet-style interaction remain P1 completion work. See [ADR-0015](../adr/0015-document-variables-and-dimensional-expressions.md).

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

## Undo, redo, and history

- P0: undo/redo at user-command granularity, not per pointer event.
- P0: edit an early feature and rebuild downstream features.
- P0: suppress/unsuppress.
- P1: reorder with DAG validation.
- P1: compare two snapshots by feature, parameter, and geometry metrics.
- P2: branch/merge.

## Interface and accessibility

- All interface work follows the normative [Design and UX Guidelines](design-and-ux-guidelines.md).
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
