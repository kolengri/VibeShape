# Implementation roadmap

## Recommendation

The UI shell is not the first milestone. First remove five core-workflow uncertainties: OCCT binding and worker behavior, sketch solver viability, stable topology references, 3MF interoperability, and local-first recovery. In parallel, resolve the long-term extension trust boundary before exposing any public SDK. Development then proceeds through vertical slices that each end with a working model and export. First-party feature modules and automation share the ordinary command path from the start; an MCP transport is added only when that path can support a real draft, preview, and commit scenario.

All estimates below are **approximate engineering ranges**, not calendar commitments.

## Phase 0 — spikes and measurements (2–4 weeks)

The repository foundation scaffold is already available for implementing and measuring these spikes. The SPK-001 through SPK-006 evidence remains isolated from product authority; accepted boundaries are promoted only through reviewed Phase 1 application, protocol, persistence, geometry, and browser contracts. The evidence packages are not a public extension API.

SPK-001 now passes its Phase 0 stop/go gate with executable evidence. The project source-builds the pinned builder with the reviewed destructor correction, verifies transient boolean and fillet history relations, reaches a 448-byte post-warmup allocator drift with zero retained bytes in every 1,000-operation lifecycle block, passes its local controlled Chromium performance budgets on the declared Apple M1 baseline, creates a verified corresponding-source bundle, and validates the browser-exported STEP fixture through headless FreeCAD. The controlled package remains quarantined until the production facade and extended corpus are reviewed. See [SPK-001 evidence](spikes/spk-001-occt-worker.md).

SPK-002 also passes its solver-selection gate. The pinned SolveSpace v3.2 subset exposes no native pointers, covers all P0 primitives through a Zod-validated typed-array ABI, distinguishes constraint states with conflict handles, completes 1,600 perturbation solves and 1,000 lifecycle cycles without post-corpus heap growth, runs in a Chromium module worker, and builds byte-identically after pinning the compilation epoch. The reviewed output is now promoted through production sketch schema v0, ordinary revisioned commands, document protocol v15, worker recovery, stable-ID branch continuation, variable-backed dimensions including signed line-chain Offset, deterministic endpoint-connected profiles, and a local browser budget for 1,000 points. See [SPK-002 evidence](spikes/spk-002-sketch-solver.md) and [ADR-0018](adr/0018-deterministic-sketch-profile-extraction.md).

SPK-003 passes its stable-reference algorithm gate. Strict domain schemas, semantic output roles, composed OCCT face lineage, and a versioned conservative signature score produce explicit `resolved`, `ambiguous`, and `missing` outcomes. The 12-scenario local Chromium corpus records 136 semantic resolutions, 22 history resolutions, 10 expected missing outcomes, a symmetric ambiguity, and zero false confident matches. Transient OCCT hashes remain evaluation-local and never enter the protocol or document contract. Production DAG integration and repair persistence remain Phase 3 work. See [SPK-003 evidence](spikes/spk-003-toporef.md).

SPK-004 passes its minimal 3MF interoperability gate. A deterministic project-owned Core writer validates mesh orientation and manifoldness, references, transforms, XML text, thumbnails, and resource budgets before producing the archive. The local-only gate verifies byte identity, OPC parts, well-formed XML, and matching 24-facet, `1,608 mm³` manifold geometry through PrusaSlicer and the Orca/Bambu family. Phase 1 now integrates that writer with exact terminal bodies, fixed print-quality OCCT tessellation, deterministic vertex welding, direct browser 3MF/STEP/STL download, and an authenticated remembered-slicer loopback handoff with download fallback. Signed bridge packaging, configurable profiles, progress, cancellation, persistent reports, placement, and the broader slicer release matrix remain Phase 4 and release work. See [SPK-004 evidence](spikes/spk-004-3mf.md).

SPK-005 passes its semantic persistence and recovery gate. Strict Dexie records atomically commit events, snapshots, project heads, recovery markers, and writer-lease checks. The local Chromium, Firefox, and WebKit matrix proves forced-page recovery, stale and quota rollback, bounded checksum recovery, lease takeover, cached-shell offline reopen, and progressive cache/file fallbacks. OPFS remains disposable and degrades cleanly when an exposed implementation is not operational. Later product increments implement deterministic `.vshape` v0 backup, verified atomic fresh-project import, cross-browser download/upload UI, and local-project listing, creation, switching, semantic duplication, exact-revision derived previews, plus confirmed inactive-project deletion. Active-project deletion, autosave scheduling, backup reminders and bulk export, same-ID restore/copy import policy, production service-worker updates, and large-project budgets remain Phase 1 work. See [SPK-005 evidence](spikes/spk-005-local-first.md).

