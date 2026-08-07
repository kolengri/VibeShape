# Research and Primary Sources

## Method

Reviewed on **2026-08-07**. Official documentation, specifications, and upstream repositories were prioritized. Exact npm package versions were checked against the registry on the same date.

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

**Conclusion:** OCCT is the only verified primary candidate for exact B-Rep modeling and STEP exchange. Replicad accelerates initial work but remains behind an adapter because of incomplete-binding risk and the need for topology history.

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

| Source | Evidence |
|---|---|
| [Bun workspaces](https://bun.sh/docs/pm/workspaces) | Root workspaces, `workspace:*`, filters, and workspace scripts |
| [Bun catalogs](https://bun.sh/docs/pm/catalogs) | Shared default and named dependency versions plus lockfile integration |
| [Bun install and CI](https://bun.sh/docs/pm/cli/install) | `bun ci` as a frozen-lockfile install and the official `setup-bun` CI path |
| [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite) | `tailwindcss`, `@tailwindcss/vite`, the Vite plugin, and `@import "tailwindcss"` |
| [shadcn/ui monorepo](https://ui.shadcn.com/docs/monorepo) | CLI routing, per-workspace `components.json`, shared UI exports, and the Tailwind v4 configuration rule |
| [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite) | Vite and Tailwind integration plus monorepo-aware component addition |
| [shadcn/ui CLI](https://ui.shadcn.com/docs/cli) | `init`, `add`, `view`, `diff`, and `info` workflows plus source-component management |

**Conclusion:** Bun workspaces cover the initial monorepo, package-version, and CI requirements without Turborepo. Tailwind v4 and shadcn/Radix have official Vite and monorepo paths; shared primitives belong in a dedicated workspace with explicit aliases and exports.

## npm Registry Snapshot

Results from `npm view <package> version license` on 2026-08-07:

- React 19.2.8, MIT
- Vite 8.2.1, MIT
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

The local Bun version was 1.3.14 (`1.3.14+0d9b296af`); it will be pinned during scaffolding.

Registry metadata does not replace the license files in the exact lockfile and distribution.

## Excluded or Rejected Conclusions

- Context7 results for Next.js and PostHog returned by an OpenCascade.js query were treated as irrelevant.
- Community comments were not used as the basis for key decisions when an upstream or official source existed.
- Exact performance promises were not copied from marketing material; they are defined as measurable Phase 0 goals.
- No claim of complete format compatibility will be made before fixture, conformance, and slicer testing.
