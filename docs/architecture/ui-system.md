# UI system: Tailwind CSS and shadcn/ui

This document owns the UI implementation architecture, package boundaries, and token system. [Design and UX Guidelines](../product/design-and-ux-guidelines.md) is the product-level contract for layout, interaction, accessibility, content, and acceptance behavior. Components MUST satisfy both documents.

## Decision

Use **Tailwind CSS v4** and **shadcn/ui CLI v4 with Radix base** as the interface foundation. Shared primitives and design tokens live in the `@vibeshape/ui` workspace; CAD-specific components are composed in `apps/web`. Form primitives are state-agnostic and uncontrolled by default, while typed product forms use the separate TanStack Form adapter accepted in [ADR-0010](../adr/0010-uncontrolled-form-primitives-and-tanstack-form.md).

shadcn/ui is not an opaque component dependency. Its CLI copies component source into the repository. We own and review that source, can add compact variants, and maintain it as application code.

## Package boundaries

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
    components/          # shadcn/Radix primitives and state-agnostic field compositions
    hooks/               # purely visual/shared hooks
    integrations/
      tanstack-form/     # contexts, registered fields, form components, and public entry point
    lib/cn.ts
    styles/globals.css   # Tailwind import + semantic tokens
  components.json
  package.json           # explicit exports
```

`@vibeshape/ui` MAY import React, Radix, class-variance-authority, Tailwind utilities, Lucide, and TanStack Form inside its explicit integration entry point. Base components MUST NOT import TanStack Form. The package MUST NOT import domain, geometry worker, persistence, or application-state packages.

`apps/web` owns product-copy catalogs and composes the `@vibeshape/i18n` provider accepted in [ADR-0011](../adr/0011-use-intl-localization-layer.md). Shared primitives remain copy-free when possible; component-owned copy uses a distinct shared catalog namespace rather than hard-coded display strings.

`apps/web` owns:

- `ModelTree`, `FeatureEditor`, and `SketchConstraintList`;
- binding UI behavior to commands and view models;
- viewport overlays and selection behavior;
- product-specific shortcuts and diagnostics;
- composition of primitives into work panels.

## Editor-session state

`apps/web/src/editor-session` owns one vanilla Zustand store instance per active editor session. React
provides that instance through context and consumes narrow selectors; Immer middleware implements
cohesive nested updates without exposing mutable state to components. The first hydrated document ID
binds to the existing store so early interaction is retained; changing an established active document
ID replaces the store and therefore discards every unfinished editor session by design.

The store owns workspace and active-tool coordination, viewport selection, unsaved sketch drafts,
sketch-local undo and redo, profile selection, and transient shell overlays. It MUST NOT own or clone
the committed document snapshot, semantic revision history, TanStack Form values, persisted records,
worker sessions, solved geometry, mesh buffers, or Three.js objects. Store actions may prepare UI
intent, but committed changes still pass through the ordinary revision-checked application command
and persistence path. Third-party extensions and MCP adapters never receive the store instance.

Persistent UI preferences use their existing schema-validated preference owners rather than the
editor-session store. Zustand persistence middleware is not enabled for semantic or draft state.

## shadcn CLI routing in the monorepo

Every workspace that can receive CLI-generated files has a consistent `components.json`.

- `packages/ui/components.json`: package-local aliases target `#components`, `#lib`, and `#hooks`.
- `apps/web/components.json`: `ui` and shared utilities target `@vibeshape/ui/...`; application components use local aliases.
- `@vibeshape/ui/package.json` exports `./components/*`, `./lib/*`, `./hooks/*`, and `./globals.css`.
- The application depends on `@vibeshape/ui` through `workspace:*`.
- `style`, `baseColor`, `iconLibrary`, and base implementation match across both configs.
- The Tailwind v4 config path is empty.

Bootstrap is non-interactive and reviewable. The conceptual command for a new Vite monorepo is `bunx --bun shadcn@latest init -t vite --monorepo -d --base radix`, but generated structure is never accepted blindly and Turborepo is optional. For an existing scaffold, init uses defaults or a reviewed preset with Radix base, followed by a diff review of `components.json`, CSS, and package manifests. `-y` alone is not sufficient for guaranteed non-interactive execution; use `-d`.

Add primitives from `apps/web` or with an explicit working directory. Run `--dry-run` or inspect `--diff` before accepting changes. `add --all` is prohibited.

## Tailwind v4

- Use the official `@tailwindcss/vite` plugin.
- Use `@import "tailwindcss"` in shared global CSS.
- Define the theme primarily through CSS custom properties and `@theme inline`.
- Never generate runtime class fragments such as ``bg-${color}-500``.
- Express repeated variants with `cva` and merge classes through `cn()` using `clsx` and `tailwind-merge`.
- Group long static utility sets by interaction concern instead of storing an entire component style in one opaque line.
- Use arbitrary values only for genuinely computed layout or overlay geometry.
- Viewport model geometry is not styled with Tailwind classes.

## CAD visual direction