SPK-006 records **Proceed with reduced scope**. Immutable exact-integrity packages, no-import WebAssembly features, deny/grant/revoke capabilities, opaque-origin iframe UI, restricted states, and hostile resource fixtures pass locally in Chromium, Firefox, and WebKit. The same matrix rejects arbitrary workspace JavaScript because a dedicated same-origin worker retains ambient network, clock, randomness, IndexedDB, and Cache Storage access. Third-party execution and the public SDK remain disabled pending a deterministic modeling ABI, portable memory policy, and production document, update, rollback, and recovery integration. See [SPK-006 evidence](spikes/spk-006-extension-sandbox.md).

### Deliverables

- Reproducible OCCT/Replicad worker prototype.
- STEP import → boolean/fillet → STEP/STL export.
- Memory and leak harness.
- Sketch solver prototype covering required constraints.
- `TopoRef` experiment on the model corpus.
- Minimal 3MF writer or adapter with slicer round-trip.
- IndexedDB journal/snapshot recovery and progressive OPFS/browser fallback matrix.
- Browser startup and memory matrix.
- Measured extension sandbox, immutable package, capability, and restricted-mode spike with a reduced-scope decision.
- Reviewed ADR set and updated estimates, including the accepted reduced extension decision.

### Exit criteria

- No spike ends with “seems to work”; every result has a fixture, command, and measurements.
- Required OCCT symbols in the custom build are known.
- WASM compressed and uncompressed size, cold startup, and peak memory are known.
- The solver distinguishes under-, fully-, and over-constrained states on the test set.
- The `TopoRef` experiment distinguishes `resolved`, `ambiguous`, and `missing`.
- Generated 3MF opens in at least two slicers.
- Semantic revisions recover after page termination and offline reopen in all target browser engines; unavailable OPFS never blocks the document.
- A baseline browser and device are defined.
- `SPK-006` accepts only the narrow no-import WebAssembly and opaque iframe seams; arbitrary workspace JavaScript and product execution stay disabled. Remaining production gates affect extension releases, not the core modeling alpha.

## Phase 1 — foundation vertical slice (3–5 weeks)

The production-oriented foundation now spans strict revisioned document, variable, analytical sketch, and feature schemas; deterministic replay and DAG scheduling; canonical geometry identity; worker-owned OCCT rebuild, SolveSpace sketch solving, selector-backed exact new/add/remove/intersect extrusion, and 3MF/STEP/STL export; transactional IndexedDB persistence; configurable Box, Cylinder, Boolean/Subtract, interactive sketch, and extrusion authoring and editing; dependency-safe feature and referenced-sketch deletion; variable refactoring; and a Three.js viewport with rendered-face selection, graphical stable vertex, linear-edge, circle-edge, and arc-edge Use, and non-selectable exact extrusion previews. The native-file increment adds deterministic `.vshape` v0 backup and verified atomic import, retaining stable variable IDs, formulas, feature source expressions, sketch records, and stable profile selectors while excluding derived geometry. Project-library increments add strict local summaries, current-project state, new-project creation, existing-project switching, semantic duplication under new document/command identities, exact-revision derived SVG previews, and confirmed inactive-project deletion guarded by revision and lease state. The browser harness proves recovery, worker replacement, selective rebuild, variable-driven interactive sketch-to-extrusion modeling, disposable create/edit extrusion preview, exact OCCT volume and bounds for every extrusion operation, deletion, multi-object 3MF plus exact STEP and binary STL export, remembered-slicer fallback and authenticated handoff, native-project round-trip, additive preview-store migration, local-project switching, duplication, preview copying, and deletion persistence. Signed slicer-bridge packaging, active-project deletion, multi-region feature input, general body/edge/vertex selection, non-circular curved and overlapping external selection, persistent caches, autosave scheduling, backup reminders and restore/copy import UX, BroadcastChannel ownership, user-driven hard cancellation, topology repair, extension-specific variable refactor contributions, richer expressions, committed document undo integration, and configurable print-quality export profiles and reports remain the next gates.

