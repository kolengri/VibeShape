# VibeShape

**VibeShape** is a free, local-first CAD system that runs in the browser and focuses on designing parts for 3D printing.

The goal is not to clone all of Onshape. The first practical release must provide one short, reliable path:

> parametric sketch → exact B-Rep solid → printability checks → 3MF/STEP/STL

By default, all computation, files, and model history remain on the user's device. A cloud account, server-side CAD session, and mandatory telemetry are not required.

## Status

The repository contains the **research and specification** plus an executable Phase 1 foundation scaffold. The Bun monorepo, shared TypeScript environments, quality gates, CI, Vite application shell, typed ICU localization, Tailwind tokens, and first source-owned shadcn primitives are operational. SPK-001 now provides an isolated OCCT/Replicad worker, runtime-validated protocol v2, deterministic CAD fixture, stage memory checkpoints, hard worker restart, checksum-verified controlled-build inputs, and cross-browser WASM tests. Its result is **Rework**, not production acceptance, because the controlled WASM has not yet been built, exact provenance of the published artifact remains unknown, and allocator-level plateau evidence remains open. CAD domain behavior, the sketch solver, persistence, and production file codecs remain intentionally unimplemented until their Phase 0 gates pass.

Key decisions:

- exact geometry kernel: **Open CASCADE Technology** through WebAssembly;
- first integration: **Replicad** behind our own `GeometryEngine` interface, with the option to move to a custom OpenCascade.js build;
- rendering: **Three.js/WebGL2**;
- sketch solver: a narrow WebAssembly build of the **SolveSpace** solver, subject to a technical spike;
- application: **React + TypeScript + Vite** in a **Bun workspaces monorepo**, delivered as a static installable PWA without a backend;
- UI foundation: **Tailwind CSS v4 + shadcn/ui (Radix)** in a dedicated `@vibeshape/ui` package;
- internationalization: typed ICU messages through **use-intl** in a local-first `@vibeshape/i18n` package;
- code quality: **Biome + TypeScript + Fallow**, with separate formatting/lint, type, and changed-code architecture gates;
- extensibility: a proposed **capability-based extension platform** with deterministic, exact-version feature modules separated from sandboxed UI/integration code; executable third-party support remains gated by `SPK-006`;
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
| [SPK-001 OCCT worker evidence](docs/spikes/spk-001-occt-worker.md) | Executable worker results, measurements, provenance, memory findings, and rework decision |
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

The repository-level verification contract is:

```bash
bun run check
bun run fallow
bun run test:e2e
```

Run `bun ci` to verify a frozen installation from `bun.lock`. The first local cross-browser run may require `bunx playwright install chromium firefox webkit`; use `bun run test:e2e:chromium` for the fastest local E2E feedback and `bun run test:e2e:ui` for Playwright UI mode. `bun run shadcn:add <component>` adds one reviewed component through the app workspace; `add --all` is prohibited. `bun run occt:prepare` verifies and prepares the pinned controlled OCCT build inputs; `bun run occt:build` additionally requires Docker and keeps generated artifacts quarantined under `.artifacts` until the geometry gate passes.

## Next practical step

Implementation continues through **Phase 0 technical spikes**, not interface expansion. SPK-001 has functional evidence but remains in rework. Before promoting the spike adapters into the main product, we must prove four core properties and one independent extension boundary:

1. A reproducible custom WASM build starts in a worker, performs STEP import, boolean operations, fillets, and STEP/STL export, and reaches a measured memory plateau.
2. The selected sketch solver reliably handles the required constraint set.
3. Stable face and edge references survive the parameter-change matrix or explicitly enter an `ambiguous` state.
4. Generated 3MF files pass validation and open in at least PrusaSlicer and Cura/OrcaSlicer.
5. Before any executable extension release, `SPK-006` proves deterministic artifact locking, isolation, termination, permissions, restricted-mode recovery, and cross-browser behavior.

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
