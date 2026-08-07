# Документация VibeShape

## Как читать

Рекомендуемый порядок:

1. [Видение и границы](product/vision-and-scope.md).
2. [Функциональная матрица](product/feature-matrix.md).
3. [Обзор архитектуры](architecture/overview.md).
4. [Стек](architecture/technology-stack.md).
5. [UI-система](architecture/ui-system.md) и [геометрия/параметрика](architecture/geometry-and-parametrics.md).
6. [Модель данных и формат](architecture/data-model-and-file-format.md).
7. [Roadmap](roadmap.md), [план первых экспериментов](implementation-blueprint.md) и [стратегия тестирования](testing-strategy.md).
8. [Deployment](deployment.md), [ADR](adr/README.md), [риски](risks.md), [лицензии](licensing.md) и [источники](research-sources.md).

## Уровни обязательности

В документах используются термины:

- **MUST** — обязательно для указанного релиза;
- **SHOULD** — ожидаемое поведение, отступление требует причины в issue/ADR;
- **MAY** — допустимое расширение;
- **Spike** — ограниченный эксперимент, который заканчивается измеримым решением, а не production-кодом.

## Что уже решено

- Архитектура local-first, без обязательного backend.
- B-Rep/STEP через OCCT WASM; Three.js не используется как CAD-ядро.
- CAD-объекты живут только внутри worker; UI получает сериализуемые данные и mesh-буферы.
- Параметрическая история — ориентированный ациклический граф зависимостей с линейным представлением в UI.
- Основная единица документа — миллиметр; вычисления хранятся как `float64`.
- 3MF — предпочтительный печатный экспорт.
- Monorepo управляется Bun workspaces; Vite остаётся browser bundler.
- UI primitives живут в `@vibeshape/ui` и основаны на Tailwind CSS v4 + shadcn/ui/Radix.
- Ошибка привязки к топологии не может исправляться молча: неоднозначность должна быть видна пользователю.

## Что подтверждается в Phase 0

- конкретная сборка/версия OCCT и состав экспортируемых binding;
- Replicad как production façade или только как прототип;
- пригодность solver-части SolveSpace для отдельного WASM-модуля;
- алгоритм `TopoRef` и пороги сопоставления;
- реализация 3MF: собственный минимальный writer либо адаптированная библиотека;
- реальные бюджеты startup, памяти и пересчёта.

## Правило изменения решений

Смена CAD-ядра, solver, лицензии, native-формата, модели истории или границы local-first требует нового ADR. Обновление версии пакета в пределах принятого решения — обычная dependency-задача.