### Scope

- Bun workspaces monorepo, pinned Bun and `bun.lock`, strict TypeScript, Biome, Fallow changed-code auditing, and `bun ci`.
- Tailwind CSS v4 and `@vibeshape/ui` using shadcn/Radix primitives and tokens.
- Typed English product copy and locale preference through `@vibeshape/i18n`; additional translated catalogs remain later scope.
- PWA shell and project library following the design and UX contract, including its state and accessibility harness.
- Domain commands, events, and revisions.
- Worker protocol and restart/recovery behavior.
- Three.js viewport and body/face/edge selection.
- IndexedDB autosave and `.vshape` v0.
- Interactive sketch-to-new/add/remove/intersect extrusion with Point, Line/Polyline, corner and center Rectangle, Circle, center-point Arc, P0 constraints and dimensions, live solving, stable profile selection, explicit target dependencies, and local draft undo/redo; direct primitives remain secondary advanced tools.
- 3MF/STEP/STL smoke export.
- Remembered desktop slicer handoff through the authenticated source bridge, with browser download fallback.
- Stable built-in feature and command registries plus preservation of extension locks and unknown custom-feature payloads, without executing third-party code.
- Cohesive first-party module descriptors and adapter-neutral automation contracts: bounded revision-tagged queries, schema-backed command metadata, disposable drafts, preview, confirmation classes, actor provenance, and revision-safe commit.

### Demo

Create a variable-driven rectangle and exact extrusion, modify an explicit target body with Add/Remove/Intersect, edit the driving variable after reopen, recover the project offline, round-trip a `.vshape` backup into fresh browser storage, export 3MF/STEP/STL, and open the 3MF in a remembered desktop slicer through the explicitly paired bridge.

## Phase 2 — sketcher vertical slice (6–10 weeks)

The production boundary and core P0 interaction slice are complete for analytical profiles and exact new/add/remove/intersect extrusion: origin-plane, stable planar Box/Cylinder/Extrusion-face, and first-class signed offset Datum Plane sketch supports, all P0 constraint schemas, revisioned add/update/remove events, `.vshape` preservation, document protocol v15 solving, profile results, and stable model vertex, linear-edge, circle-edge, arc-edge, ellipse-edge, and elliptical-arc-edge records, geometry protocol v12 analytical profile, exact-frame, and rebuild-local exact reference-geometry transport, exact reviewed runtime verification, conflict/status mapping, variable dimensions, stable-ID continuation, deterministic outer/hole/island extraction, fail-closed stable selectors, OCCT prism and Boolean construction, stable cap/side/vertex/LINE-edge roles plus Cylinder rim roles, separate support and body dependencies, worker recovery, the initial 1,000-point browser budget, an accessible interactive SVG sketcher with center-origin families, exact full-ellipse and elliptical-arc authoring, full-ellipse axis-quadrant and generic perimeter inference plus bounded elliptical-arc perimeter inference across authored, earlier-sketch, and stable model geometry, profiles, direct save-to-extrusion, exact line/arc/circle modification including signed line-chain Offset, adaptive streamed exact drag feedback, local draft undo/redo, selectable stable profile regions, graphical model-vertex and analytical line/circle/arc/ellipse/elliptical-arc Use in normal and orbit views, exact selection-first earlier-sketch line Pierce across supports, feature/origin/datum visibility, and exact disposable extrusion create/edit preview. The remaining phase includes spline and other non-analytical curved feature-geometry Use, curved and model-edge Pierce, mid-plane, angular, three-point, axis, and point reference geometry, general planar-face repair, round-curve Offset, remaining round/ellipse modification boundaries, spline authoring, multi-profile feature input, guided conflict repair, and general intersection splitting below.

### Scope

- Origin planes and sketch mode.
- Point, line/polyline, rectangle, circle, center-point arc, and construction geometry.
- P0 constraints and dimensions.
- Solver diagnostics and conflict UX.
- Interior-intersection splitting and general stable profile-selection interaction.
- Extend the implemented new-body, origin-axis Revolve with selected stable axes and Add/Remove/Intersect merge scope; add a dedicated Pocket workflow after the shared preview and target-selection contracts stabilize.
- Command-level undo/redo.
- Unit-aware inputs.
- Add variable-reference insertion and expression completion to the implemented free-form sketch dimensions and additional feature parameters, rather than requiring manual `#name` typing.

