# Стратегия тестирования

## Принцип

CAD нельзя проверять только snapshots интерфейса или точным сравнением B-Rep bytes. Тесты строятся вокруг **design intent, геометрических invariants, формальной валидности и реального round-trip**.

## Пирамида

| Уровень | Что проверяет | Инструмент/подход |
|---|---|---|
| Pure unit | units, expressions, DAG, commands, migrations | Vitest через `bun run test` |
| Property-based | parameter ranges, solver degeneracies, TopoRef | fast-check/эквивалент |
| Worker contract | schema, revisions, cancellation, transfer buffers | Vitest через Bun + real worker |
| Kernel fixture | operations, validity, metrics, memory | browser/Node-compatible WASM harness |
| Format conformance | `.vshape`, STEP, STL, 3MF | validators + round-trip |
| Component | tree, property editor, diagnostics | Testing Library |
| E2E | complete CAD/print/offline/recovery flows | Playwright |
| Manual release | slicers, Safari, interaction quality | release checklist |

## Geometric assertions

Предпочитать:

- shape valid/solid closed;
- ожидаемое число solids/shells;
- volume, area, center of mass, bbox в tolerance;
- distance/radius/angle;
- наличие semantic output/reference result;
- mesh manifoldness и orientation;
- STEP round-trip metrics;
- feature failure kind и owning feature.

Не использовать как единственный oracle:

- B-Rep binary equality;
- одинаковый порядок faces/edges;
- точный triangle order;
- screenshot красивой формы;
- отсутствие thrown exception.

## Sketch solver tests

- по одному fixture на каждый constraint;
- combinations и fully-defined canonical sketches;
- over-constraint с ожидаемым conflict set;
- under-constraint и degrees of freedom;
- near-degenerate geometry;
- scale от очень малых до крупных деталей;
- drag continuation без скачков branch solution;
- randomized perturbation и residual thresholds;
- deterministic result для одинакового input/build.

## TopoRef matrix

Для каждого reference-heavy fixture:

- изменить upstream length/radius;
- пересечь symmetry threshold;
- добавить/удалить topology через boolean;
- изменить pattern count;
- reorder/suppress допустимые features;
- проверить `resolved`, `ambiguous` или `missing`;
- убедиться, что ambiguous никогда не становится silent wrong selection;
- проверить repair → save → reopen → rebuild.

## Format tests

### `.vshape`

- round-trip каждой schema version;
- forward unknown optional field;
- unknown required capability;
- sequential migrations;
- missing/corrupt cache не влияет на semantic open;
- checksum corruption;
- duplicate/path traversal/zip bomb limits;
- truncated journal recovery;
- old fixture corpus в каждом release.

### STEP

- AP242/AP214 fixtures;
- mm/inch units;
- multiple bodies, names/colors;
- imported invalid shape и healing report;
- export/import metrics;
- independent open в FreeCAD/другом доступном reader как manual smoke.

### STL/3MF

- binary STL facets/endianness/header edge cases;
- non-manifold import;
- 3MF OPC relationships/XML schema/resource IDs;
- components/transforms/units;
- independent slicer open;
- dimension comparison после import в slicer;
- malicious XML/ZIP inputs без external entity/network access.

## Memory/leak tests

- повторить одну операцию/undo 1 000 раз;
- открыть/закрыть документ 100 раз;
- импортировать STEP и dispose;
- менять display LOD;
- worker restart;
- сравнить WASM heap high-water/steady-state и live wrapper counters;
- viewer `renderer.info.memory` возвращается к baseline с допустимым cache margin.

Рост должен иметь числовой budget; «браузер не упал» не является критерием.

## Performance budgets

Начальные goals для baseline laptop после warm-up:

| Сценарий | Goal |
|---|---:|
| UI input во время rebuild | no long task > 100 ms на main thread |
| Worker cold init | < 5 s |
| Простая feature preview | p95 < 500 ms |
| Rebuild 50-feature bracket corpus | < 5 s |
| Viewport 500k triangles | interactive target 60 fps, minimum 30 fps |
| Autosave domain transaction | < 100 ms typical |
| Open 20 MiB semantic project без cache | < 3 s + rebuild |

Числа меняются только через benchmark evidence/ADR. CI ловит крупные regressions; стабильные perf runs выполняются на контролируемом hardware, не только shared runners.

## Browser matrix

- Chromium stable: каждый PR E2E subset;
- Firefox stable: каждый PR core subset;
- WebKit/Safari-compatible automation: каждый PR smoke, manual Safari перед release;
- offline/service-worker отдельный installed-build test;
- cross-origin isolation mode тестируется только если включён;
- devicePixelRatio 1/2, integrated/discrete GPU по возможности.

## Monorepo/toolchain checks

- `bun ci` подтверждает соответствие workspace manifests и `bun.lock`;
- typecheck/lint/test запускаются по workspace filters и из root aggregate scripts;
- dependency boundary tests запрещают UI imports в domain/protocol;
- production Vite build проверяет Tailwind classes из `apps/web` и `packages/ui`;
- shadcn component updates проходят typecheck, обе темы и keyboard E2E;
- CI pin Bun совпадает с `packageManager`, локальная несовместимая версия даёт понятную ошибку.

## Security/fuzz

- schema fuzz для commands/native files;
- ZIP/XML fuzz;
- STEP/STL parser corpus и timeout;
- huge counts/NaN/Infinity/overflow;
- worker crash/restart;
- Content Security Policy test;
- dependency audit и SBOM;
- запрет network request при offline privacy test.

## Release gate

Release блокируют:

- data loss/corruption;
- silent topology remap в fixture;
- export, который не открывается в release matrix;
- uncontrolled worker/main-thread crash на допустимом input;
- license notice/source omission;
- migration, не имеющая fixture/backup path;
- P0 accessibility blocker;
- необъяснённый существенный memory/performance regression.
