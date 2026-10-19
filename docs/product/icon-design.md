# UI icon family

VibeShape uses original colored SVG icons for commands, menus, object/history presentation, FDM
tools and shared controls. The approved V5 family is the baseline. Brand marks and vendor logos
remain separate assets.

## Source and generation

- `packages/ui/src/icons/svg/` contains editable, self-contained native SVG masters.
- `packages/ui/src/icons/catalog.json` owns stable IDs, English labels and legacy export aliases.
- `scripts/generate-ui-icons.ts` produces `src/generated/colored-icons.tsx` and the public `icons.tsx` barrel.
- `colored-icon.tsx` supplies a decorative SVG wrapper, host sizing and SVG props/ref support.
- `cad-icons.tsx` preserves the original CAD import surface as compatibility re-exports.

Run `bun run icons:generate` after a source/catalog edit. `bun run icons:check` detects stale generated
code and runs through `bun run lint`, including the existing CI lint step. Generated JSX uses shared `--icon-*` tokens with the
approved source colors as fallbacks. It needs no runtime XML parser, external font, raster image,
network asset request or SVG loader plugin. Pure factories allow unused drawings to be tree-shaken.

Import application icons through `@vibeshape/ui/components/icons`, or `#components/icons` inside
shared UI. Do not introduce direct Lucide imports or another local action-glyph family. The separate
presentation site can retain its marketing icon dependency; shadcn's Lucide configuration describes
upstream scaffolding, not accepted application runtime artwork.

## Visual contract

Masters have a 256 x 256 viewBox and transparent padding. Artwork uses a 64-unit construction grid
inside a scale of four. Optical transforms center each silhouette and balance its weight against
neighbors. Width, height or pixel area alone cannot establish optical equivalence.

| Role | Shared tokens | Approved colors |
| --- | --- | --- |
| Geometry contour/material | `--icon-geometry-stroke`, `--icon-geometry-highlight`, `--icon-geometry-fill`, `--icon-geometry-shade` | `#326db2`, `#e4eef9`, `#bfd4ee`, `#8fb2dc` |
| Action / operation | `--icon-action-stroke`, `--icon-action-highlight`, `--icon-action-fill` | `#cd7b24`, `#fae5c9`, `#f1bc77` |
| Destructive / error | `--icon-danger-stroke`, `--icon-danger-fill` | `#ba534d`, `#f7e1de` |
| Success / confirmation | `--icon-success-stroke`, `--icon-success-fill` | `#2e8065`, `#deeee6` |

Keep the palette across light/dark themes; do not recolor artwork with enclosing text color. Host
surfaces, focus rings, selected state and disabled opacity retain their existing ownership. Selection
cannot rely on hue alone. Menu indicators use a simple green check; confirmation uses its full icon.

At 20 px, filled contours are 1.125 px, primary strokes 1.3125 px and secondary strokes 0.875 px.
Compensate for optical/nested transforms. Simplify narrow facets, tiny badges, doubled seams and
glints that become noise. Folder variants share a single-layer silhouette and an interior plus.

Distinct concepts need distinct silhouettes or operation cues. Descriptors retain semantic icon
identities across toolbar, palette and shortcuts. History reads validated FDM parameters and shares
subtool icons with the selector; invalid parameters fall back to generic FDM artwork.

## Accessibility and acceptance

Decorative icons use `aria-hidden` and `focusable=false`, without an image role or repeated title.
The host owns the accessible name. Explicitly named standalone statuses override accessibility
defaults. Keep existing control sizes, shortcuts, keyboard focus, pending and reduced-motion behavior.

Inspect large artwork for joins, holes and painter order. Compare 48 px and actual 20 px in mixed
panels on both themes; also inspect 16/24 px where used. Review new/revised sets in self-contained
labeled HTML under `artifacts/<task>/`. Structural checks do not establish visual quality.

See [VibeShape Icon Design](../../.agents/skills/vibeshape-icon-design/SKILL.md) and
[ADR-0116](../adr/0116-source-owned-colored-ui-icons.md).