### Demo

A fully parametric flange and simple bracket, with dimensions edited after reopen.

## Phase 3 — robust feature modeling (6–10 weeks)

### Scope

- Multiple bodies.
- Booleans, fillet, and chamfer.
- Semantic outputs and `TopoRef` resolution.
- Downstream error and repair UX.
- Suppress, edit, and rebuild.
- Measurement tools.
- STEP import as reference.
- Golden and property-based model corpus.

### Demo

The reference bracket passes its parameter-change matrix. A symmetric ambiguous case opens repair UI instead of silently remapping topology.

## Phase 4 — 3D-printing workflow (4–7 weeks)

### Scope

- Configurable print-quality adaptive tessellation and validation profiles.
- Extend the implemented 3MF Core export with placement, progress, cancellation, and reports.
- Printer and build-volume profiles.
- P0 mesh and solid checks.
- Overhang and build-volume overlays.
- Export reports.
- Slicer compatibility CI and manual release matrix.
- Signed Windows, macOS, and Linux slicer-bridge packages with reviewed startup and update behavior.

### Demo

Bracket and enclosure export to 3MF and STEP, open in PrusaSlicer and Cura/Orca, and retain dimensions within tolerance.

## Phase 5 — alpha hardening (4–8 weeks)

### Scope

- File and import fuzzing with resource limits.
- Chromium, Firefox, and Safari browser matrix.
- Crash, quota, and multi-tab recovery.
- Accessibility and keyboard workflow.
- Reference-task usability testing and resolution of critical save-state, command, and geometry misunderstandings.
- Performance budgets and profiling.
- LGPL notices, source offer, and reproducible WASM.
- User documentation and diagnostic bundle.
- Migration fixtures.

### Alpha exit criteria

- End-to-end bracket scenario passes.
- No known P0 data-loss issue.
- Model corpus passes against the pinned engine build.
- All release exports are valid.
- Offline test passes.
- Known limitations are published.

## v1 after alpha

- Pattern, mirror, shell, sweep, and loft.
- Projected geometry and datum entities.
- Rich expressions (`^`, functions, compound dimensions) and extension-declared variable refactor contributions.
- Snapshots and version comparison.
- SVG and DXF.
- Improved print heuristics.
- Tablet usability and additional translated catalogs.
- Documented native format v1.
- Restricted-mode open and repair flows for documents that reference unavailable extensions.

## Later tracks

| Track | Prerequisite |
|---|---|
| Assemblies and mates | Stable components, instances, and `TopoRef` |
| Drawings | Stable projected topology and dimensions |
| Branch and merge | Formal command-conflict model |
| Optional sync/collaboration | Privacy/security ADR and merge semantics |
| Extension SDK and local/self-hosted catalogs | SPK-006 production follow-ups: modeling ABI, portable memory policy, document recovery, stable commands/features/migrations, permissions, and package governance |
| Local MCP automation bridge | Stable query and command schemas, disposable drafts, preview/commit policy, actor provenance, and an accepted local pairing/security spike |
| Integrated slicing | Separate licensing, performance, and safety spike |
| Higher-level AI features | Accepted MCP or equivalent automation boundary, deterministic command API, preview, sandbox, and no hidden uploads |

## Backlog prioritization

Every task answers four questions:

1. Which user flow does it complete?
2. Which domain or geometry invariant does it add?
3. How is failure tested, not only the happy path?
4. Does it create a new file, schema, or API commitment?

Features that do not improve the sketch-to-feature-to-print workflow or remove correctness/data risk do not enter alpha, even when their visible implementation cost looks small.

## Team model

A useful 3–5 person allocation:

- geometry, OCCT, and WASM;
- sketch solver and parametric engine;
- viewport, UI, and UX;
- local-first persistence, formats, and testing;
- product and 3D-print validation, possibly combined with another role.

Without computational-geometry experience, Phase 2 and Phase 3 have high uncertainty. Geometry code review always requires fixture and invariant evidence.
