# VibeShape

**VibeShape** is a free, local-first CAD system that runs in the browser and focuses on designing parts for 3D printing.

The goal is not to clone all of Onshape. The first practical release must provide one short, reliable path:

> parametric sketch → exact B-Rep solid → printability checks → 3MF/STEP/STL

By default, all computation, files, and model history remain on the user's device. A cloud account, server-side CAD session, and mandatory telemetry are not required.

## Status

The repository contains the **research and specification** plus an executable Phase 1 foundation scaffold. The Bun monorepo, shared TypeScript environments, local-first verification gates, Vite application shell, typed ICU localization, Tailwind tokens, and source-owned shadcn primitives are operational.

The pure domain layer provides UUIDv7 identities, canonical quantities, revisioned document, sketch, variable, and feature commands, deterministic events and replay, actor-bound drafts, validated module and feature-type registries, atomic whole-DAG mutations, canonical feature-content identity, and sequential asynchronous rebuild scheduling. Sketch schema v0 stores bounded analytical point, line, circle, and arc entities on an origin plane plus every P0 constraint family; dimensional constraints retain authored Quantity expressions such as `#width`. The first-party part-design module contributes unit-aware box, cylinder, ordered Boolean/Subtract, and selector-backed new-body extrusion features. `@vibeshape/application` accepts a committed `DocumentSnapshot`, validates its DAG, derives changed roots from the previous revision, and composes the scheduler, injected SHA-256 hashing, validated derived state, transient feature-content preparation, and a serializable geometry port into a fail-closed rebuild use case.

Document protocol v5 sends a runtime-validated committed snapshot, including authored variables and sketches, to `@vibeshape/document-worker`. The worker owns dimensional expression evaluation, trusted feature-parameter resolution, incremental rebuild state, generation checks, sequential scheduling, SHA-256 hashing, the application coordinator, the OCCT engine, and the production sketch-solve boundary for the document. Geometry protocol v8 additionally carries bounded transient analytical loops for exact extrusion without persisting solved coordinates. The worker exports exact terminal B-Rep bodies as transferable STEP or binary STL, or retessellates each exact body with fixed print tolerances for deterministic multi-object 3MF, and prunes removed, suppressed, failed, or superseded native shapes after every successful rebuild.

The first sketch solve lazily loads the exact reviewed SolveSpace v3.2 ES module and `251,544`-byte WASM asset. Stable document entity IDs compile to ephemeral native handles; solved points, circles, conflict IDs, degrees of freedom, and residuals map back to stable identities. Authored variable expressions are resolved before native execution, branch continuation is keyed by stable IDs and document revision, and drag targets are applied last. Every valid solve also derives deterministic line/arc/circle profiles, analytical area and perimeter, outer/hole/island nesting, and bounded fail-closed diagnostics without exposing native handles. A document-scoped session replaces a failed worker, increments generation, rebuilds the latest successful semantic snapshot, and retries one recoverable rebuild, export, or sketch solve.

The browser integration harness proves main-thread session → document worker → variable resolution → domain DAG → application coordinator → OCCT, plus the real generated SolveSpace WASM path. It covers selective geometry rebuild, hard worker replacement, exact-revision export, a variable-driven fully constrained sketch, a variable-driven rectangular profile, selector-backed exact extrusion, two continuation/drag solves, and a 1,000-point under-constrained sketch within the declared solve and heap budgets. Stable profile-selector schema v0 records canonical boundary entity IDs and resolves the same region after transient loop indices change while failing closed on missing or ambiguous intent. The product shell now makes Sketch → selected profile → Extrude its primary path: sketch activation selects before editing, a finished supported profile exposes contextual extrusion, and direct Box and Cylinder commands remain in a secondary advanced path. It also exposes the TanStack Form-backed Variables table; creates and edits persisted ordered Boolean/Subtract features, fully constrained rectangle sketches on every origin plane, variable-driven symmetric or one-sided new-body extrusions, and the retained direct primitives; protects dependency-owned feature and referenced-sketch deletion; downloads 3MF, STEP, STL, and deterministic `.vshape` v0 backups; renders authoritative worker meshes through raw Three.js/WebGL2; and renders saved sketch solutions plus exact profile measurements in an accessible orthographic SVG workspace. Rectangle and extrusion dimensions retain authored literals or `#variable` expressions, while edits preserve stable identities and selectors. `.vshape` round-trip tests preserve stable variable IDs, formulas, feature sources, analytical sketch records, and sketch dimension expressions. Free-form sketch tools, viewport plane selection, arbitrary profile picking, extrusion add/remove/intersect, interactive extrusion preview, conflict editing, interior-intersection splitting, body/edge/vertex selection, topology repair, undo/redo, `.vshape` migrations, configurable print profiles, and persistent export reports remain open.

