# Технологический стек

## Рекомендованный stack

| Область | Выбор | Почему |
|---|---|---|
| Язык | TypeScript, `strict` | единая типизация domain/UI/protocol, безопасные migrations |
| UI | React 19 | зрелая экосистема сложных desktop-like интерфейсов |
| Build/dev | Vite 8 | быстрый статический build, worker/WASM assets, backend не нужен |
| Package manager/runtime | Bun workspaces | единый lockfile, быстрые installs, `workspace:*`, catalogs, filters и `bun ci` |
| CAD kernel | OCCT через Replicad/OpenCascade.js | точный B-Rep, booleans, fillets, STEP |
| Sketch solver | SolveSpace solver subset → WASM | зрелый набор геометрических constraints; GPL совместима с проектом |
| Viewport | raw Three.js, WebGL2 baseline | полный контроль picking, buffers, clipping и lifecycle |
| UI state | Zustand | локальное transient state; domain state остаётся отдельно |
| Runtime schemas | Zod | проверка worker messages, файлов и migrations |
| Styles | Tailwind CSS v4 через `@tailwindcss/vite` | zero-runtime utility CSS, tokens и штатная Vite-интеграция |
| UI primitives | shadcn/ui CLI v4, Radix base | accessible source-owned components, удобная monorepo routing |
| Icons | Lucide React | единый спокойный набор для toolbar/tree/actions |
| Project DB | IndexedDB через Dexie | транзакции и индексы без второго тяжёлого WASM runtime |
| Large binary cache | OPFS | эффективные локальные файлы из worker |
| Offline | Web App Manifest + service worker | installable/offline static PWA |
| Tests | Vitest, запускаемый через Bun, + Playwright | Vite-native unit/contract tests и реальные browser flows |
| Quality | ESLint/import rules + Prettier или Biome | единый deterministic workflow; финальный выбор в setup ADR |
| CI | GitHub Actions | typecheck, tests, format conformance, browser smoke |

## Снимок проверенных npm-версий

Проверено через npm registry **2026-08-07**. Это ориентир для Phase 0, не разрешение использовать floating versions.

| Package | Версия | Лицензия |
|---|---:|---|
| `react` | 19.2.8 | MIT |
| `vite` | 8.2.1 | MIT |
| `three` | 0.185.1 | MIT |
| `replicad` | 0.23.1 | MIT |
| `opencascade.js` | 1.1.1 | LGPL-2.1-only |
| `zustand` | 5.0.14 | MIT |
| `dexie` | 4.4.4 | Apache-2.0 |
| `zod` | 4.4.3 | MIT |
| `tailwindcss` | 4.3.3 | MIT |
| `@tailwindcss/vite` | 4.3.3 | MIT |
| `shadcn` CLI | 4.16.2 | MIT |
| `radix-ui` | 1.6.7 | MIT |
| `lucide-react` | 1.30.0 | ISC |

Локально проверен Bun `1.3.14` (`1.3.14+0d9b296af`). В первом scaffold exact Bun version записывается в `packageManager` и CI `oven-sh/setup-bun`; обновление выполняется осознанным PR вместе с `bun.lock`.

Перед первым install нужно:

1. проверить release notes и peer dependencies;
2. зафиксировать exact versions в lockfile;
3. записать OCCT commit/version и flags custom-сборки;
4. сохранить исходники соответствующей LGPL-сборки и reproducible build instructions;
5. запустить compatibility/performance spike на Chromium, Firefox и Safari.

## Bun workspaces

Bun используется как:

- package manager и единственный владелец `bun.lock`;
- runtime для project scripts/CLI;
- workspace orchestrator через `--filter`/`--workspaces`;
- источник согласованных версий через default/named catalogs;
- reproducible CI install через `bun ci`.

Правила:

- root package помечен `private: true`;
- workspaces: `apps/*`, `packages/*`;
- зависимости между пакетами — `workspace:*`;
- React/React DOM, TypeScript, Tailwind и test stack берутся из catalogs;
- dependencies объявляются в фактически использующем их workspace, а не сваливаются в root;
- `bun.lock` обязателен и проверяется `bun ci`;
- scripts запускаются из root через Bun filters;
- npm/pnpm/yarn lockfiles не коммитятся.

**Bun не заменяет Vite** в browser build. Vite остаётся ответственным за React HMR, browser bundle, Tailwind plugin, worker и WASM asset pipeline. Bun bundler/test runner можно оценить позже, но не нужно создавать две конкурирующие production-сборки.

**Turborepo не входит в foundation.** Официальный shadcn monorepo scaffold может добавить его, однако для текущего одного приложения и набора библиотечных пакетов достаточно Bun workspace scripts. Turbo вводится отдельным измерением, если dependency-aware cache заметно сокращает CI/local builds.

## Почему OCCT, а не mesh-CSG

OCCT представляет тела точными поверхностями/кривыми и topology B-Rep, поддерживает modeling algorithms, shape healing и STEP. Это соответствует параметрическому механическому CAD.

