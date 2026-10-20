# Surface relief through MCP

Model-write approval follows the [session policy](../../vibeshape-use/references/session.md).
The built-in chat commits validated changes to its current project without another Apply action;
manual review requirements below describe external MCP clients. Publishing or updating the reusable
local library remains separately reviewed for every connection.

Read the current revision and terminal feature/body role before authoring. Discover
`model_surface_textures`, `create_surface_texture`, `update_surface_texture` and
`remove_surface_texture`; local and paired remote MCP share these names and contracts. Use the
ordinary editor when the connected server does not advertise them.

Relief is an editable layer on an existing producing feature. It changes the derived viewport and
STL/3MF mesh. STEP, exact measurements and the original CAD B-Rep retain their source geometry.
Do not use relief as a substitute for an exact solid feature or promise physical wall thickness.

## Select and create

Call `model_surface_textures` with exact `revision` and `featureId`. It returns ordered layer IDs,
settings, target kind/role, map dimensions and mask counts. Pixels, dabs and full face references are
omitted. Preserve omitted owned data when updating; do not reconstruct it from this summary.

Create requires a fresh UUIDv7 `layerId`, `featureId`, `baseRevision` and complete `recipe` from the
live schema. Each feature allows four ordered layers. Choose an explicit current `outputRole` from
body inspection. Face targets carry the complete resolved `reference` from `model_body_topology`
at the current revision; preserve its feature and role and never invent native indices. Missing or
ambiguous selections fail closed. Show an enabled target body before requesting relief preview.

A whole-body built-in recipe has this shape; replace the role and dimensions with the intended
design. `heightMm`, U/V sizes and offsets, fade and dab centers/radii use canonical mm.

```json
{
  "enabled": true,
  "target": { "kind": "body", "outputRole": "result" },
  "map": { "kind": "builtin", "pattern": "knurling" },
  "mapping": { "kind": "triplanar", "axis": "z" },
  "heightMm": 0.3,
  "sizeUMm": 5,
  "sizeVMm": 5,
  "rotationDeg": 0,
  "offsetUMm": 0,
  "offsetVMm": 0,
  "direction": "outward",
  "invert": false,
  "boundaryFadeMm": 0,
  "blend": "add",
  "mask": { "base": "all", "strokes": [] }
}
```

Custom maps use `{ "kind": "custom", "width": W, "height": H, "grayscaleBase64": "..." }`.
Encode exactly W times H unsigned bytes in row order, each 0..255, using canonical padded base64.
Width and height range from 1 to 256; a complete 256-square map is supported. The map is local data,
not a file URL or an upload permission. Convert image luminance/alpha with ordinary client image
tools when available, or use the visible editor's local image conversion. Do not transmit private
images to another service or print packed bytes into the conversation.

## Update, paint and remove

`update_surface_texture` takes `baseRevision`, `layerId` and only changed `patch` fields. Omitted
map, target and mask retain their full saved values without quantization. To paint, provide
`appendMaskStrokes`: ordered dabs with model-space `center`, unit `normal`, positive `radiusMm`,
`hardness` 0..1 and `mode` paint/erase. Total saved dabs cannot exceed 2,048. Mask replacement and
append are exclusive in one operation. Reduce an append batch if the ordinary 192 KiB request
budget is exceeded; each accepted update is a separate reviewed save and Undo entry.

Use `remove_surface_texture` with the exact base and existing layer ID. It requires the browser's
destructive confirmation and removes only that layer. Removal, disabling and mask repair remain
available when that layer cannot produce valid relief.

## Review and accept

Every mutation performs native relief preflight and opens manual browser review, including sessions
that allow CAD auto-apply. Inspect the displayed layer collection, target, map dimensions, settings,
mask counts and relief on the model. Apply is unavailable until enabled layers have a ready current
viewport preview. Reduce height, increase pattern size or repair targets when preview fails.

Approval repeats native preflight, rechecks the paired actor/session, expiry and source revision,
then saves the exact reviewed collection once through ordinary document authority. Request a new
proposal after a stale revision or disconnect; caller approval flags and raw commands are rejected.
Read the saved revision/summary after success. An uncertain save requires inspecting saved state
before retrying. Use ordinary Undo/Redo for committed layers and requested export workflows for
editable backups or derived meshes; a successful preview alone has not saved the model.