The export dialog also remembers an allowlisted desktop slicer and sends its generated 3MF through the explicitly paired, authenticated VibeShape Slicer Bridge on `127.0.0.1`. The source bridge starts OrcaSlicer, Bambu Studio, PrusaSlicer, Snapmaker Orca, or UltiMaker Cura without a shell. If the bridge is unpaired, unavailable, or cannot launch the selected application, the browser downloads the same 3MF and reports the fallback instead of claiming that the slicer opened. Signed bridge installers and background startup remain release-packaging work.

The local-project library now reads bounded, strict IndexedDB summaries; identifies the current project; creates, switches, and duplicates projects; and permanently deletes an explicitly confirmed inactive project in one revision- and lease-checked transaction. Successful geometry rebuilds also produce a bounded isometric SVG preview from authoritative terminal meshes. The exact-revision preview is disposable derived data in an additive IndexedDB v2 store: it cannot block semantic saves, does not enter `.vshape`, fails open to an accessible placeholder, copies separately after semantic duplication, and is removed with project deletion. Duplication verifies the source history, assigns a new document ID and globally unique command IDs, preserves document-scoped variable and feature identities plus authored expressions, appends an explicit copy-name event, and publishes the result atomically without claiming an external backup. Active-project deletion is blocked until the user switches away; richer storage-state presentation remains required before the P0 library is complete.

`@vibeshape/automation-api` provides strict lifecycle schemas and a bounded revision-tagged document-summary view; `@vibeshape/automation-host` coordinates host-generated, owner-bound, expiring disposable drafts over injected document ports and ordinary query and command dispatchers. There is no MCP transport or SDK dependency yet. SPK-001 through SPK-005 clear the controlled OCCT worker, SolveSpace solver, stable topology, minimal 3MF interoperability, and semantic persistence/recovery gates. SPK-006 proceeds with reduced scope: immutable exact-integrity packages, no-import WebAssembly features, capabilities, restricted states, and opaque iframe UI pass locally in Chromium, Firefox, and WebKit, while arbitrary same-origin workspace JavaScript is rejected. Free-form sketch interaction, general production persistence, and extension workflows remain incomplete.

Key decisions:

- exact geometry kernel: **Open CASCADE Technology** through WebAssembly;
- first integration: **Replicad** behind our own `GeometryEngine` interface, with the option to move to a custom OpenCascade.js build;
- rendering: **Three.js/WebGL2**;
- sketch solver: the accepted narrow WebAssembly build of **SolveSpace v3.2** behind a flat worker-owned ABI;
- application: **React + TypeScript + Vite** in a **Bun workspaces monorepo**, delivered as a static installable PWA without a backend;
- UI foundation: **Tailwind CSS v4 + shadcn/ui (Radix)** in a dedicated `@vibeshape/ui` package;
- internationalization: typed ICU messages through **use-intl** in a local-first `@vibeshape/i18n` package;
- code quality: **Biome + TypeScript + Fallow**, with separate formatting/lint, type, and changed-code architecture gates;
- extensibility: an accepted reduced-scope **capability-based extension platform** with exact-integrity no-import WebAssembly features and opaque iframe UI; executable third-party support remains gated by production modeling, memory, document, and recovery work;
- modularity and automation: a proposed **microkernel plus cohesive first-party modules**, with a local MCP bridge planned over the same revisioned query, draft, preview, and command contracts used by the application;
- heavy CAD operations: a dedicated **Web Worker**;
- persistence: IndexedDB/Dexie for the model and journal, OPFS for large binary caches, and an exportable `.vshape` container for portability;
- primary print format: **3MF**; STEP preserves exact geometry, while STL remains a compatibility format;
- desktop slicer handoff: an opt-in **authenticated loopback bridge** with a remembered allowlisted slicer and transparent 3MF download fallback;
- project license: **GPL-3.0-or-later**; OCCT/OpenCascade.js are distributed under LGPL-2.1 terms and require a separate compliance process.

