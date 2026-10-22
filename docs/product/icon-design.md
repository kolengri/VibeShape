# UI icon family

VibeShape uses original colored SVG icons for commands, menus, object/history presentation, FDM
tools and shared controls. The approved Frosted family is the baseline. Brand marks and vendor logos
remain separate assets.

## Source and generation

- `packages/ui/src/icons/svg/` contains editable, self-contained native SVG masters.
- `packages/ui/src/icons/catalog.json` owns stable IDs, English labels and legacy export aliases.
- `scripts/generate-ui-icons.ts` produces `src/generated/colored-icons.tsx` and the public `icons.tsx` barrel.
- `colored-icon.tsx` supplies a decorative SVG wrapper, host sizing and SVG props/ref support.
  Each instance scopes its gradient and mask IDs with React `useId`; references must resolve inside
  that SVG, including repeated icons in toolbars, menus and hidden panels.
- `cad-icons.tsx` preserves the original CAD import surface as compatibility re-exports.

Run `bun run icons:generate` after a source/catalog edit. `bun run icons:check` detects stale generated
code and runs through `bun run lint`, including the existing CI lint step. Generated JSX uses shared `--icon-*` tokens with the
approved source colors as fallbacks. It needs no runtime XML parser, external font, raster image,
network asset request or SVG loader plugin. Pure factories allow unused drawings to be tree-shaken.
Native gradients, luminance masks and material opacity remain editable in the SVG masters. Their
JSX attributes and instance-local references are generated rather than patched in components.
Generation omits definitions that are unreachable from the artwork, while preserving their editable
master copies and any dependencies referenced by retained masks or gradients.

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
| Top face | `--icon-material-top-start`, `--icon-material-top-end` | Light: `#eff7ff` → `#c8ddf2`; dark: `#f2f8ff` → `#cfe2f6` |
| Front face | `--icon-material-front-start`, `--icon-material-front-end` | Light: `#b6d3ee` → `#82afd8`; dark: `#c4ddf4` → `#8ebce3` |
| Side face | `--icon-material-side-start`, `--icon-material-side-end` | Light: `#7eacd3` → `#5385b5`; dark: `#8bb6dc` → `#6597c7` |
| Construction / recess | `--icon-geometry-ink`, `--icon-geometry-recess` | Ink: light `#5784b0`, dark `#9cc6eb`; recess: `#547ca2` |
| Action / operation | `--icon-action-stroke`, `--icon-action-highlight`, `--icon-action-fill` | `#cd7b24`, `#fae5c9`, `#f1bc77` |
| Destructive / error | `--icon-danger-stroke`, `--icon-danger-fill` | `#ba534d`, `#f7e1de` |
| Success / confirmation | `--icon-success-stroke`, `--icon-success-fill` | `#2e8065`, `#deeee6` |

Use the shared light/dark material tokens; do not recolor artwork with enclosing text color. Host
surfaces, focus rings, selected state and disabled opacity retain their existing ownership. Selection
cannot rely on hue alone. Menu indicators use a simple green check; confirmation uses its full icon.
Status surfaces use the shared success, danger, warning and amber gradient tokens. Neutral closing,
dismissing and clearing use `CloseIcon` (also the legacy `X` export); explicit operation cancellation
uses `CancelIcon` and retains red status semantics.

Describe volume through soft blue faces and tonal depth, with opaque amber working faces and action
cues. Avoid perimeter outlines on filled controls, Chamfer and Pyramid. Retain only meaningful
construction lines and dashed sketch planes. Section planes pass through the center of translucent
cubes. The Frosted effect uses static gradients and opacity, without background refraction.

Compensate functional lines for optical/nested transforms. Simplify narrow facets, tiny badges,
doubled seams and glints that become noise. Folder variants share one silhouette and an interior plus.

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
[ADR-0117](../adr/0117-source-owned-colored-ui-icons.md).
