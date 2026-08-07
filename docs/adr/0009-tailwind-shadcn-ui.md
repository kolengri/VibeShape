# ADR-0009: Tailwind CSS v4 with shadcn/ui and Radix

- Status: **Accepted**
- Date: 2026-08-07

## Context

CAD requires a dense, keyboard-first interface with toolbars, menus, a command palette, dialogs, panels, property forms, and complex states. The application needs accessible primitives, shared tokens, and deep customization without depending on a closed design system.

## Decision

Use Tailwind CSS v4 through its official Vite plugin and shadcn/ui CLI v4 with the Radix base. Generated source and tokens live in `@vibeshape/ui`; CAD-specific components remain in the application or feature layer.

The initial direction is compact and dark-first, using `new-york`, neutral or zinc colors, one accent color, semantic CAD tokens, and Lucide icons. Add only the primitives that are actually used.

## Consequences

- Component source belongs to the repository and requires code review and maintenance.
- Monorepo `components.json` files, aliases, and exports must remain aligned.
- Utility classes must not replace semantic tokens and component variants.
- The model tree and viewport overlays require custom accessible components.
- shadcn updates are applied by reviewing diffs, never by blind overwrite.
- MIT and ISC notices are included in third-party compliance artifacts.

## Rejected Alternatives

- CSS Modules as the only styling system require more manual work for tokens and variants.
- A monolithic component library provides less source ownership and less control over interface density.
- Raw controls without primitives increase accessibility and consistency risk.
- `shadcn add --all` unnecessarily expands the shipped and review surface.
