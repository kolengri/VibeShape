---
name: vibeshape-icon-design
description: Create, refine, and register VibeShape SVG UI icons with the shared colored family and optical sizing.
---

# VibeShape Icon Design

Read [the icon contract](../../../docs/product/icon-design.md) before drawing or integrating a glyph.
This workflow owns UI artwork, not model geometry, brand marks, or vendor logos.

## Reuse the Meaning

Inspect `packages/ui/src/icons/catalog.json` and actual command/menu consumers. Reuse artwork for
the same meaning. Sketch/model fillet and chamfer, compound/union, ordinary/generative lightweighting,
and individual FDM tools have distinct artwork. Extend command presentation rather than adding a
toolbar-specific map. FDM selection and History share `FdmToolIcon`.

## Draw and Inspect

- Author native paths/shapes in `packages/ui/src/icons/svg/` on the shared 256 x 256 canvas. The
  construction grid is 64 units inside `scale(4)`; retain transparent padding.
- Match the approved blue material, warm action cues, semantic red/green, rounded contours and
  flat shades. Avoid gradients, decorative glints and extra badges.
- Inspect a large drawing first: contours meet exactly, holes remain open and hidden edges do not
  leak through solid faces. Give material, recesses and action cues deliberate roles; recoloring
  must not turn an obsolete highlight into a structural line.
- Balance optical size against neighboring 20 px icons. Equal maximum dimensions do not give equal
  visual weight: filled text/cursors need smaller envelopes; circles/diagonals can need overshoot.
  Keep related folder variants on one simple silhouette.
- At 20 px, filled contours are 1.125 px, primary lines 1.3125 px and secondary lines 0.875 px.
  Compensate strokes for optical/nested scales. Simplify facets narrower than their opposing strokes
  and details that collapse into blobs, doubled seams or crowded rings.
- Compare 48 px and actual 20 px together on light/dark surfaces, including a mixed toolbar. Check
  16/24 px when used by the host. A large preview alone is insufficient.

## Register and Deliver

Add the stable ID, English label and compatibility aliases to `catalog.json`. Use semantic canonical
exports in new callers; preserve old aliases. Run `bun run icons:generate` then `bun run icons:check`.
Do not hand-edit generated components or the public barrel.

Import from `@vibeshape/ui/components/icons` in the application or `#components/icons` in shared UI.
Do not add direct Lucide imports or app-local action SVGs. Convert upstream shadcn icon imports to
this family before accepting generated primitives. Decorative icons stay hidden from accessibility;
the host owns its name, dimensions, keyboard/focus behavior and pending/disabled/selected feedback.

Use `vibeshape-verify-scope` and `vibeshape-fallow` for source integration. For artwork review, save a
self-contained labeled HTML in `artifacts/<task>/`, with large, 48 px and true interface sizes.
Follow host preview/render routing. XML/generation checks prove structure, not recognition or visual
approval. No rasterization or external icon service is required.
