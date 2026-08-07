# Technology stack

## Recommended stack

| Area | Choice | Rationale |
|---|---|---|
| Language | TypeScript with `strict` | Shared typing across domain, UI, protocol, and migrations |
| UI | React 19 | Mature ecosystem for complex desktop-like interfaces |
| Build/dev | Vite 8 | Fast static build, worker/WASM assets, no backend required |
| Package manager/runtime | Bun workspaces | One lockfile, fast installs, `workspace:*`, catalogs, filters, and `bun ci` |
| CAD kernel | OCCT through Replicad/OpenCascade.js | Exact B-Rep, booleans, fillets, and STEP |
| Sketch solver | SolveSpace solver subset compiled to WASM | Mature constraint set and GPL-compatible licensing |
| Viewport | Raw Three.js with WebGL2 baseline | Full control of picking, buffers, clipping, and lifecycle |
| UI state | Zustand | Transient local UI state, separate from domain state |
| Form state | TanStack Form | Typed field and submission state behind adapters; base controls remain state-agnostic |
| Internationalization | `use-intl` | Typed ICU messages and formatting without a Next.js or backend dependency |
| Runtime schemas | Zod | Worker-message, file, and migration validation |
| Runtime kind guards | `is-what` | Small tree-shakable predicates inside validated boundaries without duplicating schema logic |
| Styles | Tailwind CSS v4 through `@tailwindcss/vite` | Zero-runtime utility CSS, tokens, and first-party Vite integration |
| UI primitives | shadcn/ui CLI v4 with Radix base | Accessible source-owned components and monorepo routing |
| Icons | Lucide React | Consistent low-noise icon set for tools, trees, and actions |
| Project DB | IndexedDB through Dexie | Transactions and indexes without another heavy WASM runtime |
| Large binary cache | OPFS | Efficient local files accessed from workers |
| Offline | Web App Manifest and service worker | Installable offline static PWA |
| Tests | Vitest through Bun, plus Playwright | Vite-native unit/contract tests and real browser flows |
| Format and lint | Biome | One deterministic formatter, linter, import organizer, and scoped checker for TypeScript, TSX, JSON, CSS, and HTML |
| Code intelligence | Fallow | Changed-code risk, cleanup evidence, duplication, complexity, dependency hygiene, styling drift, and architecture boundaries |
| CI | GitHub Actions | Typecheck, tests, format conformance, Fallow audit, and Playwright E2E across Chromium, Firefox, and WebKit |

## Reviewed package-version snapshot

Verified against the npm registry on **2026-08-07**, with `is-what` reviewed on **2026-08-08**. Packages already used by the foundation scaffold are pinned in workspace manifests and `bun.lock`; the remaining snapshot guides Phase 0 selection and is not an installation decision.

| Package | Version | License |
|---|---:|---|
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `vite` | 8.2.1 | MIT |
| `@vitejs/plugin-react` | 6.0.5 | MIT |
| `@tanstack/react-form` | 1.33.3 | MIT |
| `use-intl` | 4.13.5 | MIT |
| `three` | 0.185.1 | MIT |
| `replicad` | 0.23.1 | MIT |
| `replicad-opencascadejs` | 0.23.0 | MIT package wrapper; embedded OCCT obligations remain |
| `opencascade.js` | 1.1.1 | LGPL-2.1-only |
| `zustand` | 5.0.14 | MIT |
| `dexie` | 4.4.4 | Apache-2.0 |
| `zod` | 4.4.3 | MIT |
| `is-what` | 5.5.0 | MIT |
| `tailwindcss` | 4.3.3 | MIT |
| `@tailwindcss/vite` | 4.3.3 | MIT |
| `shadcn` CLI | 4.16.2 | MIT |
| `radix-ui` | 1.6.7 | MIT |
| `lucide-react` | 1.30.0 | ISC |
| `class-variance-authority` | 0.7.1 | Apache-2.0 |
| `clsx` | 2.1.1 | MIT |
| `tailwind-merge` | 3.6.0 | MIT |
| `typescript` | 7.0.2 | Apache-2.0 |
| `@biomejs/biome` | 2.5.7 | MIT OR Apache-2.0 |
| `vitest` | 4.1.10 | MIT |
| `@playwright/test` | 1.62.1 | Apache-2.0 |
| `@testing-library/dom` | 10.4.1 | MIT |
| `@testing-library/react` | 16.3.2 | MIT |
| `@testing-library/user-event` | 14.6.3 | MIT |
| `jsdom` | 30.0.1 | MIT |
| `fallow` | 3.14.0 | MIT |

