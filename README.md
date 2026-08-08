# VibeShape

**VibeShape** is a free, local-first CAD system that runs in the browser and focuses on designing parts for 3D printing.

The goal is not to clone all of Onshape. The first practical release must provide one short, reliable path:

> parametric sketch → exact B-Rep solid → printability checks → 3MF/STEP/STL

By default, all computation, files, and model history remain on the user's device. A cloud account, server-side CAD session, and mandatory telemetry are not required.

## Status

The repository contains the **research and specification** plus an executable Phase 1 foundation scaffold. The Bun monorepo, shared TypeScript environments, quality gates, CI, Vite application shell, typed ICU localization, Tailwind tokens, and first source-owned shadcn primitives are operational. The domain package now provides a small production-oriented foundation: strict UUIDv7 identifiers, document create and rename commands, deterministic events and replay, revision-safe actor-bound drafts, a validated first-party module registry, and a strict feature-DAG/evaluation seam. The graph rejects invalid, duplicate, missing, cyclic, and undeclared topology dependencies; rebuild evaluation propagates dirtiness, reuses independent results, blocks only dependent failure branches, and contains evaluator failures as stable diagnostics. Trusted dispatchers fail closed when executable handlers drift from their descriptors. `@vibeshape/automation-api` provides strict lifecycle schemas and a bounded, revision-tagged document-summary view; `@vibeshape/automation-host` coordinates host-generated, owner-bound, expiring disposable drafts over injected document ports and the ordinary query and command dispatchers. There is no MCP transport or SDK dependency. This is not yet a complete CAD document model, geometry-backed feature evaluator, production persistence integration, undo stack, paired automation session, or public extension API. SPK-001 through SPK-005 clear the controlled OCCT worker, SolveSpace solver, stable topology, minimal 3MF interoperability, and semantic persistence/recovery gates. SPK-006 proceeds with reduced scope: immutable exact-integrity packages, no-import WebAssembly feature fixtures, capabilities, restricted states, and opaque iframe UI pass in Chromium, Firefox, and WebKit, while arbitrary same-origin workspace JavaScript is rejected. Generated native artifacts and spike adapters remain quarantined until their production integrations and release gates are reviewed. Sketch domain integration, `.vshape`, and production geometry, file, persistence, and extension workflows remain unimplemented.

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
bun run fallow
bun run test:e2e
```

Automatic pull-request CI intentionally uses one fast job and omits production build and Playwright. The full local result is recorded before merge to conserve GitHub Actions minutes.

Run `bun ci` to verify a frozen installation from `bun.lock`. The first local cross-browser run may require `bunx playwright install chromium firefox webkit`; use `bun run test:e2e:chromium` for the fastest local E2E feedback and `bun run test:e2e:ui` for Playwright UI mode. `bun run shadcn:add <component>` adds one reviewed component through the app workspace; `add --all` is prohibited. `bun run occt:prepare` verifies the pinned controlled OCCT inputs, `bun run occt:build:source` performs the local Docker source build, `bun run occt:evidence:memory` runs the local allocator matrix, `bun run occt:evidence:performance` runs the local controlled Chromium budget, `bun run occt:evidence:step` exports through the browser worker and validates the STEP file with local headless FreeCAD, and `bun run occt:bundle:compliance` creates the verified corresponding-source archive from the staged package. Use `bun run occt:verify:compliance` to recheck an existing bundle. `bun run solvespace:prepare` verifies pinned solver sources, `bun run solvespace:build` performs the local source build, `bun run solvespace:evidence` runs the Bun and Chromium-worker corpus, and `bun run solvespace:bundle:compliance` creates its corresponding-source archive. `bun run topology:evidence` runs the dedicated stable-reference corpus in local Chromium. `bun run formats:evidence:3mf` generates the deterministic Core fixture and verifies it with local XML tooling plus at least two independent slicer families. `bun run persistence:evidence` verifies atomic history, forced-page recovery, writer takeover, quota rollback, OPFS degradation, and cached-shell offline reopen in Chromium, Firefox, and WebKit. `bun run extension:evidence` verifies the extension package and sandbox corpus in the same three engines. Heavy OCCT, SolveSpace, topology, slicer, persistence, and extension evidence paths are local-only, have no GitHub Actions workflow, reject truthy `CI`, and keep generated artifacts under `.artifacts`.

## Next practical step

Implementation continues through **Phase 0 technical spikes**, not interface expansion. SPK-001's source-build, transient operation-history, memory, controlled-performance, technical release-bundle, and independent-application STEP gates are demonstrated locally. Before promoting spike adapters into the main product, we must resolve the remaining Phase 0 boundaries:

1. Production sketch records and a worker protocol consume the accepted solver ABI, with branch-continuation and large-sketch budgets added before sketch UI expansion.
2. The production feature DAG integrates the accepted `TopoRef` contract, downstream failure propagation, repair events, and save/reopen rebuild coverage.
3. The production geometry facade is selected from the measured OCCT spike boundaries.
4. Production export integrates the accepted deterministic 3MF writer with print-quality OCCT tessellation, progress, cancellation, and persistent diagnostics.
5. Production persistence integrates the accepted SPK-005 contract with `.vshape`, autosave scheduling, backup UX, BroadcastChannel coordination, migrations, and an installed-build update gate.
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