## Documentation map

| Document | Contents |
|---|---|
| [Documentation overview](docs/README.md) | Reading order and decision status |
| [Product vision and scope](docs/product/vision-and-scope.md) | Audience, value proposition, MVP, and non-goals |
| [Feature specification](docs/product/feature-matrix.md) | Complete feature list by release |
| [Design and UX guidelines](docs/product/design-and-ux-guidelines.md) | Visual system, interaction rules, accessibility, content, and UI acceptance criteria |
| [UX and core flows](docs/product/ux-flows.md) | Interface structure and user journeys |
| [Sketch-first modeling plan](docs/product/sketch-first-modeling-plan.md) | Canonical Sketch-to-Feature workflow, invariants, and delivery slices |
| [Architecture](docs/architecture/overview.md) | Layers, processes, worker protocol, and rebuild model |
| [Technology stack](docs/architecture/technology-stack.md) | Libraries, alternatives, and reviewed versions |
| [UI system](docs/architecture/ui-system.md) | Tailwind, shadcn/ui, tokens, and component boundaries |
| [Internationalization](docs/architecture/internationalization.md) | Typed messages, locale resolution, catalog ownership, and verification |
| [Geometry and parametrics](docs/architecture/geometry-and-parametrics.md) | B-Rep, solver, topological naming, and caching |
| [Extension architecture](docs/architecture/extensions.md) | Extension profiles, packages, version locks, capabilities, isolation, UX, and spike gate |
| [Automation and MCP](docs/architecture/automation-and-mcp.md) | First-party module boundary, local MCP bridge, resources, tools, drafts, pairing, and safety gates |
| [Data model and `.vshape`](docs/architecture/data-model-and-file-format.md) | Entities, events, units, and native format |
| [Local-first persistence](docs/architecture/local-first-storage.md) | Autosave, recovery, OPFS, and portability |
| [3D-printing workflow](docs/3d-printing.md) | Analysis, tolerances, export, and slicing boundary |
| [Roadmap](docs/roadmap.md) | Phases, dependencies, and exit criteria |
| [Initial experiment plan](docs/implementation-blueprint.md) | Issue-ready spikes and implementation order |
| [SPK-001 OCCT worker evidence](docs/spikes/spk-001-occt-worker.md) | Executable worker results, measurements, provenance, interoperability evidence, and stop/go decision |
| [SPK-002 sketch solver evidence](docs/spikes/spk-002-sketch-solver.md) | Solver ABI, P0 constraint corpus, measurements, provenance, reproducibility, and stop/go decision |
| [SPK-003 stable topology evidence](docs/spikes/spk-003-toporef.md) | TopoRef schema, resolver policy, OCCT lineage, mutation corpus, local evidence, and stop/go decision |
| [SPK-004 3MF evidence](docs/spikes/spk-004-3mf.md) | Deterministic Core writer, resource limits, XML/OPC checks, slicer matrix, and stop/go decision |
| [SPK-005 local-first evidence](docs/spikes/spk-005-local-first.md) | Atomic history, checksum recovery, writer leases, OPFS fallback, offline reopen, and browser matrix |
| [SPK-006 extension evidence](docs/spikes/spk-006-extension-sandbox.md) | Package validation, runtime comparison, capabilities, restricted mode, iframe isolation, and reduced-scope decision |
| [Local deployment](docs/deployment.md) | Static hosting, offline operation, and browser headers |
| [Testing strategy](docs/testing-strategy.md) | Geometry, formats, UX, security, and performance tests |
| [Security and privacy](docs/security-and-privacy.md) | Threat model and import limits |
| [Licensing](docs/licensing.md) | Project and dependency licensing strategy |
| [Risk register](docs/risks.md) | Technical and product risks |
| [Research sources](docs/research-sources.md) | Primary sources and review date |
| [ADRs](docs/adr/README.md) | Accepted architecture decisions |

## Development

Use the Bun version pinned in `packageManager`:

```bash
bun install
bun run dev
```

For source-based desktop slicer handoff, pair the exact development origin and paste the printed token into the Export dialog:

```bash
bun run slicer:bridge -- --origin http://localhost:5173
```

