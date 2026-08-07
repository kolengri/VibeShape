# Roadmap реализации

## Общий вывод

UI-каркас не является первым milestone. Сначала нужно снять четыре неизвестности: OCCT binding/worker, sketch solver, stable topology references и 3MF interoperability. После этого разработка идёт вертикальными срезами, каждый из которых заканчивается рабочей моделью и export.

Оценки ниже — **приблизительные engineering ranges**, а не календарное обещание.

## Phase 0 — spikes и измерения (2–4 недели)

### Результаты

- reproducible OCCT/Replicad worker prototype;
- STEP import → boolean/fillet → STEP/STL export;
- memory/leak harness;
- sketch solver prototype с обязательными constraints;
- `TopoRef` experiment на model corpus;
- минимальный 3MF writer/adapter и slicer round-trip;
- browser startup/memory matrix;
- финализированные ADR-0001…0007 и обновлённая оценка.

### Exit criteria

- ни один spike не остаётся «кажется, работает» — есть fixture, команда запуска и числа;
- известно, какие OCCT symbols входят в custom build;
- известны WASM compressed/uncompressed size, cold startup и peak memory;
- solver сообщает under/fully/over-constrained на test set;
- TopoRef experiment различает resolved/ambiguous/missing;
- 3MF открывается минимум в двух slicers;
- выбран baseline browser/device.

## Phase 1 — foundation vertical slice (3–5 недель)

### Scope

- Bun workspaces monorepo, pinned Bun + `bun.lock`, strict TS и `bun ci`;
- Tailwind CSS v4 + `@vibeshape/ui` на shadcn/Radix, базовые tokens/primitives;
- PWA shell и project library;
- domain commands/events/revisions;
- worker protocol и restart/recovery;
- Three.js viewport, selection body/face/edge;
- IndexedDB autosave и `.vshape` v0;
- primitives/extrude без полного sketcher;
- STEP/STL smoke export.

### Demo

Создать box/cylinder feature, выполнить boolean, перезапустить offline, восстановить проект, экспортировать STEP/STL.

## Phase 2 — sketcher vertical slice (6–10 недель)

### Scope

- origin planes и sketch mode;
- line/rectangle/circle/arc/construction;
- P0 constraints/dimensions;
- solver diagnostics и conflict UX;
- profile detection;
- extrude/pocket/revolve;
- undo/redo на command level;
- unit-aware inputs.

### Demo

Полностью параметрический flange и простой bracket; изменение размеров после reopen.

## Phase 3 — устойчивое feature modeling (6–10 недель)

### Scope

- multi-body;
- booleans, fillet, chamfer;
- semantic outputs и TopoRef resolver;
- downstream error/repair UX;
- suppress/edit/rebuild;
- measure tools;
- STEP import as reference;
- golden/property-based model corpus.

### Demo

Эталонный bracket проходит матрицу изменений параметров; симметричная неоднозначность вызывает repair UI, а не silent remap.

## Phase 4 — 3D printing workflow (4–7 недель)

### Scope

- print-quality adaptive tessellation;
- 3MF Core export;
- printer/build-volume profiles;
- P0 mesh/solid checks;
- overhang/build-volume overlays;
- export reports;
- slicer compatibility CI/manual release matrix.

### Demo

Bracket/enclosure экспортируются в 3MF и STEP, открываются в PrusaSlicer и Cura/Orca, габариты совпадают с tolerance.

## Phase 5 — alpha hardening (4–8 недель)

### Scope

- file/import fuzzing и resource limits;
- browser matrix Chromium/Firefox/Safari;
- crash/quota/multi-tab recovery;
- accessibility и keyboard workflow;
- performance budgets/profiling;
- LGPL notices/source offer/reproducible WASM;
- user documentation и diagnostic bundle;
- migration fixtures.

### Exit criteria alpha

- сквозной bracket scenario;
- no known P0 data-loss issue;
- model corpus проходит на pinned engine build;
- все release exports валидны;
- offline test проходит;
- известные ограничения опубликованы.

## v1 после alpha

- patterns/mirror/shell/sweep/loft;
- projected geometry и datum entities;
- variables/expressions;
- snapshots/version compare;
- SVG/DXF;
- улучшенные print heuristics;
- tablet usability, локализация;
- documented native format v1.

## Поздние треки

| Трек | Предусловие |
|---|---|
| Assemblies/mates | устойчивые components/instances и TopoRef |
| Drawings | stable projected topology/dimensions |
| Branch/merge | formal command conflict model |
| Optional sync/collab | privacy/security ADR и merge semantics |
| Plugin SDK | stable commands/features/migrations + sandbox |
| Integrated slicing | отдельный license/performance/safety spike |
| AI features | deterministic command API, preview, sandbox, no hidden upload |

## Приоритизация backlog

Каждая задача отвечает на четыре вопроса:

1. Какой user flow она завершает?
2. Какой domain/geometry invariant добавляет?
3. Как тестируется failure, а не только happy path?
4. Добавляет ли новый file/schema/API commitment?

Функции, не улучшающие основной sketch → feature → print поток, не входят в alpha даже при низкой видимой стоимости.

## Ресурсная модель команды

Минимально полезное распределение для 3–5 человек:

- geometry/OCCT/WASM;
- sketch solver/parametric engine;
- viewport/UI/UX;
- local-first/formats/testing;
- product/3D-print validation — роль может совмещаться.

Без опыта computational geometry сроки Phase 2–3 имеют высокий разброс. Код-review геометрических изменений должен требовать fixture/invariant tests.
