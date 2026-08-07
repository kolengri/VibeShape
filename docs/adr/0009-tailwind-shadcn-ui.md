# ADR-0009: Tailwind CSS v4 + shadcn/ui/Radix

- Статус: **Accepted**
- Дата: 2026-08-07

## Контекст

CAD требует плотного keyboard-first интерфейса: toolbar, menus, command palette, dialogs, panels, property forms и сложные состояния. Нужны accessible primitives, единые tokens и возможность глубокой адаптации без зависимости от закрытой design system.

## Решение

Использовать Tailwind CSS v4 через официальный Vite plugin и shadcn/ui CLI v4 с Radix base. Generated source и tokens хранятся в `@vibeshape/ui`; CAD-specific components остаются в app/feature layer.

Базовое направление: compact dark-first `new-york`, neutral/zinc, один accent, semantic CAD tokens, Lucide icons. Добавляются только используемые primitives.

## Последствия

- исходники components принадлежат repo и требуют code review/maintenance;
- monorepo `components.json`/aliases/exports должны быть согласованы;
- utility classes не должны заменить semantic tokens и component variants;
- model tree/viewport overlays требуют собственных accessible компонентов;
- обновления shadcn выполняются diff-based, не слепым overwrite;
- MIT/ISC notices включаются в third-party compliance.

## Отклонено

- CSS Modules как единственная система — больше ручной работы для tokens/variants;
- monolithic component library — хуже source ownership/custom density;
- raw controls без primitives — повышенный accessibility/consistency риск;
- `shadcn add --all` — раздувает shipped/review surface.
