# ADR-0116: Source-owned colored UI icons

- Status: **Accepted**
- Date: 2026-10-20
- Supersedes: the Lucide runtime icon choice in [ADR-0009](0009-tailwind-shadcn-ui.md)

## Context

CAD operations need distinct silhouettes and action cues at dense interface sizes. The approved
colored study replaces the mixed Lucide/custom monochrome family and establishes optical sizing,
a small shared palette and separate contextual tools.

## Decision

Keep native SVG masters and a stable catalog in `packages/ui/src/icons`. Generate static React
components and compatibility exports with `bun run icons:generate`; verify generated sources with
`bun run icons:check`. Use one colored family across the CAD application and shared controls,
retaining host layout, accessibility and interaction contracts.

The [icon contract](../product/icon-design.md) owns visual rules and review criteria. Existing
Tailwind/shadcn/Radix architecture remains in effect. Upstream shadcn configuration and separate
presentation-site icons do not select application runtime artwork.

## Consequences

- New commands extend the catalog rather than introducing another family.
- Editable SVGs produce static JSX without a runtime parser or additional loader.
- Compatibility aliases preserve callers; command and FDM mappings become explicit.
- Both-theme checks include real interface sizes and neighboring glyphs.
- Branding and third-party marks remain outside command artwork.
