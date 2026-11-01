# Render a picture

Use `prepare_picture_render` on local or paired remote MCP with `projectId` and the exact committed
`revision`. This read-only operation rebuilds that bound project's visible terminal bodies privately;
it does not use a different active project's viewport or create a draft, pose, history entry,
download, filesystem write or saved render settings. Authored Part visibility, colours and material
presets are captured with source identity. Editor-only temporary visibility overrides are not
part of the committed source. Assembly occurrence placement and authored surface relief are
unsupported and fail explicitly; use the editor's supported inspection paths for those models.

`settings` defaults to Studio (`studio`), Draft (`draft`), 1080 × 1080, `camera: "auto"`, and no
finish overrides. Scenes also include `wooden-table`, `workbench` and `outdoor`; quality also includes
`standard` and `high`. Per-body finishes are `matte`, `glossy`, `translucent`, `resin`, `metal` and
`wood`. The finish key is the viewer's exact body key: feature ID alone without an output role,
or feature ID + a NUL separator + output role (JSON represents NUL as `\u0000`). Keys must identify
visible bodies; unknown or hidden targets fail. Omitted finishes preserve the captured appearance.

Auto framing does not accept a camera pose. To supply an explicit pose use `settings.camera:
"current"` and `camera: { position, target, up?, viewHeightMm? }`, in model millimeters. Here
`current` is the renderer's framing mode: MCP requires the caller's explicit pose and does not
claim to capture an ambient current viewport. Position and target must differ, and up must be
independent of the viewing direction. Omitted camera mode always means auto framing.

The result contains `file`, actual resolved `settings`, optional explicit `camera` and a
`sourceDigest`. `file` is the ordinary actor-bound descriptor: `model.png`, `image/png`, format
`png`, document/revision, byte length, SHA-256, five-minute expiry and chunk limit. Fetch using
`read_export_chunk`, verify byte length/hash, then `discard_export`. The actual PNG must fit
6 MiB; larger images fail `export-too-large`, even though the editor renderer permits 12 MiB.
Do not request PNG through `prepare_model_export` or treat it as an editable CAD format.

Rendering is bounded to 128 bodies, 200,000 triangles, 32 MiB input meshes, 1920 pixels per dimension,
2,073,600 pixels total and two minutes. Stop, cancellation, disconnect, source replacement,
revision or authored appearance/visibility changes prevent late artifacts and revoke retained PNGs.
A descriptor is preparation evidence; report delivery only after the client has assembled and
verified the bytes at the requested destination.

Keep the client request open for up to two minutes and do not resubmit concurrently. A client
timeout cancels the operation; inspect fresh project authority before retrying.