Mesh-kernel вроде Manifold полезен для гарантированно manifold треугольных операций и анализа печати, но не заменяет STEP/NURBS/B-Rep. Возможная поздняя роль Manifold — repair/boolean для `MeshBody` и проверка экспортной сетки за отдельным port.

## Replicad: façade, не фундамент domain

Replicad уменьшает объём прямого кода OCCT, уже ориентирован на браузер и рекомендует Web Worker. Но проект не должен сериализовать его классы и рассыпать API по UI.

Phase 0 сравнивает:

- Replicad + его custom OC build;
- direct custom OpenCascade.js build с только нужными bindings.

Критерии: STEP round-trip, supported operations, WASM size/startup, memory lifecycle, доступ к operation history для `TopoRef`, качество TypeScript definitions и воспроизводимость сборки.

Если Replicad не даёт нужную history/topology информацию, adapter переходит на direct OCCT без изменения domain/file format.

## Почему raw Three.js, а не React Three Fiber

React управляет оболочкой интерфейса, но CAD viewport имеет собственный долгоживущий scene graph, частые замены больших buffers, выбор sub-shape и строгий dispose. Raw Three.js за `Viewer` port делает lifetime явным и уменьшает связность render loop с React reconciliation.

WebGL2 — baseline. WebGPU даёт перспективу, но не должен быть условием запуска alpha. Официальные примеры Three.js подтверждают WebGPU renderer, GPU picking, clipping и OffscreenCanvas; каждый из них вводится отдельным измеряемым adapter/spike.

## Почему Vite, а не Next.js

- нет SSR/SEO-маршрутов для CAD workspace;
- backend не является частью core;
- static hosting и localhost проще;
- Worker/WASM assets можно контролировать без server framework;
- меньше runtime и deployment surface.

Маркетинговый сайт при необходимости живёт отдельно и не определяет архитектуру CAD.

## Почему IndexedDB + OPFS, а не SQLite WASM сразу

Domain документ — объектный snapshot/event log, а не сложная аналитическая реляционная БД. Dexie даёт достаточные транзакции и индексы. OPFS хранит большие B-Rep/mesh cache.

SQLite WASM поддерживает OPFS, но добавляет ещё один WASM runtime, worker/VFS-конфигурацию и browser-specific trade-offs. Его стоит вводить только после доказанного bottleneck или появления запросов, которым реально нужна SQL/FTS.

## Sketch solver

SolveSpace распространяется по GPL-3.0-or-later и имеет browser build, который сам проект называет экспериментальным. Поэтому нельзя просто встроить весь web-port.

Spike должен:

- выделить минимальный solver ABI;
- собрать отдельный deterministic WASM;
- покрыть обязательные P0 constraints;
- проверить conflict diagnostics, degeneracies и memory;
- документировать изменения исходников и build pipeline.

Если spike провален, альтернативы:

1. адаптировать другой FOSS nonlinear solver с совместимой лицензией;
2. реализовать собственный solver — наиболее дорогой вариант;
3. урезать alpha до ограниченного sketcher без обещания сложных constraints.

## Форматы

- STEP читает/пишет geometry worker через OCCT data exchange.
- STL binary генерируется из контролируемой тесселяции; ASCII — только import при необходимости.
- 3MF writer реализуется по Core spec и conformance samples либо через адаптированную библиотеку. Официальный lib3mf имеет NodeJS/native bindings, но browser-интеграцию нужно доказать spike; его нельзя считать готовой browser dependency.
- `.vshape` — собственный versioned ZIP-контейнер, описанный отдельно.

## UI toolkit

UI-база принята: **Tailwind CSS v4 + shadcn/ui CLI v4 с Radix base**. Компоненты shadcn копируются в `packages/ui` как исходный код, поэтому это design-system seed, а не opaque runtime library.

- интеграция Tailwind — официальный Vite plugin `@tailwindcss/vite` и `@import "tailwindcss"`;
- `packages/ui/components.json` направляет primitives внутрь shared package;
- `apps/web/components.json` направляет alias `ui` в `@vibeshape/ui/components`;
- Tailwind v4 config path в `components.json` остаётся пустым;
- style/base/icon/baseColor синхронны во всех `components.json`;
- base — Radix, тема — compact dark-first `new-york`, neutral/zinc + один accent;
- добавляются только реально используемые primitives; `add --all` запрещён;
- CAD-specific widgets композируются поверх primitives, а не генерируются в общий package автоматически;
- foundational colors используются через semantic CSS variables, не ad-hoc palette classes.

Подробности: [UI system](ui-system.md).

## Deployment

Поддерживаются:

- production static build на `localhost` через небольшой local server;
- self-hosted HTTPS static server;
- installable PWA после первой загрузки.

`file://` не поддерживается: worker modules, WASM, service workers и secure-context APIs требуют HTTP(S). Core не должен зависеть от CDN; шрифты, WASM и assets поставляются вместе со сборкой.