The locally reviewed Bun build is `1.3.14` (`1.3.14+0d9b296af`). The scaffold pins the exact Bun version in `packageManager` and `oven-sh/setup-bun`; Bun upgrades use explicit PRs together with `bun.lock` changes.

Before adding or updating a dependency:

1. Review release notes and peer dependencies.
2. Pin exact versions in the lockfile.
3. Record the OCCT commit/version and custom-build flags.
4. Preserve corresponding LGPL sources and reproducible build instructions.
5. Run compatibility and performance spikes on Chromium, Firefox, and Safari.

## Bun workspaces

Bun is used as:

- package manager and sole owner of `bun.lock`;
- runtime for project scripts and CLIs;
- workspace orchestrator through `--filter` and `--workspaces`;
- shared-version source through default and named catalogs;
- reproducible CI installer through `bun ci`.

Rules:

- the root package is `private: true`;
- workspaces are `apps/*` and `packages/*`;
- internal package dependencies use `workspace:*`;
- React, React DOM, TypeScript, Tailwind, and the test stack use catalogs;
- runtime dependencies are declared in the workspace that uses them; the root contains only repository-wide development and quality CLIs;
- `bun.lock` is mandatory and verified with `bun ci`;
- root scripts invoke package scripts through Bun filters;
- npm, pnpm, and Yarn lockfiles are not committed.

**Bun does not replace Vite** for the browser build. Vite remains responsible for React HMR, the browser bundle, the Tailwind plugin, workers, and WASM assets. Bun's bundler and test runner may be evaluated later, but the project must not maintain competing production builds.

**Turborepo is not part of the foundation.** The official shadcn monorepo scaffold may add it, but one application and the initial library set do not justify another task layer. Add Turbo only after measurements show dependency-aware caching materially reduces CI or local build time.

## Tooling and package patterns

The foundation adopts these proven monorepo patterns:

