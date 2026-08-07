# Исследование и первичные источники

## Метод

Проверено **2026-08-07**. Приоритет отдавался официальной документации, спецификациям и upstream-репозиториям. Точные npm-версии сверены с registry в ту же дату.

Context7 использовался для библиотечной документации. Поиск `OpenCascade.js`/`opencascade.js` не нашёл точного package и возвращал нерелевантные результаты, поэтому по правилу точного совпадения они не использовались. Context7 подтвердил `/mrdoob/three.js`; сведения об OCCT/OpenCascade.js взяты из официальной документации и upstream repository.

## CAD kernel и browser binding

| Источник | Подтверждает |
|---|---|
| [Open CASCADE Technology: Introduction](https://dev.opencascade.org/doc/overview/html/index.html) | B-Rep modeling data/algorithms, mesh, data exchange, shape healing, application framework и LGPL-2.1+exception obligations |
| [OCCT Data Exchange](https://dev.opencascade.org/about/data_exchange) | STEP AP203/AP214/AP242, IGES, STL, glTF и XDE attributes |
| [OCCT licensing FAQ](https://dev.opencascade.org/resources/faq) | GPL compatibility и обязанности software product, использующего OCCT |
| [OpenCascade.js official project page](https://dev.opencascade.org/project/opencascadejs) | OCCT API в JavaScript, WebAssembly/Emscripten, TypeScript definitions, custom builds |
| [OpenCascade.js upstream](https://github.com/donalffons/opencascade.js) | порт OCCT в JavaScript/WASM, topics STEP/B-Rep, LGPL-2.1 |
| [Replicad](https://replicad.xyz/) | browser B-Rep API поверх OpenCascade и STEP/fillet capabilities |
| [Replicad as a library](https://replicad.xyz/docs/use-as-a-library/) | необходимость inject OCJS и рекомендация выполнять вычисления в Web Worker |
| [Replicad upstream](https://github.com/sgenoud/replicad) | MIT TypeScript abstraction над OpenCascade |

**Вывод:** OCCT — единственный проверенный основной кандидат для точного B-Rep/STEP. Replicad ускоряет начало, но изолируется adapter-слоем из-за риска неполного binding и необходимости topology history.

## Viewport

Документация Three.js получена через Context7 для `/mrdoob/three.js` и сверена с official source examples:

- [WebGPU performance example](https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_performance.html) — WebGPURenderer и `compileAsync`;
- [Clipping example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_clipping.html) — local/global clipping planes;
- [GPU picking example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_interactive_cubes_gpu.html) — offscreen picking target;
- [OffscreenCanvas worker example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_worker_offscreencanvas.html) — worker rendering и browser caveats;
- [Three.js upstream](https://github.com/mrdoob/three.js) — MIT WebGL/WebGPU renderer.

**Вывод:** WebGL2 — baseline; GPU picking/clipping доступны. WebGPU/OffscreenCanvas остаются optional adapters после profiling.

## Sketch solver и параметрическая устойчивость

| Источник | Подтверждает |
|---|---|
| [SolveSpace upstream](https://github.com/solvespace/solvespace) | parametric 2D/3D CAD, GPL-3.0-or-later, experimental web build с critical bugs/unimplemented functions |
| [SolveSpace license](https://github.com/solvespace/solvespace/blob/master/COPYING.txt) | полный текст GPL-3.0 и terms |
| [FreeCAD: topological naming problem mirror](https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/cs/Topological_naming_problem.html) | ссылки на faces/edges ломаются после topology changes; проблема общая для CAD; datum/origin references устойчивее |
| [Onshape Part Studios help](https://cad.onshape.com/help/Content/PartStudio/part_studios.htm) | feature list/Part Studio как полезный reference функциональной модели |
| [Onshape integrated PDM](https://www.onshape.com/en/features/product-data-management) | history, versions, branching/merging — осознанно отложенная cloud/PDM область |

**Вывод:** solver требует отдельного subset spike; весь experimental web UI SolveSpace не встраивается. Topological naming проектируется до feature model, а не чинится после MVP.

## 3D-печать и форматы

| Источник | Подтверждает |
|---|---|
| [3MF specification suite](https://3mf.io/spec/) | 3MF, ISO/IEC 25422:2025, Core и extensions, royalty-free spec |
| [3MF overview](https://3mf.io/) | ZIP/XML container, units, full-fidelity manufacturing exchange |
| [3MF Core source](https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md) | package structure, resources, metadata, units |
| [3MF samples/conformance](https://github.com/3MFConsortium/3mf-samples) | implementation guidance, sample files и conformance tests |
| [lib3mf 2.5.0 docs](https://lib3mf.readthedocs.io/en/master/index.html) | official reader/writer/validation library и listed bindings, включая NodeJS |
| [PrusaSlicer upstream](https://github.com/prusa3d/PrusaSlicer) | libslic3r/CLI, feature scope и AGPL-3.0 |
| [CuraEngine upstream](https://github.com/Ultimaker/CuraEngine) | самостоятельный C++ G-code engine, AGPL-3.0 |
| [Manifold upstream](https://github.com/elalish/manifold) | robust manifold triangle mesh library и JS/TS/WASM bindings; mesh, не B-Rep/STEP replacement |

**Вывод:** 3MF основной для print exchange; полноценный slicer — поздний отдельный трек. Mesh-kernel MAY дополнить анализ/repair, но не заменяет OCCT.

## Local-first web platform

| Источник | Подтверждает |
|---|---|
| [MDN: Origin private file system](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) | OPFS, worker sync access, quota и удаление при очистке site data |
| [MDN: showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker) | user-visible file save как progressive API, требующее permission/secure context и fallback |
| [MDN: storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | best-effort/persistent storage и eviction behavior |
| [SQLite WASM persistent storage](https://sqlite.org/wasm/doc/trunk/persistence.md) | OPFS VFS, worker requirement и browser trade-offs |
| [web.dev: service workers](https://web.dev/learn/pwa/service-workers) | offline cache/interception и lifecycle |
| [web.dev: PWA installation](https://web.dev/learn/pwa/installation) | manifest/installability различается по browser/OS |

**Вывод:** OPFS/IndexedDB подходят для internal working set, но не являются гарантированным backup. `.vshape` и fallback upload/download обязательны.

## npm registry snapshot

Команды вида `npm view <package> version license` на 2026-08-07:

- React 19.2.8 MIT;
- Vite 8.2.1 MIT;
- Three.js 0.185.1 MIT;
- Replicad 0.23.1 MIT;
- OpenCascade.js 1.1.1 LGPL-2.1-only;
- Zustand 5.0.14 MIT;
- Dexie 4.4.4 Apache-2.0;
- Zod 4.4.3 MIT.

Registry metadata не заменяет license files конкретного lockfile/distribution.

## Неиспользованные/отклонённые выводы

- Context7-результаты Next.js/PostHog на запрос OpenCascade.js признаны нерелевантными.
- Community comments не использовались как основание ключевых решений, если существовал upstream/официальный источник.
- Точные performance promises не заимствовались из marketing; они заданы как измеряемые goals Phase 0.
- Заявления о «полной совместимости» форматов не делаются до fixture/conformance/slicer tests.
