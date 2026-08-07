# ADR-0001: OCCT WASM как геометрическое ядро

- Статус: **Accepted for spike**
- Дата: 2026-08-07

## Контекст

Нужны точные booleans/fillets/chamfers, B-Rep, STEP и тесселяция в браузере. Mesh-CSG не сохраняет аналитические поверхности и не является достаточной базой механического параметрического CAD.

## Решение

Использовать Open CASCADE Technology через WebAssembly. Начать с Replicad/custom OCJS build за интерфейсом `GeometryEngine`; domain не зависит от API Replicad/OCCT.

## Последствия

- качественный exact CAD/data exchange;
- большой WASM, сложный lifetime и LGPL compliance;
- custom bindings вероятны;
- Phase 0 обязан проверить history/topology APIs, size/startup/memory и formats.

## Отклонено

- Three.js geometry/CSG как основное kernel;
- Manifold/OpenSCAD-style mesh kernel как единственный источник истины;
- server-only proprietary kernel — нарушает local/offline goal.
