---
name: vibeshape-ui-workflow
description: Build, change, or review VibeShape React UI using Tailwind CSS v4, shadcn/ui with Radix, semantic CAD tokens, accessible interaction, and shared package boundaries. Use for TSX or CSS changes, editor layout, viewport overlays, model-tree behavior, forms, dialogs, command surfaces, component variants, or any request about product design and UX.
---

# VibeShape UI Workflow

## Read the Contract

Before editing UI, read:

- `docs/product/design-and-ux-guidelines.md`
- `docs/product/ux-flows.md` for the affected command or journey
- `docs/architecture/ui-system.md`
- `docs/adr/0009-tailwind-shadcn-ui.md`

Use current library documentation through Context7 before changing shadcn, Radix, Tailwind, or Vite configuration.

## Place Components Correctly

- Put source-owned shadcn primitives, visual hooks, `cn`, and tokens in `packages/ui`.
- Put reusable CAD widgets in the narrowest package that owns their interaction contract.
- Keep feature-specific composition in `apps/web`.
- Keep React and UI state out of `packages/domain`, worker protocols, geometry adapters, persistence, and file-format packages.
- Prefer explicit package subpath exports over a large root barrel.

## Implement in This Order

1. Identify the registered application command or UI-local preference being changed.
2. Search for an existing primitive, token, and component variant before adding one.
3. Compose shadcn/Radix primitives; add a new primitive only when composition cannot satisfy the interaction.
4. Build form controls as state-agnostic, uncontrolled-first components before creating a separate TanStack Form adapter.
5. Define idle, hover, focus, selected, disabled, preview, loading, error, success, and cancellation states.
6. Preserve one command implementation across toolbar, menu, palette, context menu, and shortcut.
7. Add keyboard behavior, accessible name, description, validation, focus restoration, and status announcement with the component.
8. Verify dark and light themes, 1024 px authoring width, 200% zoom, reduced motion, and long English source copy.

## Async Actions and Form Adapters

- Follow `docs/architecture/ui-component-contracts.md` for every interactive primitive or adapter.
- Suppress accidental pointer double activation for ordinary action buttons. Promise-like handlers become single-flight until fulfillment or rejection.
- Pending controls expose native or ARIA disabled semantics, `aria-busy`, a visible loader, and their original accessible name.
- Support external loading state for form stores, mutations, and command dispatchers whose Promise is not returned from `onClick`.
- Keep errors, retry, cancellation, persistence, and idempotency in the owning form or command; a Button owns only activation and pending presentation.
- Base inputs preserve native `defaultValue`, `defaultChecked`, ref, name, focus, and keyboard behavior without importing TanStack Form.
- TanStack field and submit adapters live behind the explicit UI integration export and reuse base components without duplicating markup or styles.
- Test the base uncontrolled component first, then value binding, validation, dirty/submitting policy, and repeat submission through the adapter.

## Tailwind and shadcn Rules

- Use semantic theme tokens for foundational surfaces and CAD state; do not add ad hoc hex colors.
- Express reusable variants with `cva`.
- Use the single `cn` export from `@vibeshape/ui` for conditionals, variants, or caller `className` overrides.
- Do not concatenate Tailwind class strings or add another `cn` implementation.
- Use static classes that Tailwind can discover; arbitrary values are reserved for computed viewport geometry.
- Add only required shadcn primitives and review generated source and dependency changes.
- Never run `shadcn add --all` or blindly overwrite modified components.

## CAD Interaction Guardrails

- Preview does not mutate the document; Apply creates one command and one undo entry.
- `Escape` follows the documented cancellation hierarchy.
- Selection and topology ambiguity are never repaired silently.
- Context menus and canvas gestures are not the only way to invoke a core action.
- Tooltips contain hints, not required instructions or errors.
- Use `AlertDialog` for destructive confirmation and a non-modal task panel for normal feature parameters.
- Keep local save, native-file export, and backup language distinct.

## Verify

Use `vibeshape-verify-scope` for the smallest affected workspace. UI work normally requires lint, typecheck, focused component or E2E tests, and a production Vite build when Tailwind discovery, workers, or assets may be affected.
