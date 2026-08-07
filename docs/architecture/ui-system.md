# UI-система: Tailwind CSS и shadcn/ui

## Решение

Использовать **Tailwind CSS v4** и **shadcn/ui CLI v4 с Radix base** как исходную базу интерфейса. Общие primitives и design tokens живут в workspace `@vibeshape/ui`; специфичные CAD-компоненты собираются поверх них в `apps/web`.

shadcn/ui не является закрытой component dependency: CLI добавляет исходники компонентов в репозиторий. Мы владеем их кодом, можем делать compact variants и обязаны review-ить generated diff как обычный application code.

## Границы пакетов

```text
apps/web/
  src/
    features/
      model-tree/
      sketcher/
      feature-editor/
      print-check/
    shell/
    routes/
  components.json

packages/ui/
  src/
    components/          # shadcn/Radix primitives
    hooks/               # purely visual/shared hooks
    lib/cn.ts
    styles/globals.css   # Tailwind import + semantic tokens
  components.json
  package.json           # explicit exports
```

`@vibeshape/ui` MAY импортировать React, Radix, class-variance-authority, Tailwind utilities и Lucide. Он MUST NOT импортировать domain, geometry worker, persistence или application store.

`apps/web` отвечает за:

- `ModelTree`, `FeatureEditor`, `SketchConstraintList`;
- связь UI с commands/view-model;
- viewport overlays и selection behavior;
- product-specific shortcuts/diagnostics;
- композицию primitives в рабочие панели.

## Monorepo routing shadcn CLI

В каждом workspace, куда CLI должен уметь добавлять файлы, есть согласованный `components.json`.

- `packages/ui/components.json`: локальные aliases ведут в `#components`, `#lib`, `#hooks`;
- `apps/web/components.json`: `ui` и shared `utils` ведут в `@vibeshape/ui/...`, app components — в локальные aliases;
- `@vibeshape/ui/package.json` экспортирует `./components/*`, `./lib/*`, `./hooks/*` и `./globals.css`;
- app зависит от `@vibeshape/ui` через `workspace:*`;
- `style`, `baseColor`, `iconLibrary` и base implementation одинаковы в обоих configs;
- для Tailwind v4 поле config path пустое.

Bootstrap выполняется non-interactive и reviewable. Концептуальная команда для нового Vite monorepo — `bunx --bun shadcn@latest init -t vite --monorepo -d --base radix`; однако мы не принимаем сгенерированную структуру вслепую и не обязаны сохранять Turborepo. Для существующего scaffold init выполняется с defaults/preset и Radix base, затем проверяется diff `components.json`, CSS и package manifests. Один `-y` недостаточен для гарантированно non-interactive запуска; используется `-d`.

Новые primitives добавляются из `apps/web` или с явным cwd, сначала через `--dry-run`/`--diff`, затем review. Массовый `add --all` запрещён.

## Tailwind v4

- официальный Vite plugin `@tailwindcss/vite`;
- `@import "tailwindcss"` в shared global CSS;
- theme преимущественно через CSS custom properties/`@theme inline`;
- никаких runtime-generated class strings вида ``bg-${color}-500``;
- повторяемые варианты оформляются `cva`, а class merge — `cn()` (`clsx` + `tailwind-merge`);
- arbitrary values допустимы только для действительно вычисляемой геометрии layout/overlay;
- viewport canvas не стилизует геометрические данные Tailwind-классами.

## Визуальное направление CAD

VibeShape — плотный инструмент, не маркетинговый dashboard:

- dark-first с полноценной light theme;
- `new-york` как исходная shadcn density/style, Radix base;
- neutral/zinc surfaces и один спокойный primary accent;
- компактный шаг: toolbar 32–36 px, panel controls 28–32 px, базовый текст 12–14 px;
- radius меньше стандартных consumer cards, но следует единой token scale;
- panels разделяются borders/resizable separators, не вложенными Card;
- gradients/glassmorphism не используются в рабочей области;
- Lucide icons одного размера/толщины и всегда имеют accessible name/tooltip, если смысл не очевиден;
- viewport остаётся визуально главным, UI chrome не конкурирует с моделью.

## Semantic tokens

Базовые shadcn tokens дополняются CAD-specific tokens:

- `--background`, `--foreground`, `--card`, `--popover`, `--border`, `--input`, `--ring`;
- `--panel`, `--panel-muted`, `--toolbar`, `--viewport-background`;
- `--selection`, `--preselection`, `--selection-foreground`;
- `--sketch-under`, `--sketch-full`, `--sketch-conflict`, `--construction`;
- `--feature-active`, `--feature-suppressed`, `--feature-error`, `--feature-stale`;
- `--diagnostic-info`, `--diagnostic-warning`, `--diagnostic-error`;
- `--axis-x`, `--axis-y`, `--axis-z`;
- compact spacing, control height, panel width и radius tokens.

Статус не кодируется только цветом: используются иконка/форма/текст/line style. Contrast проверяется для обеих тем и viewport overlays.

## Первая партия primitives

Добавлять по потребности в таком порядке:

1. `button`, `tooltip`, `separator`, `scroll-area`;
2. `input`, `label`, `select`, `checkbox`, `slider`;
3. `dropdown-menu`, `context-menu`, `popover`;
4. `dialog`, `alert-dialog`, `sheet`;
5. `command` для command palette;
6. `tabs`, `resizable`, `collapsible`, `badge`, `progress`, `skeleton`;
7. `table` только для данных, не как model tree.

Model tree — отдельный accessible virtualized tree, потому что обычный shadcn component не определяет CAD tree semantics/selection/keyboard navigation.

## Композиционные правила

- destructive confirmation — `AlertDialog`, не обычный `Dialog`;
- tooltip provider один на root;
- toolbar actions используют Button variants, но не теряют native focus/keyboard semantics;
- input ошибок имеет label, message и `aria-invalid`, а не только красную рамку;
- command palette вызывает те же application commands, что toolbar/menu/shortcuts;
- context menu не является единственным способом вызвать действие;
- layout state (panel sizes, theme) local UI preference; domain state туда не попадает;
- shadcn source changes имеют Storybook/визуальный harness только если он окупается; E2E остаётся обязательным для command flows.

## Темы

- `dark`, `light`, `system`;
- class на `<html>`;
- theme preference хранится отдельно от проекта;
- print/export colors не зависят от UI theme;
- high-contrast preset рассматривается после базового accessibility audit;
- font assets self-hosted/system-first, чтобы offline не требовал внешней сети.

## Проверки

- keyboard-only основные потоки;
- focus trap/restore для dialog/sheet/popover;
- contrast и non-color status cues;
- 200% zoom при минимальной desktop width;
- long translated labels;
- pointer + trackpad, later touch;
- screenshot tests обеих тем для shell/primitives;
- отсутствие Tailwind class-generation gaps в production build;
- размер CSS и число shipped primitives контролируются — неиспользуемые generated components удаляются.

## Обновления shadcn

CLI не обновляет components как opaque dependency. Для обновления:

1. pin/record CLI version;
2. `view`/`--diff` для изменяемого component;
3. сохранить наши CAD variants и accessibility fixes;
4. проверить unified `radix-ui` imports;
5. запустить typecheck, visual/component tests и E2E;
6. обновить third-party notices, если состав source/dependencies изменился.

Preset фиксируется в документации/репозитории. Запуск `init --force` без review запрещён, потому что он может переписать CSS tokens и component config.
