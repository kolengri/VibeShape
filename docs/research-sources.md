# Research and Primary Sources

## Method

Reviewed on **2026-08-08**. Official documentation, specifications, and upstream repositories were prioritized. Exact npm package versions were checked against the registry on 2026-08-07.

Context7 was used for library documentation. Searches for `OpenCascade.js` and `opencascade.js` did not produce an exact package match and returned unrelated results, so those results were excluded under the exact-match rule. Context7 confirmed `/mrdoob/three.js` and `/oven-sh/bun`; information about OCCT and OpenCascade.js came from official documentation and upstream repositories.

## CAD Kernel and Browser Binding

| Source | Evidence |
|---|---|
| [Open CASCADE Technology: Introduction](https://dev.opencascade.org/doc/overview/html/index.html) | B-Rep modeling data and algorithms, meshing, data exchange, shape healing, the application framework, and LGPL-2.1 with exception obligations |
| [OCCT Data Exchange](https://dev.opencascade.org/about/data_exchange) | STEP AP203/AP214/AP242, IGES, STL, glTF, and XDE attributes |
| [OCCT licensing FAQ](https://dev.opencascade.org/resources/faq) | GPL compatibility and the obligations of a software product that uses OCCT |
| [OpenCascade.js official project page](https://dev.opencascade.org/project/opencascadejs) | OCCT APIs in JavaScript, WebAssembly and Emscripten, TypeScript definitions, and custom builds |
| [OpenCascade.js upstream](https://github.com/donalffons/opencascade.js) | OCCT port to JavaScript/WASM, STEP and B-Rep scope, and LGPL-2.1 license |
| [Replicad](https://replicad.xyz/) | Browser B-Rep API built on OpenCascade, including STEP and fillet capabilities |
| [Replicad as a library](https://replicad.xyz/docs/use-as-a-library/) | Requirement to inject OCJS and recommendation to run computations in a Web Worker |
| [Replicad upstream](https://github.com/sgenoud/replicad) | MIT-licensed TypeScript abstraction over OpenCascade |
| [Replicad npm package](https://www.npmjs.com/package/replicad) | Published `0.23.1` metadata, dependency set, integrity, and source `gitHead` used by SPK-001 |
| [Replicad custom OCJS npm package](https://www.npmjs.com/package/replicad-opencascadejs) | Published `0.23.0` loader/WASM package used by SPK-001; its metadata does not identify the embedded OCCT source revision |
| [Replicad `0.23.0` OCJS build source](https://github.com/sgenoud/replicad/tree/19fb8212e0bb12a07a7a49f96950f8903903d469/packages/replicad-opencascadejs) | Exact binding list and build config; its build command uses an untagged OpenCascade.js builder image, so it cannot prove the npm WASM's OCCT source by itself |
| [OpenCascade.js upstream Dockerfile](https://github.com/donalffons/opencascade.js/blob/5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7/Dockerfile) | Emscripten `3.1.14`, OCCT commit `bb368e271e24f63078129283148ce83db6b9670a`, and custom-build toolchain used as the controlled-build baseline |
| [Official OCCT GitHub repository](https://github.com/Open-Cascade-SAS/OCCT) | Official source mirror, exact revision archive, LGPL-2.1 with exception, and source/build documentation |
| [Emscripten debugging guidance](https://emscripten.org/docs/porting/Debugging.html) | `mallinfo()` support for current allocation evidence |
| [Emscripten settings reference](https://emscripten.org/docs/tools_reference/settings_reference.html) | `ALLOW_MEMORY_GROWTH`, heap overgrowth, allocator choices, and the distinction between linear-memory capacity and live allocations |

**Conclusion:** OCCT is the only verified primary candidate for exact B-Rep modeling and STEP exchange. SPK-001 confirms that Replicad accelerates the required browser operations, but it remains behind an adapter because of incomplete published-artifact provenance, allocator-observability, binding, and topology-history risks. The controlled-build inputs and allocator binding are now prepared, not yet accepted. See [SPK-001 evidence](spikes/spk-001-occt-worker.md).

## Viewport

Three.js documentation was retrieved through Context7 for `/mrdoob/three.js` and cross-checked against official source examples:

- [WebGPU performance example](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_performance.html) — `WebGPURenderer` and `compileAsync`
- [Clipping example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_clipping.html) — local and global clipping planes
- [GPU picking example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_interactive_cubes_gpu.html) — offscreen picking target
- [OffscreenCanvas worker example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_worker_offscreencanvas.html) — worker rendering and browser caveats
- [Three.js upstream](https://github.com/mrdoob/three.js) — MIT-licensed WebGL and WebGPU renderer

**Conclusion:** WebGL2 is the baseline; GPU picking and clipping are available. WebGPU and OffscreenCanvas remain optional adapters pending profiling.

## Sketch Solver and Parametric Stability

| Source | Evidence |
|---|---|
| [SolveSpace upstream](https://github.com/solvespace/solvespace) | Parametric 2D and 3D CAD, GPL-3.0-or-later, and an experimental web build with critical bugs and unimplemented functions |
| [SolveSpace license](https://github.com/solvespace/solvespace/blob/master/COPYING.txt) | Full GPL-3.0 text and terms |
| [FreeCAD: topological naming problem mirror](https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/cs/Topological_naming_problem.html) | Face and edge references break after topology changes; the problem is general to CAD; datum and origin references are more stable |
| [Onshape Part Studios help](https://cad.onshape.com/help/Content/PartStudio/part_studios.htm) | Feature list and Part Studio as a useful functional-model reference |
| [Onshape integrated PDM](https://www.onshape.com/en/features/product-data-management) | History, versions, branching, and merging as intentionally deferred cloud and PDM scope |

**Conclusion:** the solver needs a dedicated subset spike; the complete experimental SolveSpace web UI will not be embedded. Topological naming must be designed before the feature model, not patched after the MVP.

## 3D Printing and Formats

| Source | Evidence |
|---|---|
| [3MF specification suite](https://3mf.io/spec/) | 3MF, ISO/IEC 25422:2025, Core and extension specifications, and royalty-free terms |
| [3MF overview](https://3mf.io/) | ZIP/XML container, units, and full-fidelity manufacturing exchange |
| [3MF Core source](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) | Package structure, resources, metadata, and units |
| [3MF samples and conformance](https://github.com/3MFConsortium/3mf-samples) | Implementation guidance, sample files, and conformance tests |
| [lib3mf 2.5.0 documentation](https://lib3mf.readthedocs.io/en/master/index.html) | Official reader, writer, and validation library plus listed bindings, including Node.js |
| [PrusaSlicer upstream](https://github.com/prusa3d/PrusaSlicer) | libslic3r and CLI scope plus AGPL-3.0 license |
| [CuraEngine upstream](https://github.com/Ultimaker/CuraEngine) | Standalone C++ G-code engine under AGPL-3.0 |
| [Manifold upstream](https://github.com/elalish/manifold) | Robust manifold triangle-mesh library with JavaScript, TypeScript, and WASM bindings; it is a mesh engine, not a B-Rep or STEP replacement |

**Conclusion:** 3MF is the primary print-exchange format; a complete slicer is a later, separate track. A mesh kernel may supplement analysis and repair but does not replace OCCT.

## Local-First Web Platform

| Source | Evidence |
|---|---|
| [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) | OPFS, synchronous worker access, quotas, and deletion when site data is cleared |
| [MDN: showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker) | User-visible file save as a progressive API requiring permission and a secure context, with a required fallback |
| [MDN: storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | Best-effort and persistent storage plus eviction behavior |
| [SQLite WASM persistent storage](https://sqlite.org/wasm/doc/trunk/persistence.md) | OPFS VFS, worker requirements, and browser trade-offs |
| [web.dev: service workers](https://web.dev/learn/pwa/service-workers) | Offline caching, request interception, and lifecycle |
| [web.dev: PWA installation](https://web.dev/learn/pwa/installation) | Manifest and installability differences across browsers and operating systems |

**Conclusion:** OPFS and IndexedDB are suitable for the internal working set but are not a guaranteed backup. Native `.vshape` files and fallback upload/download flows are mandatory.

## Monorepo and UI Toolchain

Context7 resolved Fallow to `/fallow-rs/fallow` and `/fallow-rs/docs`; the current configuration and CI contract were cross-checked against the version-matched 3.14.0 package schema, CLI, GitHub Action, and npm metadata.

| Source | Evidence |
|---|---|
| [Bun workspaces](https://bun.sh/docs/pm/workspaces) | Root workspaces, `workspace:*`, filters, and workspace scripts |
| [Bun catalogs](https://bun.sh/docs/pm/catalogs) | Shared default and named dependency versions plus lockfile integration |
| [Bun install and CI](https://bun.sh/docs/pm/cli/install) | `bun ci` as a frozen-lockfile install and the official `setup-bun` CI path |
| [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite) | `tailwindcss`, `@tailwindcss/vite`, the Vite plugin, and `@import "tailwindcss"` |
| [shadcn/ui monorepo](https://ui.shadcn.com/docs/monorepo) | CLI routing, per-workspace `components.json`, shared UI exports, and the Tailwind v4 configuration rule |
| [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite) | Vite and Tailwind integration plus monorepo-aware component addition |
| [shadcn/ui CLI](https://ui.shadcn.com/docs/cli) | `init`, `add`, `view`, `diff`, and `info` workflows plus source-component management |
| [TanStack Form React quick start](https://tanstack.com/form/latest/docs/framework/react/quick-start) | `createFormHookContexts`, `createFormHook`, reusable field/form components, typed values, and async submission |
| [TanStack Form reactivity](https://tanstack.com/form/latest/docs/framework/react/guides/reactivity) | Focused `form.Subscribe` state selection for submit controls and other reactive UI |
| [use-intl package guide](https://github.com/amannn/next-intl/tree/main/packages/use-intl) | Framework-agnostic `IntlProvider`, typed `useTranslations`, nested ICU messages, and React usage without Next.js |
| [next-intl TypeScript guide](https://next-intl.dev/docs/workflows/typescript) | `AppConfig` augmentation for typed Locale, Messages, and Formats, shared with the underlying `use-intl` package |
| [Biome configuration](https://biomejs.dev/reference/configuration/) | Git ignore integration, formatting, linting, import organization, scoped file selection, and Tailwind CSS directive parsing |
| [Biome in large projects](https://biomejs.dev/guides/big-projects/) | Root and nested configuration behavior for monorepos and workspaces |
| [Fallow documentation](https://docs.fallow.tools/) | Static codebase intelligence scope, configuration, audit workflow, exit semantics, and integrations |
| [Fallow audit reference](https://docs.fallow.tools/cli/audit) | Merge-base changed-file analysis, pass/warn/fail verdicts, and exit codes |
| [Fallow upstream and GitHub Action](https://github.com/fallow-rs/fallow) | MIT-licensed CLI, versioned Agent Skill, Bun installation, action permissions, full-history checkout, and PR feedback |

**Conclusion:** Bun workspaces cover the initial monorepo, package-version, and CI requirements without Turborepo. Tailwind v4 and shadcn/Radix have official Vite and monorepo paths; shared primitives belong in a dedicated workspace with explicit aliases and exports. Biome provides deterministic formatting and linting, TypeScript owns compile-time correctness, and Fallow adds changed-code and architecture intelligence; project-specific tests remain separate gates.

## UX, Accessibility, and Component Behavior

Context7 resolved shadcn/ui to the high-reputation `/shadcn-ui/ui` source and was used to verify current dialog, alert-dialog, command, context-menu, and composition behavior.

| Source | Evidence |
|---|---|
| [shadcn/ui component documentation](https://ui.shadcn.com/docs/components) | Source-owned accessible component compositions for dialogs, alert dialogs, command menus, fields, context menus, tooltips, and related primitives |
| [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Normative accessibility baseline, including keyboard access, contrast, input assistance, focus, target size, and status messages |
| [W3C: Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) | 24 × 24 CSS px minimum target or defined spacing exceptions |
| [W3C: Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance) | Focus-indicator area equivalent to a 2 CSS px perimeter and visibility guidance |
| [W3C: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color) | Color cannot be the only visual means of conveying state or action |
| [W3C: Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification) | Automatically detected errors identify the affected input and describe the error in text |
| [W3C: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | Status changes are programmatically determinable without unnecessarily moving focus |
| [WAI-ARIA APG: Toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) | One toolbar tab stop with arrow-key navigation among grouped controls |
| [WAI-ARIA APG: Menu and menubar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/) | Conventional menu keyboard behavior and ellipsis for commands that open a dialog |
| [WAI-ARIA APG: Developing a keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/) | Consistent focus movement, shortcut behavior, and composite-widget conventions |

**Conclusion:** VibeShape targets WCAG 2.2 AA for its application chrome and uses tested shadcn/Radix primitives plus APG interaction patterns. The WebGL canvas retains accessible HTML equivalents for document structure, commands, selection summaries, and diagnostics; the project documents limitations of free-form spatial authoring instead of claiming complete canvas accessibility.

## npm Registry Snapshot

Results from `npm view <package> version license` on 2026-08-07:

- React 19.2.8, MIT
- React DOM 19.2.8, MIT
- Vite 8.2.1, MIT
- `@vitejs/plugin-react` 6.0.5, MIT
- `@tanstack/react-form` 1.33.3, MIT
- `use-intl` 4.13.5, MIT; its direct runtime dependencies are MIT except `intl-messageformat` 11.1.0, which is BSD-3-Clause
- Three.js 0.185.1, MIT
- Replicad 0.23.1, MIT
- OpenCascade.js 1.1.1, LGPL-2.1-only
- Zustand 5.0.14, MIT
- Dexie 4.4.4, Apache-2.0
- Zod 4.4.3, MIT
- Tailwind CSS 4.3.3, MIT
- `@tailwindcss/vite` 4.3.3, MIT
- shadcn CLI 4.16.2, MIT
- Unified `radix-ui` 1.6.7, MIT
- Lucide React 1.30.0, ISC
- class-variance-authority 0.7.1, Apache-2.0
- clsx 2.1.1, MIT
- tailwind-merge 3.6.0, MIT
- TypeScript 7.0.2, Apache-2.0
- Biome 2.5.7, MIT OR Apache-2.0
- Vitest 4.1.10, MIT
- Playwright 1.62.1, Apache-2.0
- Testing Library DOM 10.4.1, React 16.3.2, and user-event 14.6.3, MIT
- jsdom 30.0.1, MIT
- Fallow 3.14.0, MIT

The local Bun version is 1.3.14 (`1.3.14+0d9b296af`) and is pinned in `packageManager`, CI, and the generated lockfile workflow. Context7 resolved shadcn/ui to `/shadcn-ui/ui`; the scaffold was cross-checked with the current Vite monorepo, package-import, Tailwind v4, and CLI v4 guidance. `shadcn info` resolved the checked-in app as Vite, Tailwind v4, Radix, `new-york`, and the shared `@vibeshape/ui` aliases.

Registry metadata does not replace the license files in the exact lockfile and distribution.

## Excluded or Rejected Conclusions

- Context7 results for Next.js and PostHog returned by an OpenCascade.js query were treated as irrelevant.
- Community comments were not used as the basis for key decisions when an upstream or official source existed.
- Exact performance promises were not copied from marketing material; they are defined as measurable Phase 0 goals.
- No claim of complete format compatibility will be made before fixture, conformance, and slicer testing.