- one root Biome configuration with Git integration, recommended rules, import organization, and Tailwind v4 directive parsing;
- root scripts for `format`, `format:check`, and `lint`, with path-scoped Biome checks during iteration;
- a private `@vibeshape/typescript-config` workspace with separate `base`, `browser`, `worker`, and `react-library` configurations;
- `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, bundler resolution, and forced casing consistency in the base TypeScript contract;
- browser configs that include DOM types without Node or Bun globals;
- worker configs that include Web Worker types without exposing DOM window APIs;
- explicit package subpath exports instead of broad root barrels;
- a single `cn` implementation in `@vibeshape/ui`, built from `clsx` and `tailwind-merge`;
- state-agnostic form primitives with a separate TanStack Form integration export;
- single-flight async action controls that expose disabled, busy, loading, settlement, and duplicate-activation behavior;
- a framework-agnostic `@vibeshape/i18n` workspace for typed ICU catalogs, locale preference, and React context;
- Zod schemas at untrusted and versioned boundaries, with `is-what` limited to small runtime-kind narrowing after or alongside those boundaries;
- repository-local skills for UI, testing, scoped verification, dependency audits, Fallow, type guards, and documentation synchronization.

Do not copy patterns that do not fit this product:

- no Turborepo until measured build-graph or cache pressure exists;
- no syncpack while Bun catalogs are the single shared-version mechanism;
- no generic `utils` package as a default destination for unrelated helpers;
- no Node or Bun ambient types in browser-facing packages;
- no Next.js-specific shadcn, Tailwind, or package boundaries;
- no dependency overrides without an advisory, upstream constraint, and removal plan.

The quality gates are complementary:

- **Biome** owns formatting, lint rules, import organization, and supported source/config syntax.
- **TypeScript** owns compile-time type correctness for each explicit browser, worker, or library environment.
- **Fallow** owns changed-code risk, unused/dependency graph evidence, duplication, complexity, design-token drift signals, and configured internal package boundaries.
- **Tests and validators** own runtime behavior, geometry invariants, storage recovery, browser interactions, and file interoperability.

Fallow is installed as an exact root development dependency. Root scripts expose `fallow`, `fallow:audit`, and a score-oriented health command. `.fallowrc.jsonc` is version-pinned, discovers `apps/*` and `packages/*`, gates stale or reasonless suppressions, ignores generated trees, and encodes only durable package rules initially: `domain` and shared `ui` cannot import other internal packages. More boundary rules are added only after package contracts are accepted. The first full-repository run reported no dead code, duplication, architecture violations, or threshold failures after the shell and validator were decomposed.

Pull requests use `fallow audit` with the new-only gate and full Git history so inherited debt remains visible without blocking unrelated work. The GitHub Action and CLI are pinned to the same reviewed release; CI disables analysis cache for correctness across force-updated PR heads. PR comments require explicit least-privilege workflow permissions and are never a substitute for local output. Fallow's optional runtime product, telemetry, MCP server, and automatic fixes are not foundation requirements; automatic cleanup always begins with a dry run.

The Phase 1 root manifest adds this contract:

```json
{
  "scripts": {
    "fallow": "fallow",
    "fallow:audit": "fallow audit",
    "fallow:health": "fallow health --score"
  },
  "devDependencies": {
    "fallow": "3.14.0"
  }
}
```

The pull-request workflow checks out full history and uses the reviewed action commit, annotated with its release:

```yaml
permissions:
  contents: read
  id-token: write
  pull-requests: write
  checks: write

steps:
  - name: Fallow audit
    uses: fallow-rs/fallow@3cf8074a0e2e91c895c0a4224ba1c3bec4630d65 # v3.14.0
    with:
      version: "3.14.0"
      command: audit
      gate: new-only
      comment: true
      review-comments: true
      no-cache: true
```

`id-token: write` is required only for branded Fallow App feedback; without it, the action can fall back to the workflow token. If PR comments or reviews are disabled, remove the corresponding write permissions. SARIF upload is a separate opt-in and requires GitHub Code Scanning availability plus `security-events: write`; it is not enabled by default for VibeShape.

## Why OCCT instead of mesh CSG

OCCT represents bodies with exact curves, surfaces, and B-Rep topology. It supports modeling algorithms, shape healing, tessellation, and STEP data exchange. That matches parametric mechanical CAD.

A mesh kernel such as Manifold is useful for guaranteed-manifold triangle operations and print analysis, but it does not replace STEP/NURBS/B-Rep. A later `MeshBody` repair adapter may use Manifold behind a separate port.

## Replicad as a facade, not a domain foundation

Replicad reduces direct OCCT code, targets browsers, and recommends Web Workers. The project must not serialize Replicad classes or spread its API through the UI.

Phase 0 compares:

- Replicad with its custom OC build;
- a direct custom OpenCascade.js build exposing only required bindings.

Criteria include STEP round-trip, supported operations, WASM size and startup, memory lifecycle, operation history for `TopoRef`, TypeScript-definition quality, and reproducible builds.

If Replicad does not expose the required history or topology data, the adapter moves to direct OCCT without changing the domain or file format.

SPK-001 proved the Replicad `0.23.1` and custom `replicad-opencascadejs` `0.23.0` path across the required modeling and exchange operations in all three automated browser engines. It did not accept that package as the production binding: exact embedded OCCT provenance is unavailable, operation-history coverage is open, and extended Chromium runs show unexplained WASM linear-memory growth. The measurements and rework decision are recorded in [SPK-001 evidence](../spikes/spk-001-occt-worker.md).

## Why raw Three.js instead of React Three Fiber

React owns the interface shell, but the CAD viewport has a long-lived scene graph, frequent large-buffer replacement, sub-shape selection, and strict disposal requirements. Raw Three.js behind a `Viewer` port makes ownership explicit and keeps the render loop independent of React reconciliation.

WebGL2 is the baseline. WebGPU is promising but not an alpha requirement. Official Three.js examples cover WebGPU, GPU picking, clipping, and OffscreenCanvas; each becomes a separate adapter or measured spike.

## Why Vite instead of Next.js

- The CAD workspace does not need SSR or SEO routes.
- A backend is not part of the core.
- Static hosting and localhost deployment are simpler.
- Worker and WASM assets remain explicit.
- The runtime and deployment surface stay smaller.

A marketing site may live separately and does not define the CAD architecture.

## Why IndexedDB and OPFS instead of SQLite WASM initially

The domain document is an object snapshot and event journal, not an analytical relational database. Dexie provides sufficient transactions and indexes; OPFS stores large B-Rep and mesh caches.

SQLite WASM supports OPFS but introduces another WASM runtime, worker/VFS configuration, and browser-specific trade-offs. Add it only after a measured bottleneck or a genuine SQL/FTS requirement appears.

## Sketch solver

SolveSpace is GPL-3.0-or-later and has a browser build that the project describes as experimental. The full web port cannot be embedded without validation.

The spike must:

- expose a minimal solver ABI;
- build deterministic standalone WASM;
- cover every required P0 constraint;
- test conflict diagnostics, degeneracies, and memory;
- document source changes and the build pipeline.

If the spike fails, alternatives are:

1. Adapt another license-compatible FOSS nonlinear solver.
2. Implement a project-owned solver, the most expensive option.
3. Reduce alpha to a constrained sketch subset without broad solver promises.

## Formats

- STEP is read and written by the geometry worker through OCCT data exchange.
- Binary STL is generated from controlled tessellation; ASCII import is optional.
- The 3MF writer follows the Core specification and conformance samples or uses an adapted library. Official lib3mf lists native/Node bindings, but browser integration requires a spike.
- `.vshape` is a project-owned versioned ZIP container.

## UI toolkit

The accepted UI base is **Tailwind CSS v4 + shadcn/ui CLI v4 with Radix base**. shadcn components are copied into `packages/ui` as source, making them a design-system seed rather than an opaque runtime library.

- Tailwind uses the official `@tailwindcss/vite` plugin and `@import "tailwindcss"`.
- `packages/ui/components.json` routes primitives into the shared package.
- `apps/web/components.json` routes the `ui` alias to `@vibeshape/ui/components`.
- The Tailwind v4 config path in `components.json` remains empty.
- Style, base, icon library, and base color remain synchronized across configs.
- The base is Radix; the theme is compact, dark-first `new-york`, neutral/zinc, with one accent.
- Add only used primitives; `add --all` is prohibited.
- CAD-specific widgets compose primitives instead of being generated blindly into the shared package.
- Foundational colors use semantic CSS variables, not ad hoc palette classes.

See [UI system](ui-system.md).

## Automation and MCP

MCP is a transport dependency of the planned local Bun bridge, not a domain dependency. The repository does not pin `@modelcontextprotocol/sdk` until one real command can exercise the complete query, draft, preview, confirmation, commit, undo, and recovery path.

- `packages/domain`, geometry, persistence, feature, UI, and extension packages never import MCP types.
- Adapter-neutral automation schemas use plain serializable TypeScript contracts with runtime validation.
- The first MCP transport is `stdio`; protocol output is isolated from stderr diagnostics.
- In automation mode the bridge serves the reviewed static build and authenticated browser session from one stable localhost-only origin; connecting an independently hosted PWA is deferred.
- Streamable HTTP, OAuth authorization, remote deployment, and headless document ownership require later gates.
- A future SDK version is pinned exactly through the Bun catalog only when the executable integration begins.

See [Automation and MCP architecture](automation-and-mcp.md).

## Deployment

Supported modes:

- production static build on `localhost` through a small local server;
- self-hosted HTTPS static server;
- installable PWA after the first load.

`file://` is unsupported because module workers, WASM, service workers, and secure-context APIs require HTTP(S). Core functionality cannot depend on a CDN; fonts, WASM, and assets ship with the build.
