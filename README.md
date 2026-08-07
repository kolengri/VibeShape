# VibeShape

**VibeShape** is a free, local-first CAD system that runs in the browser and focuses on designing parts for 3D printing.

The goal is not to clone all of Onshape. The first practical release must provide one short, reliable path:

> parametric sketch → exact B-Rep solid → printability checks → 3MF/STEP/STL

By default, all computation, files, and model history remain on the user's device. A cloud account, server-side CAD session, and mandatory telemetry are not required.

## Status

The repository contains the **research and specification** plus an executable Phase 1 foundation scaffold. The Bun monorepo, shared TypeScript environments, quality gates, CI, Vite application shell, typed ICU localization, Tailwind tokens, and first source-owned shadcn primitives are operational. CAD domain behavior, the geometry engine, sketch solver, persistence, and file codecs remain intentionally unimplemented until their Phase 0 spikes pass.

Key decisions:

- exact geometry kernel: **Open CASCADE Technology** through WebAssembly;
- first integration: **Replicad** behind our own `GeometryEngine` interface, with the option to move to a custom OpenCascade.js build;
- rendering: **Three.js/WebGL2**;
- sketch solver: a narrow WebAssembly build of the **SolveSpace** solver, subject to a technical spike;
- application: **React + TypeScript + Vite** in a **Bun workspaces monorepo**, delivered as a static installable PWA without a backend;
- UI foundation: **Tailwind CSS v4 + shadcn/ui (Radix)** in a dedicated `@vibeshape/ui` package;
- internationalization: typed ICU messages through **use-intl** in a local-first `@vibeshape/i18n` package;
- code quality: **Biome + TypeScript + Fallow**, with separate formatting/lint, type, and changed-code architecture gates;
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
| [Data model and `.vshape`](docs/architecture/data-model-and-file-format.md) | Entities, events, units, and native format |
| [Local-first persistence](docs/architecture/local-first-storage.md) | Autosave, recovery, OPFS, and portability |
| [3D-printing workflow](docs/3d-printing.md) | Analysis, tolerances, export, and slicing boundary |
| [Roadmap](docs/roadmap.md) | Phases, dependencies, and exit criteria |
| [Initial experiment plan](docs/implementation-blueprint.md) | Issue-ready spikes and implementation order |
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

Run `bun ci` to verify a frozen installation from `bun.lock`. The first local browser test may require `bunx playwright install chromium`. `bun run shadcn:add <component>` adds one reviewed component through the app workspace; `add --all` is prohibited.

## Next practical step

Implementation must start with **Phase 0 technical spikes**, not with the interface. Before creating the main codebase, we must prove four properties:

1. A custom WASM build starts in a worker and performs STEP import, boolean operations, fillets, and STEP/STL export without leaks.
2. The selected sketch solver reliably handles the required constraint set.
3. Stable face and edge references survive the parameter-change matrix or explicitly enter an `ambiguous` state.
4. Generated 3MF files pass validation and open in at least PrusaSlicer and Cura/OrcaSlicer.

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
