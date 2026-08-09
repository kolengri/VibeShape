# VibeShape

**VibeShape** is a free, local-first CAD system that runs in the browser and focuses on designing parts for 3D printing.

The goal is not to clone all of Onshape. The first practical release must provide one short, reliable path:

> parametric sketch → exact B-Rep solid → printability checks → 3MF/STEP/STL

By default, all computation, files, and model history remain on the user's device. A cloud account, server-side CAD session, and mandatory telemetry are not required.

## Status

The repository contains the **research and specification** plus an executable Phase 1 foundation scaffold. The Bun monorepo, shared TypeScript environments, local-first verification gates, Vite application shell, typed ICU localization, Tailwind tokens, and source-owned shadcn primitives are operational.

The pure domain layer provides UUIDv7 identities, canonical quantities, revisioned document and feature commands, deterministic events and replay, actor-bound drafts, validated module and feature-type registries, atomic whole-DAG mutations, canonical feature-content identity, and sequential asynchronous rebuild scheduling. The first-party part-design module contributes unit-aware box, cylinder, and ordered Boolean/Subtract features. `@vibeshape/application` now accepts a committed `DocumentSnapshot`, validates its DAG, derives changed roots from the previous revision, and composes the scheduler, injected SHA-256 hashing, validated derived state, and a serializable geometry port into a fail-closed rebuild use case. Rebuild state is bound to document, revision, worker generation, geometry environment, and mesh policy. It reuses clean independent results, rebuilds changed descendants or every native shape after a worker generation change, contains rejected ports as stable diagnostics, and exposes only geometry whose content hash matches a final successful record.

Document protocol v3 now sends a runtime-validated committed snapshot, including authored document variables, to `@vibeshape/document-worker`. That worker owns dimensional expression evaluation, trusted feature-parameter resolution, incremental rebuild state, generation checks, sequential scheduling, SHA-256 hashing, the application coordinator, and the OCCT engine for the document. It also exports the exact B-Rep shapes of successful terminal solid features from the matching rebuilt revision as transferable STEP or binary STL bytes; successful downstream operations consume their source bodies so exports do not duplicate construction inputs. After each successful rebuild, the worker synchronizes native shape ownership to the exact successful feature-content hashes so removed, suppressed, failed, or superseded entries cannot remain in the document cache. A document-scoped browser session detects worker errors, message deserialization failures, and request timeouts; it replaces the worker, increments the generation, rebuilds the latest successfully rebuilt semantic snapshot, and retries one recoverable export or rebuild. Protocol v7 still independently reserializes and verifies each resolved canonical feature environment, digest, and ordered dependency slot before OCCT execution. The browser integration harness proves the full main-thread session → document worker → variable resolution → domain DAG → application coordinator → OCCT path, including variable-driven selective rebuild, equivalent-expression reuse, clean reuse, hard worker replacement, full recovery rebuild, changed-descendant rebuild after recovery, transferable mesh clones and export files, health reporting, and document-scoped disposal. The product shell now opens or creates a real local document, exposes a TanStack Form-backed Variables table, commits the exact table through a transaction-tagged IndexedDB draft, and reopens it after page reload. A committed variable can be renamed explicitly by stable UUID; the ordinary revisioned command atomically refactors exact `#name` tokens in every document-variable expression and project Quantity source before persistence and rebuild. The first part-design workflows create and edit persisted Boxes and Cylinders from positive length literals or `#variable` expressions, preserve feature identity and authored source strings, run the ordinary add/update command and worker rebuild, list each result in the model tree, and restore edited values after reload. A persisted Boolean/Subtract workflow composes two available solids in target-then-tool order, prevents duplicate and cycle-forming selections, preserves the Boolean feature identity during edit, and restores its dependency slots after reload. Any leaf feature can be removed through the ordinary destructive command and persisted event; dependency-owning inputs expose the blocking feature names and require downstream removal first. The accessible AlertDialog is single-flight, stays open on failure, and states that undo is not available yet. The application-level export dialog downloads current terminal bodies as STEP for exact CAD exchange or binary STL for slicer compatibility, prevents export before valid rebuilt solids exist, keeps asynchronous status visible in the application bar, and does not treat export as a backup of parametric history. A raw Three.js/WebGL2 viewer consumes only authoritative terminal worker meshes, fits an orthographic Z-up camera, renders shaded faces and derived edges on demand, preselects and selects exact rendered faces, reports the selection through accessible DOM, and explicitly disposes replaced GPU resources. Rendered face identity remains transient and is never persisted as stable topology. Interactive command preview, body/edge/vertex selection, stable selection references, persistent derived caches, topology repair events, user-driven hard cancellation, richer expressions, undo/redo, `.vshape` backup, production 3MF orchestration, and full production persistence UX remain open.