VibeShape is a dense tool, not a marketing dashboard:

- dark-first with a complete light theme;
- `new-york` as the initial shadcn density/style with Radix base;
- neutral or zinc surfaces with one restrained primary accent;
- compact dimensions: 32–36 px toolbars, 28–32 px panel controls, 12–14 px body text;
- smaller radius than consumer cards, while following one radius scale;
- panels separated by borders and resizable separators, not nested cards;
- no gradients or glassmorphism in the working area;
- consistent Lucide icon size and stroke, with accessible names or tooltips where needed;
- the viewport remains visually dominant.

## Semantic tokens

Extend the base shadcn tokens with CAD-specific tokens:

- `--background`, `--foreground`, `--card`, `--popover`, `--border`, `--input`, and `--ring`;
- `--panel`, `--panel-muted`, `--toolbar`, and `--viewport-background`;
- `--selection`, `--preselection`, and `--selection-foreground`;
- `--sketch-under`, `--sketch-full`, `--sketch-conflict`, and `--construction`;
- `--feature-active`, `--feature-suppressed`, `--feature-error`, and `--feature-stale`;
- `--diagnostic-info`, `--diagnostic-warning`, and `--diagnostic-error`;
- `--axis-x`, `--axis-y`, and `--axis-z`;
- compact spacing, control-height, panel-width, and radius tokens.

Never encode state with color alone. Add icons, shape, text, or line style. Check contrast in both themes and in viewport overlays.

## Initial primitive set

Add components only when needed, in this order:

1. `button`, `tooltip`, `separator`, `scroll-area`;
2. `input`, `label`, `select`, `checkbox`, `slider`;
3. `dropdown-menu`, `context-menu`, `popover`;
4. `dialog`, `alert-dialog`, `sheet`;
5. `command` for the command palette;
6. `tabs`, `resizable`, `collapsible`, `badge`, `progress`, `skeleton`;
7. `table` for tabular data only, never as the model tree.

The model tree is a dedicated accessible and virtualized tree because generic shadcn components do not define CAD tree selection or keyboard semantics.

## Composition rules

- Follow the complete [UI component contracts](ui-component-contracts.md) for component layering, asynchronous actions, form adapters, state inventories, and verification.
- Follow [Internationalization](internationalization.md) for all product copy, accessible names, validation, status, and diagnostic messages.
- Build the native or state-agnostic primitive before its TanStack Form adapter; the adapter imports the primitive, never the reverse.
- Buttons that start Promise-like work become single-flight, expose an accessible pending state, and suppress accidental double activation. Error reporting remains owned by the command or form.
- Use `AlertDialog`, not `Dialog`, for destructive confirmation.
- Provide one tooltip provider at the application root.
- Toolbar actions use button variants without losing native focus and keyboard behavior.
- Invalid inputs have labels, messages, and `aria-invalid`, not only a red border.
- The command palette invokes the same application commands as toolbars, menus, and shortcuts.
- Command presentation uses source-owned shadcn composition over `cmdk`. Serializable descriptors contain stable identity, owner, localization keys, grouping, icon identity, toolbar placement, and shortcut metadata; trusted handlers contain eligibility and invocation. Composition fails closed before the shell renders.
- Disabled commands remain searchable with localized reasons. Successful palette invocations may affect bounded local ranking, but project data, command eligibility, and document history never depend on that preference.
- `Ctrl/Cmd+K` is reserved from text entry. Tool shortcuts ignore input, textarea, select, editable, textbox, repeat, and IME events; `Escape` remains eligible for the documented CAD cancellation hierarchy.
- Context menus are never the only way to invoke an action.
- Layout state such as panel sizes and theme is a local UI preference, not domain state.
- Add a visual harness or Storybook only if it pays for itself; command-flow E2E remains mandatory.

## Themes

- `dark`, `light`, and `system`;
- theme class on `<html>`;
- preference stored separately from the project;
- print and export colors independent of UI theme;
- high-contrast preset considered after the base accessibility audit;
- self-hosted or system-first fonts so offline use never requires a third-party network.

## Verification

- keyboard-only core flows;
- ARIA toolbar, menu, dialog, tree, and status-message behavior where applicable;
- focus trap and restoration for dialog, sheet, and popover;
- contrast and non-color state cues;
- minimum target size and spacing;
- 200% zoom at minimum desktop width;
- long localized labels;
- pointer and trackpad behavior, with touch later;
- screenshot tests for both themes;
- no missing Tailwind classes in the production build;
- controlled CSS size and shipped primitive count; remove unused generated components.

## Updating shadcn components

The CLI does not update components like an opaque dependency. For each update:

1. Record and pin the CLI version.
2. Use `view` or `--diff` for the target component.
3. Preserve project-specific CAD variants and accessibility fixes.
4. Verify unified `radix-ui` imports.
5. Run typecheck, visual/component tests, and E2E.
6. Update third-party notices when the source or dependency set changes.

Record the preset in the repository. Running `init --force` without review is prohibited because it may rewrite CSS tokens and component configuration.
