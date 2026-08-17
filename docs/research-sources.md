# Research and Primary Sources

## Method

Reviewed on **2026-08-08**. Official documentation, specifications, and upstream repositories were prioritized. Exact npm package versions were checked against the registry on 2026-08-07.

Context7 was used for library and protocol documentation. Searches for `OpenCascade.js` and `opencascade.js` did not produce an exact package match and returned unrelated results, so those results were excluded under the exact-match rule. Context7 confirmed `/freecad/freecad`, `/mrdoob/three.js`, `/oven-sh/bun`, `/101arrowz/fflate`, and `/modelcontextprotocol/modelcontextprotocol`; information about OCCT and OpenCascade.js came from official documentation and upstream repositories.

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
| [OpenCascade.js binding generator](https://github.com/donalffons/opencascade.js/blob/5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7/src/bindings.py) | Upstream source for the reviewed destructor correction: placement delete no longer suppresses an available public ordinary destructor |
| [OCCT allocation macro](https://github.com/Open-Cascade-SAS/OCCT/blob/bb368e271e24f63078129283148ce83db6b9670a/src/Standard/Standard_DefineAlloc.hxx) | `DEFINE_STANDARD_ALLOC` declares ordinary allocation/deallocation plus placement new/delete, so placement delete alone does not imply that native destruction is unavailable |
| [Official OCCT GitHub repository](https://github.com/Open-Cascade-SAS/OCCT) | Official source mirror, exact revision archive, LGPL-2.1 with exception, and source/build documentation |
| [OCCT LGPL-2.1 text at the controlled revision](https://github.com/Open-Cascade-SAS/OCCT/blob/bb368e271e24f63078129283148ce83db6b9670a/LICENSE_LGPL_21.txt) | Exact license text preserved in the controlled corresponding-source bundle |
| [OCCT exception at the controlled revision](https://github.com/Open-Cascade-SAS/OCCT/blob/bb368e271e24f63078129283148ce83db6b9670a/OCCT_LGPL_EXCEPTION.txt) | Exact OCCT exception preserved in the controlled corresponding-source bundle |
| [OpenCascade.js license at the controlled revision](https://github.com/donalffons/opencascade.js/blob/5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7/LICENSE) | Exact LGPL-2.1 text preserved with the modified binding generator source |
| [FreeType licensing](https://freetype.org/license.html) | FreeType License attribution and licensing choices for the controlled build input |
| [Emscripten debugging guidance](https://emscripten.org/docs/porting/Debugging.html) | `mallinfo()` support for current allocation evidence |
| [Emscripten settings reference](https://emscripten.org/docs/tools_reference/settings_reference.html) | `ALLOW_MEMORY_GROWTH`, heap overgrowth, allocator choices, and the distinction between linear-memory capacity and live allocations |
| [FreeCAD startup and configuration](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Start_up_and_Configuration.md) | Official headless `FreeCADCmd`/`freecadcmd` invocation and script-file execution used by the local interoperability gate |
| [FreeCAD topological data scripting](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Topological_data_scripting.md) | Official `Part.Shape.read` STEP import path used to measure the browser-exported fixture |
| [FreeCAD upstream](https://github.com/FreeCAD/FreeCAD) | Independent application source, version identity, and its OCCT-based geometry implementation |

**Conclusion:** OCCT is the only verified primary candidate for exact B-Rep modeling and STEP exchange. SPK-001 confirms that Replicad accelerates the required browser operations and that the controlled allocator-instrumented candidate builds from verified sources with the reviewed destructor correction. Boolean and fillet history relations are available through the pinned binding surface. Purpose-owned OCCT adapter lifetimes are allocation-neutral in 1,000-operation blocks, the full fixture reaches a 448-byte post-warmup drift across four further batches, and the declared Apple M1 baseline passes the controlled worker performance budget. The verified corresponding-source bundle closes the technical release-bundle gate. FreeCAD 1.1.3 independently consumes the browser-exported STEP file through `Part.Shape.read` and reports one valid solid with matching volume and bounds. Because FreeCAD also uses OCCT internally, this establishes application and import-path interoperability rather than kernel diversity. The binding passes the Phase 0 stop/go gate but remains quarantined until the production facade and extended corpus are reviewed; stable `TopoRef` behavior remains a separate SPK-003 gate, and public release still requires legal review. See [SPK-001 evidence](spikes/spk-001-occt-worker.md).

## Viewport

Three.js documentation was retrieved through Context7 for `/mrdoob/three.js` and cross-checked against official source examples:

- [Custom BufferGeometry manual](https://github.com/mrdoob/three.js/blob/dev/manual/pages/custom-buffergeometry.html) — direct typed-array `BufferAttribute` construction
- [Voxel geometry manual](https://github.com/mrdoob/three.js/blob/dev/manual/pages/voxel-geometry.html) — positions, normals, and indexed `BufferGeometry`
- [glTF fit-camera example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_loader_gltf.html) — bounds, target, distance, and projection updates
- [Orthographic camera example](https://github.com/mrdoob/three.js/blob/dev/examples/css3d_orthographic.html) — resize-aware frustum updates
- [On-demand rendering manual](https://github.com/mrdoob/three.js/blob/dev/manual/pages/rendering-on-demand.html) — OrbitControls change-driven rendering without an idle loop
- [Terrain raycasting example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_geometry_terrain_raycast.html) — normalized pointer coordinates and CPU `Raycaster` intersection
- [Three.js `Mesh` source](https://github.com/mrdoob/three.js/blob/dev/src/objects/Mesh.js) — indexed triangle intersection and `faceIndex` behavior
- [OrbitControls documentation](https://threejs.org/docs/#examples/en/controls/OrbitControls) — mouse-button remapping and change events
- [WebGPU performance example](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_performance.html) — `WebGPURenderer` and `compileAsync`
- [Clipping example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_clipping.html) — local and global clipping planes
- [GPU picking example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_interactive_cubes_gpu.html) — offscreen picking target
- [OffscreenCanvas worker example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_worker_offscreencanvas.html) — worker rendering and browser caveats
- [Three.js upstream](https://github.com/mrdoob/three.js) — MIT-licensed WebGL and WebGPU renderer

**Conclusion:** WebGL2 is the baseline. The first selection slice uses CPU raycasting and maps an indexed `faceIndex` through worker-provided triangle metadata before extracting an exact disposable face overlay. GPU picking remains available for later measured scale requirements, while clipping, WebGPU, and OffscreenCanvas remain optional adapters pending profiling.

## Sketch Solver and Parametric Stability

| Source | Evidence |
|---|---|
| [SolveSpace upstream](https://github.com/solvespace/solvespace) | Parametric 2D and 3D CAD, GPL-3.0-or-later, and an experimental web build with critical bugs and unimplemented functions |
| [SolveSpace v3.2 release](https://github.com/solvespace/solvespace/releases/tag/v3.2) | Stable source release selected by SPK-002 |
| [SolveSpace C solver API](https://github.com/solvespace/solvespace/blob/27b6a080c8b669421bd4d444650c3b8eddec5687/include/slvs.h) | `Slvs_System`, entity and constraint records, result codes, failed constraints, and degrees of freedom |
| [SolveSpace WASM target](https://github.com/solvespace/solvespace/blob/27b6a080c8b669421bd4d444650c3b8eddec5687/src/slvs/CMakeLists.txt) | Official Emscripten target and the broad upstream Embind boundary replaced by the narrow spike wrapper |
| [SolveSpace license](https://github.com/solvespace/solvespace/blob/master/COPYING.txt) | Full GPL-3.0 text and terms |
| [FreeCAD: topological naming problem mirror](https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/cs/Topological_naming_problem.html) | Face and edge references break after topology changes; the problem is general to CAD; datum and origin references are more stable |
| [Onshape Part Studios help](https://cad.onshape.com/help/Content/PartStudio/part_studios.htm) | Feature list and Part Studio as a useful functional-model reference |
| [Onshape integrated PDM](https://www.onshape.com/en/features/product-data-management) | History, versions, branching, and merging as intentionally deferred cloud and PDM scope |

**Conclusion:** SPK-002 validates the stable solver subset behind VibeShape's flat worker ABI; the complete experimental SolveSpace web UI will not be embedded. Topological naming must be designed before the feature model, not patched after the MVP.

## 3D Printing and Formats

| Source | Evidence |
|---|---|
| [3MF specification suite](https://3mf.io/spec/) | 3MF, ISO/IEC 25422:2025, Core and extension specifications, and royalty-free terms |
| [3MF overview](https://3mf.io/) | ZIP/XML container, units, and full-fidelity manufacturing exchange |
| [3MF Core source](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) | Core revision 1.4.0 package structure, resources, metadata, units, mesh rules, and transforms |
| [3MF samples and conformance](https://github.com/3MFConsortium/3mf-samples) | Implementation guidance, sample files, and conformance tests |
| [lib3mf 2.5.0 documentation](https://lib3mf.readthedocs.io/en/master/index.html) | Official reader, writer, and validation library plus listed bindings, including Node.js |
| [fflate upstream](https://github.com/101arrowz/fflate) | MIT-licensed browser-compatible ZIP implementation with synchronous archive APIs and per-file options used by the Core writer |
| [PrusaSlicer upstream](https://github.com/prusa3d/PrusaSlicer) | libslic3r and CLI scope plus AGPL-3.0 license |
| [CuraEngine upstream](https://github.com/Ultimaker/CuraEngine) | Standalone C++ G-code engine under AGPL-3.0 |
| [Manifold upstream](https://github.com/elalish/manifold) | Robust manifold triangle-mesh library with JavaScript, TypeScript, and WASM bindings; it is a mesh engine, not a B-Rep or STEP replacement |

**Conclusion:** 3MF is the primary print-exchange format; a complete slicer is a later, separate track. SPK-004 selects a project-owned Core writer with `fflate` and verifies its deterministic fixture through PrusaSlicer plus the Orca/Bambu family. A mesh kernel may supplement analysis and repair but does not replace OCCT.

## Local-First Web Platform

Context7 resolved Dexie to `/dexie/dexie.js`. The SPK-005 transaction and error contracts were cross-checked against the current Dexie 4.4.4 documentation before implementation.

| Source | Evidence |
|---|---|
| [Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction()) | Explicit multi-table read/write transactions, atomic rollback, and transaction-zone constraints |
| [Dexie versioned stores](https://dexie.org/docs/Version/Version.stores()) | IndexedDB schema declaration and versioned upgrade boundary |
| [Dexie error names](https://dexie.org/docs/DexieErrors/DexieErrors) | Named IndexedDB failure classes including quota and abort conditions |
| [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) | OPFS, synchronous worker access, quotas, and deletion when site data is cleared |
| [MDN: showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker) | User-visible file save as a progressive API requiring permission and a secure context, with a required fallback |
| [MDN: storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | Best-effort and persistent storage plus eviction behavior |
| [SQLite WASM persistent storage](https://sqlite.org/wasm/doc/trunk/persistence.md) | OPFS VFS, worker requirements, and browser trade-offs |
| [web.dev: service workers](https://web.dev/learn/pwa/service-workers) | Offline caching, request interception, and lifecycle |
| [web.dev: PWA installation](https://web.dev/learn/pwa/installation) | Manifest and installability differences across browsers and operating systems |

**Conclusion:** SPK-005 selects explicit Dexie multi-store transactions for semantic history and keeps OPFS outside semantic atomicity. The local Chromium, Firefox, and WebKit matrix proves forced-page recovery, checksum replay, bounded loss reporting, writer takeover, quota rollback, and cached-shell offline reopen. The recorded WebKit runtime cannot open the exposed OPFS root, which confirms that capability invocation and a cache-disabled degraded mode are required. OPFS and IndexedDB remain origin-local working storage rather than a guaranteed backup; native `.vshape` files and fallback upload/download flows are mandatory.

## Extension Platforms and Browser Isolation

| Source | Evidence |
|---|---|
| [Onshape FeatureScript introduction](https://cad.onshape.com/FsDoc/intro.html) | Built-in and custom feature types share a function model; regeneration executes the build function; determinism excludes external input, time, and randomness |
| [Onshape custom features](https://cad.onshape.com/help/Content/PartStudio/add_custom_features.htm?cshid=customfeature) | Custom features link to exact document versions, update explicitly, remain available to existing models, and execute in a Part Studio-limited sandbox with acknowledged resource-exhaustion risk |
| [Onshape application extensions](https://onshape-public.github.io/docs/app-dev/extensions/) | Hosted applications integrate separately through iframe UI or REST actions and validate message origins and document context |
| [VS Code extension hosts](https://code.visualstudio.com/api/advanced-topics/extension-host) | Extensions run outside the UI process in environment-specific hosts and activate lazily to reduce startup and UI impact |
| [VS Code web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions) | Browser extensions use a Web Worker host, lack Node.js APIs, and access workspace files through a host API rather than ambient filesystem access |
| [VS Code Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust) | Restricted Mode prevents automatic code execution from untrusted workspaces and distinguishes full, limited, and unsupported extension behavior |
| [Figma plugin manifest](https://developers.figma.com/docs/plugins/manifest/) | Manifest-declared API version, code/UI entry points, document access, and exact network allowlists including an explicit no-network value |
| [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) | Omitting `allow-same-origin` gives sandboxed content a special origin; combining same-origin and scripts for same-origin content defeats the intended isolation |
| [MDN `postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) | Cross-context messages require sender/source checks, exact target origins where available, and validation of received data |
| [MDN Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy) | CSP constrains script, connection, frame, worker, and other resource sources but must be applied to each relevant execution context |
| [WebAssembly security](https://webassembly.org/docs/security/) | WebAssembly provides fault isolation but remains subject to its embedding and host APIs |
| [WebAssembly portability](https://webassembly.org/docs/portability/) | WebAssembly defines imports rather than system calls, allowing the host to control which external functions exist |
| [`fflate` repository](https://github.com/101arrowz/fflate) | Small synchronous and streaming ZIP/DEFLATE implementation; SPK-006 preflights the central directory before using filtered extraction |

**Conclusion:** VibeShape should copy Onshape's deterministic, version-linked feature principle, not its mandatory cloud application topology. SPK-006 confirms that the safer browser design combines immutable artifact locks, separate execution profiles, capability-scoped host APIs, opaque-origin UI, runtime message validation, termination budgets, and restricted-mode recovery. It also confirms that a same-origin JavaScript worker retains ambient authority. No single worker, iframe, WebAssembly module, signature, or CSP rule is a complete extension sandbox.

## Model Context Protocol

Context7 resolved the primary MCP specification to `/modelcontextprotocol/modelcontextprotocol`. The architecture targets negotiated protocol compatibility and does not pin a TypeScript SDK until the first executable integration spike.

| Source | Evidence |
|---|---|
| [MCP server feature overview](https://modelcontextprotocol.io/specification/2025-11-25/server) | Tools are model-controlled, resources are application-controlled, and prompts are user-controlled protocol primitives |
| [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | JSON input/output schemas, structured results, tool annotations, tool-list changes, validation, and human-in-the-loop guidance |
| [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources) | URI-addressed context, templates, pagination, subscriptions, and change notifications |
| [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) | Standard `stdio` and Streamable HTTP transports; local HTTP requires Origin validation, localhost binding, and authentication to prevent DNS rebinding |
| [MCP progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress) | Request-scoped progress tokens and monotonic progress notifications for active operations |
| [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation) | Cancellation notifications, race handling, and terminal-request behavior |
| [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) | HTTP authorization, protected resource metadata, resource indicators, token audience validation, PKCE, and the prohibition on token passthrough |
| [MCP TypeScript schema](https://github.com/modelcontextprotocol/modelcontextprotocol/tree/main/schema) | The versioned TypeScript and generated JSON schemas are the normative machine-readable protocol definition |

**Conclusion:** MCP should terminate in a local adapter rather than inside domain or extension packages. Resources map to bounded revisioned views, tools map to explicit draftable commands, and protocol annotations supplement rather than replace VibeShape authorization, preview, confirmation, and audit enforcement. `stdio` is the smallest first transport; a browser pairing channel still needs explicit loopback authentication and origin defense.

## Desktop slicer handoff

| Source | Evidence |
|---|---|
| [PrusaSlicer supported-website downloader](https://help.prusa3d.com/article/opening-models-in-prusaslicer-from-supported-websites_399198) | PrusaSlicer can register a URL downloader for supported websites, but the flow retrieves a remotely addressable model and applies website allowlisting rather than accepting a browser-owned local `Blob` |
| [Bambu Studio command-line usage](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage) | Bambu Studio accepts model files, including 3MF, as positional command-line inputs |
| [PrusaSlicer command-line interface](https://github.com/prusa3d/PrusaSlicer/wiki/Command-Line-Interface) | PrusaSlicer accepts a model file through its command-line interface |
| [Snapmaker Orca quick-start guide](https://wiki.snapmaker.com/en/Snapmaker_Orca/manual/orca_qsg) | Snapmaker Orca imports 3MF project files through the desktop application |
| [MDN Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API) | Sharing is initiated by user activation and delegated to an operating-system-selected target; the web application does not own a remembered target-application launch contract |
| [Bun `spawn`](https://bun.sh/docs/runtime/child-process) | Array-form process arguments allow a local adapter to launch one reviewed executable without invoking a shell |

**Conclusion:** browser-only one-click launch cannot reliably transfer a locally generated 3MF to a remembered arbitrary desktop slicer. The smallest local-first design is an explicitly paired loopback adapter that accepts only bounded 3MF bytes and an allowlisted slicer ID, launches without a shell, and falls back to a transparent browser download.

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
| [Zustand vanilla store and React context](https://github.com/pmndrs/zustand/blob/v5.0.12/README.md) | Per-provider vanilla store instances, context injection, and selector-based `useStore` subscriptions |
| [Zustand Immer middleware](https://github.com/pmndrs/zustand/blob/v5.0.12/docs/reference/integrations/immer-middleware.md) | Typed nested updates through `zustand/middleware/immer` without exposing mutation to consumers |
| [TanStack Form React quick start](https://tanstack.com/form/latest/docs/framework/react/quick-start) | `createFormHookContexts`, `createFormHook`, reusable field/form components, typed values, and async submission |
| [TanStack Form reactivity](https://tanstack.com/form/latest/docs/framework/react/guides/reactivity) | Focused `form.Subscribe` state selection for submit controls and other reactive UI |
| [use-intl package guide](https://github.com/amannn/next-intl/tree/main/packages/use-intl) | Framework-agnostic `IntlProvider`, typed `useTranslations`, nested ICU messages, and React usage without Next.js |
| [next-intl TypeScript guide](https://next-intl.dev/docs/workflows/typescript) | `AppConfig` augmentation for typed Locale, Messages, and Formats, shared with the underlying `use-intl` package |
| [Biome configuration](https://biomejs.dev/reference/configuration/) | Git ignore integration, formatting, linting, import organization, scoped file selection, and Tailwind CSS directive parsing |
| [Biome in large projects](https://biomejs.dev/guides/big-projects/) | Root and nested configuration behavior for monorepos and workspaces |
| [Fallow documentation](https://docs.fallow.tools/) | Static codebase intelligence scope, configuration, audit workflow, exit semantics, and integrations |
| [Fallow audit reference](https://docs.fallow.tools/cli/audit) | Merge-base changed-file analysis, pass/warn/fail verdicts, and exit codes |
| [Fallow upstream and GitHub Action](https://github.com/fallow-rs/fallow) | MIT-licensed CLI, versioned Agent Skill, Bun installation, action permissions, full-history checkout, and PR feedback |

**Conclusion:** Bun workspaces cover the initial monorepo, package-version, and CI requirements without Turborepo. Tailwind v4 and shadcn/Radix have official Vite and monorepo paths; shared primitives belong in a dedicated workspace with explicit aliases and exports. One vanilla Zustand store per editor session coordinates transient state through selectors and Immer actions without replacing the document or form authorities. Biome provides deterministic formatting and linting, TypeScript owns compile-time correctness, and Fallow adds changed-code and architecture intelligence; project-specific tests remain separate gates.

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

## CAD Editor Interaction Models

| Source | Evidence |
|---|---|
| [Onshape user interface basics](https://cad.onshape.com/help/Content/Home/user_interface_basics.htm) | Stable Part Studio graphics area, feature list, workflow-specific toolbars, grouped overflow, explicit dialogs, selection, undo/redo, and error indicators |
| [Onshape sketch tools](https://cad.onshape.com/help/Content/Sketch/sketch_tools.htm) | Sketch toolbar activation, grouped and last-used tools, shortcut toolbar, `Escape`, constraint visibility, and the transition from a valid open sketch into Extrude or Revolve |
| [Onshape Linear Sketch Pattern](https://cad.onshape.com/help/Content/Sketch/sketch_linear_pattern.htm) | One/two-direction counts, spacing, angle controls, acceptance grammar, and preview cap |
| [Onshape Circular Sketch Pattern](https://cad.onshape.com/help/Content/Sketch/sketch_circular_pattern.htm) | Open/closed angle behavior and relocatable pattern center |
| [Onshape Automatic Inferencing](https://cad.onshape.com/help/Content/Sketch/automatic_inferencing.htm) | Persistent automatic constraints, common horizontal/vertical/midpoint/parallel/coincident candidates, reference wake-up behavior, and temporary Shift suppression |
| [Onshape Midpoint Line](https://cad.onshape.com/help/Content/Sketch/midpoint_line.htm) | Midpoint-first symmetric segment authoring and persistent midpoint relation |
| [Onshape Center Point Rectangle](https://cad.onshape.com/help/Content/Sketch/center_point_rectangle.htm) | Center-first symmetric rectangle workflow and construction diagonals |
| [Onshape Aligned Rectangle](https://cad.onshape.com/help/Content/Sketch/aligned_rectangle.htm) | First-side definition, third perpendicular-width pick, and persistent aligned rectangle intent |
| [Autodesk Inventor 2026 rectangle tools](https://help.autodesk.com/cloudhelp/2026/ENU/Inventor-Help/files/GUID-D489CE6D-7299-4211-A43A-F3580A4BA357.htm) | Three-point center rectangle interaction: center, direction/half-length, and adjacent half-width |
| [Onshape 3 Point Circle](https://cad.onshape.com/help/Content/Sketch/3_point_circle.htm) | Exact circle placement through three circumference points |
| [Onshape Center Point Arc](https://cad.onshape.com/help/Content/Sketch/center_point_arc.htm) | Center, start, and endpoint arc workflow |
| [Onshape Elliptical Arc](https://cad.onshape.com/help/Content/Sketch/elliptical_arc.htm) | Center, primary-axis radius, secondary-radius/start point, temporary construction ellipse, endpoint, and quadrant snapping workflow |
| [Onshape Tangent Arc](https://cad.onshape.com/help/Content/Sketch/arc_tangent.htm) | Line-endpoint continuation, tangent intent, `Shift+A`, and return to Line after completion |
| [Onshape Slot](https://cad.onshape.com/help/Content/Sketch/slot.htm) | Selection-first or tool-first slot creation around sketch curves, explicit width control, and chain-selection follow-up behavior |
| [Onshape dialogs](https://cad.onshape.com/help/Content/Home/dialogs.htm) | Distinct selection and keyboard-input fields plus feature editing in historical context |
| [Autodesk Fusion interface](https://help.autodesk.com/view/fusion360/ENU/?contextId=LP-STEPS-P13N-SNP-GS-OTH-CRD-1) | Stable Browser and canvas, contextual toolbar tabs, ViewCube/navigation, marking menu, and chronological parametric Timeline |
| [Autodesk Fusion sketches](https://help.autodesk.com/view/fusion360/ENU/?contextId=SKT-3D-SKETCH) | Contextual Sketch tab, sketch palette, construction/grid/profile/dimension visibility controls, and automatic transition into a 3D feature command |
| [Autodesk Fusion edit sketch](https://help.autodesk.com/view/fusion360/ENU/?contextId=SKT-EDIT-SKETCH) | Explicit plane or planar-face support, highlighted temporary sketch environment, Finish Sketch, and Browser/Timeline edit entry points |
| [Shapr3D adaptive user interface](https://support.shapr3d.com/hc/en-us/articles/7873882619548-Adaptive-user-interface) | Selection-driven recommended tools, profile-to-Extrude and profile-plus-axis-to-Revolve promotion, and a bounded More path |
| [Shapr3D History](https://support.shapr3d.com/hc/en-us/articles/11567903089180-History) | Editable history-step parameters, breakpoint, suppression, zoom, rename, duplication, deletion, and selection-related filtering |
| [FreeCAD Sketcher Workbench](https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/en/Sketcher_Workbench.html) | Degrees-of-freedom feedback, automatic-constraint candidates, distinct snapping behavior, construction geometry, and solver guidance |
| [SolveSpace reference](https://solvespace.com/ref.pl) | Graphics-first layout, constraint and dimension glyphs, direct label editing, automatic horizontal/vertical constraints, reference dimensions, and bounded failed-constraint suggestions |
| [Radix Toolbar](https://www.radix-ui.com/primitives/docs/components/toolbar) | Roving tab index and arrow-key navigation used for the contextual command surface |

**Conclusion:** the editor should combine Onshape's stable feature-centric shell, Fusion's explicit contextual mode, Shapr3D's selection-driven next actions, and the solver transparency of FreeCAD and SolveSpace. Adaptive actions supplement a complete command registry; they do not hide unavailable commands from search or bypass VibeShape's local persistence and validation boundaries. The implementation sequence is defined in the [Editor experience implementation plan](product/editor-experience-plan.md).

## npm Registry Snapshot

Results from `npm view <package> version license` on 2026-08-07, with `is-what` reviewed on 2026-08-08 and the editor-state dependencies reviewed on 2026-08-16:

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
- Immer 11.1.17, MIT
- Dexie 4.4.4, Apache-2.0
- Zod 4.4.3, MIT
- `is-what` 5.5.0, MIT; ESM, `sideEffects: false`, bundled TypeScript declarations, and no runtime dependencies
- fflate 0.8.3, MIT; browser ESM, `sideEffects: false`, bundled TypeScript declarations, and no runtime dependencies
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