`@vibeshape/automation-api` provides strict lifecycle schemas and a bounded revision-tagged document-summary view; `@vibeshape/automation-host` coordinates host-generated, owner-bound, expiring disposable drafts over injected document ports and ordinary query and command dispatchers. There is no MCP transport or SDK dependency yet. SPK-001 through SPK-005 clear the controlled OCCT worker, SolveSpace solver, stable topology, minimal 3MF interoperability, and semantic persistence/recovery gates. SPK-006 proceeds with reduced scope: immutable exact-integrity packages, no-import WebAssembly features, capabilities, restricted states, and opaque iframe UI pass locally in Chromium, Firefox, and WebKit, while arbitrary same-origin workspace JavaScript is rejected. Sketch domain integration, `.vshape`, and general production file, persistence, and extension workflows remain unimplemented.

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
- project license: **GPL-3.0-or-later**; OCCT/OpenCascade.js are distributed under LGPL-2.1 terms and require a separate compliance process.

## Documentation map

| Document | Contents |
|---|---|
| [Documentation overview](docs/README.md) | Reading order and decision status |
| [Product vision and scope](docs/product/vision-and-scope.md) | Audience, value proposition, MVP, and non-goals |
| [Feature specification](docs/product/feature-matrix.md) | Complete feature list by release |
| [Design and UX guidelines](docs/product/design-and-ux-guidelines.md) | Visual system, interaction rules, accessibility, content, and UI acceptance criteria |
| [UX and core flows](docs/product/ux-flows.md) | Interface structure and user journeys |
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

The local pre-merge verification contract is:

```bash
bun run check
bun run fallow:audit
bun run test:e2e
```

Automatic pull-request CI intentionally uses one fast job and omits production build and Playwright. The full local result is recorded before merge to conserve GitHub Actions minutes.

Run `bun ci` to verify a frozen installation from `bun.lock`. The first local cross-browser run may require `bunx playwright install chromium firefox webkit`; use `bun run test:e2e:chromium` for the fastest local E2E feedback and `bun run test:e2e:ui` for Playwright UI mode. `bun run shadcn:add <component>` adds one reviewed component through the app workspace; `add --all` is prohibited. `bun run occt:prepare` verifies the pinned controlled OCCT inputs, `bun run occt:build:source` performs the local Docker source build, `bun run occt:evidence:memory` runs the local allocator matrix, `bun run occt:evidence:performance` runs the local controlled Chromium budget, `bun run occt:evidence:step` exports through the browser worker and validates the STEP file with local headless FreeCAD, and `bun run occt:bundle:compliance` creates the verified corresponding-source archive from the staged package. Use `bun run occt:verify:compliance` to recheck an existing bundle. `bun run solvespace:prepare` verifies pinned solver sources, `bun run solvespace:build` performs the local source build, `bun run solvespace:evidence` runs the Bun and Chromium-worker corpus, and `bun run solvespace:bundle:compliance` creates its corresponding-source archive. `bun run topology:evidence` runs the dedicated stable-reference corpus in local Chromium. `bun run formats:evidence:3mf` generates the deterministic Core fixture and verifies it with local XML tooling plus at least two independent slicer families. `bun run persistence:evidence` verifies atomic history, forced-page recovery, writer takeover, quota rollback, OPFS degradation, and cached-shell offline reopen in Chromium, Firefox, and WebKit. `bun run extension:evidence` verifies the extension package and sandbox corpus in the same three engines. Heavy OCCT, SolveSpace, topology, slicer, persistence, and extension evidence paths are local-only, have no GitHub Actions workflow, reject truthy `CI`, and keep generated artifacts under `.artifacts`.

## Next practical step

Implementation continues through the **Phase 1 foundation vertical slice**, not interface expansion. The Phase 0 spike gates are recorded; accepted adapters are promoted only through production-oriented contracts with local evidence. The next boundaries are:

1. Production sketch records and a worker protocol consume the accepted solver ABI, with branch-continuation and large-sketch budgets added before sketch UI expansion.
2. Add topology repair events over the accepted `TopoRef` and downstream-failure contracts.
3. The production geometry facade is selected from the measured OCCT spike boundaries.
4. Production export integrates the accepted deterministic 3MF writer with print-quality OCCT tessellation, progress, cancellation, and persistent diagnostics.
5. Extend the implemented persisted document session with `.vshape`, autosave scheduling policy, backup UX, BroadcastChannel coordination, migrations, persistent cache promotion, and an installed-build update gate.
6. Before any executable extension release, promote the accepted SPK-006 seams through a deterministic modeling ABI, portable memory policy, production transactions, document locks, persisted update/rollback, and recovery rebuild coverage.

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