See the [3D-printing workflow](docs/3d-printing.md#desktop-slicer-handoff) for pairing, executable overrides, and security boundaries.

The local pre-merge verification contract is:

```bash
bun run check
bun run fallow:audit
bun run test:e2e
```

Automatic pull-request CI intentionally uses one fast job and omits production build and Playwright. The full local result is recorded before merge to conserve GitHub Actions minutes.

Run `bun ci` to verify a frozen installation from `bun.lock`. `bun run solvespace:verify:runtime` verifies the promoted ES module, WASM, and matching public corresponding-source bundle before tests or production bundling. The first local cross-browser run may require `bunx playwright install chromium firefox webkit`; use `bun run test:e2e:chromium` for the fastest local E2E feedback and `bun run test:e2e:ui` for Playwright UI mode. `bun run shadcn:add <component>` adds one reviewed component through the app workspace; `add --all` is prohibited. `bun run occt:prepare` verifies the pinned controlled OCCT inputs, `bun run occt:build:source` performs the local Docker source build, `bun run occt:evidence:memory` runs the local allocator matrix, `bun run occt:evidence:performance` runs the local controlled Chromium budget, `bun run occt:evidence:step` exports through the browser worker and validates the STEP file with local headless FreeCAD, and `bun run occt:bundle:compliance` creates the verified corresponding-source archive from the staged package. Use `bun run occt:verify:compliance` to recheck an existing bundle. `bun run solvespace:prepare` verifies pinned solver sources, `bun run solvespace:build` performs the local source build, `bun run solvespace:evidence` runs the Bun and Chromium-worker corpus, and `bun run solvespace:bundle:compliance` creates its corresponding-source archive. `bun run topology:evidence` runs the dedicated stable-reference corpus in local Chromium. `bun run formats:evidence:3mf` generates the deterministic Core fixture and verifies it with local XML tooling plus at least two independent slicer families. `bun run persistence:evidence` verifies atomic history, forced-page recovery, writer takeover, quota rollback, OPFS degradation, and cached-shell offline reopen in Chromium, Firefox, and WebKit. `bun run extension:evidence` verifies the extension package and sandbox corpus in the same three engines. Heavy OCCT, SolveSpace, topology, slicer, persistence, and extension evidence paths are local-only, have no GitHub Actions workflow, reject truthy `CI`, and keep generated artifacts under `.artifacts`.

## Next practical step

Implementation continues through the **Phase 1 foundation vertical slice**, not interface expansion. The Phase 0 spike gates are recorded; accepted adapters are promoted only through production-oriented contracts with local evidence. The next boundaries are:

1. Extend the implemented selector-backed new-body extrusion with general profile picking, add/remove/intersect body operations, interactive preview, and free-form sketch tools.
2. Add topology repair events over the accepted `TopoRef` and downstream-failure contracts.
3. Add configurable print-quality profiles, progress, cancellation, validation, and persistent reports around the implemented deterministic 3MF/STEP/STL export path.
4. Extend `.vshape` v0 with migrations, explicit same-ID restore/copy policy, backup reminders, bulk export, and progressive system pickers; continue persistence work with autosave scheduling policy, BroadcastChannel coordination, persistent cache promotion, and an installed-build update gate.
5. Before any executable extension release, promote the accepted SPK-006 seams through a deterministic modeling ABI, portable memory policy, production transactions, document locks, persisted update/rollback, and recovery rebuild coverage.

If a spike fails, the corresponding ADR must be revisited before the UI is expanded.

## Scale estimate

This is harder than a typical web application. Geometry robustness, the sketch solver, and stable topology addressing are independent engineering problems.

- One experienced developer: approximately **6–9 months** to a useful alpha and **12–18+ months** to a robust v1.
- A 3–5 person team with CAD/WebAssembly experience: approximately **4–7 months** to alpha.
- A full Onshape equivalent with assemblies, drawings, PDM, and real-time collaboration is a multi-year product and is outside the current scope.

These are estimates, not commitments. Phase 0 measurements must replace them with evidence-based projections.

## Repository language

All documentation, architecture records, source identifiers, commit-facing technical text, and code comments are written in **English**. Product localization may support other languages later, but English is the canonical source language.

## License

VibeShape is distributed under the **GNU General Public License v3.0 or later**. See [LICENSE](LICENSE) and the [licensing strategy](docs/licensing.md).
