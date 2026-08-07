# Реестр рисков

## Самые опасные риски

| ID | Риск | Вероятность | Влияние | Митигация / gate |
|---|---|---:|---:|---|
| R1 | Topological naming приводит к silent wrong references | высокая | критическое | semantic history + signatures + ambiguous UI; fixture matrix до feature expansion |
| R2 | OCCT WASM слишком тяжёлый/медленный/течёт | высокая | высокое | custom binding, worker, memory harness, cache; Phase 0 stop/go |
| R3 | Sketch solver нестабилен или плохо диагностирует конфликт | высокая | критическое | isolated spike, corpus, ограничить constraints; fallback decision |
| R4 | Browser storage очищается/заканчивается | средняя | критическое | `.vshape` export, persist request, quota UI, journal/snapshots, bulk backup |
| R5 | Imported CAD/ZIP вызывает crash или resource exhaustion | высокая | высокое | limits, worker, fuzz, timeout, recovery |
| R6 | 3MF writer формально создаёт файл, несовместимый со slicерами | средняя | высокое | spec/conformance + два независимых slicer smoke |
| R7 | Scope разрастается до полного Onshape | высокая | критическое | фиксированный alpha flow, explicit non-goals, roadmap gates |
| R8 | LGPL/GPL compliance нарушен в WASM distribution | средняя | критическое | source archive, patches/builds/notices, release gate и legal review |
| R9 | Geometry results меняются после dependency update | высокая | высокое | exact pin, engine build in file/cache, corpus before upgrade |
| R10 | Main thread блокируется mesh/picking/render | средняя | высокое | geometry worker, transferable arrays, LOD, profiling |

## Подробности

### Topological naming

Нельзя «исправить позже»: формат references и feature outputs должен учитывать проблему с первого feature. UI должен предпочитать datum/origin references и показывать ambiguity.

**Stop condition:** если spike не даёт приемлемого результата, alpha ограничивает face-based downstream features и не обещает их устойчивость.

### WASM size/startup/memory

Полная OCCT binding может быть слишком большой, а ручной lifetime C++ wrappers — источник утечек.

**Measurements:** compressed bytes, parsed/compiled time, first operation, peak/steady heap, repeated operation delta на трёх браузерах.

**Fallback:** уменьшить bindings, lazy data-exchange module, кэшировать compiled module, убрать параллельные документы.

### Solver

Полный SolveSpace web app экспериментален, а выделение solver subset может потребовать значительной C++ работы.

**Fallback order:** subset port → другой FOSS solver → урезанный alpha → собственный solver как отдельный проект.

### Data loss

OPFS/IndexedDB зависят от origin и политики браузера. Пользователь может очистить site data.

**Rule:** internal autosave не называется backup. UI различает «сохранено локально в браузере» и «экспортирован файл».

### Cross-browser

File System Access и PWA installation различаются. Safari/Firefox могут иметь иные memory/worker ограничения.

**Rule:** picker — enhancement, upload/download — baseline. Chromium не единственный test target.

### Performance cliffs

Fillet/boolean, dense STEP и export-quality tessellation могут занимать секунды/минуты.

**Mitigation:** progress stages, stale generation discard, preview LOD, timeouts, diagnostic, model complexity warnings. Не показывать фиктивные проценты, если kernel не сообщает progress.

### Feature creep

Assemblies, drawings, collaboration и slicing каждый сопоставимы с отдельным продуктовым треком.

**Gate:** новая функция alpha должна сокращать основной sketch→print flow или устранять data/correctness risk.

### Licenses

GPL choice уменьшает неопределённость solver, но ограничивает proprietary reuse. OCCT LGPL требует replaceability/source offer даже при GPL application.

**Gate:** compliance artifact строится CI вместе с release, не вручную после публикации.

## Решения с высокой стоимостью изменения

- stable IDs/reference format;
- document commands/events;
- native file versioning;
- geometry engine ownership boundary;
- license;
- units/coordinate system;
- local-first vs server-authoritative model.

Они требуют ADR и fixture до реализации. Цвета UI, component library и layout — обратимые решения и не должны блокировать geometry spikes.

## Risk review cadence

- после каждого Phase exit;
- перед обновлением OCCT/Replicad/solver;
- перед изменением file format major/minor;
- перед public alpha;
- после data-loss/silent-geometry incident.

Каждый закрытый риск сохраняет ссылку на benchmark/test/ADR, а не только статус «исправлено».
