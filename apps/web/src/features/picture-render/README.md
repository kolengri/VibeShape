# Picture rendering

This derived browser capability uses visible committed terminal body meshes and authored body colours.
It adds no saved features, settings, document commands, revisions, migrations or Undo entries.
Model → Inspect, the command palette and the application menu open the same **Render Picture** dialog. Settings survive return from the PNG preview
within the dialog; closing the dialog discards them. Current view uses the active viewport's
orthographic pose and vertical extent. Auto-frame fits projected body bounds to the output aspect.
Saved camera presets are not present in the current viewport contract.

UI capture and MCP share the representation eligibility policy. Enabled authored Surface texture
layers and assembly occurrence placement are rejected explicitly; the picture dialog explains the
unsupported representation and disables rendering instead of silently drawing undecorated base
geometry. Removing the unsupported state restores ordinary rendering.

`@vibeshape/viewer/picture-render` exports `renderPicture(request, control)`, the runtime
`pictureRenderSettingsSchema`, presets, limits, progress/result types and `PictureRenderError`.
The request contains `meshes`, `settings`, and an optional `camera` (`ModelPreviewCamera`).
The control contains an optional `AbortSignal`, `onProgress` and `isCurrent` callback. The host must
capture project ID/revision and visibility and return false from `isCurrent` after any change.
The result contains a PNG `Blob`, `width`, `height` and `mimeType`. No file or network authority is
part of the renderer. The host owns artifact encoding/storage/download and its transport limits.

The shell's existing viewport capture port also exposes `pictureSource()` with the currently visible
viewport's committed meshes, project ID/revision and camera. `subscribePicture()` announces owner
changes; callers must reject stale output. The picture dialog aborts pending work and revokes its
object URL when this source changes or unmounts. Preview, datum and selection meshes are never input.
MCP exposes `prepare_picture_render` through local and paired remote transports. Its bound session
uses a disposable committed rebuild with authored Part visibility/colours, never an ambient
viewport from a different project. Auto framing is default; current framing requires an explicit
camera pose. The derived `model.png` descriptor uses ordinary actor-bound binary chunk retention,
with an actual 6 MiB cap; PNG is not a geometry export format. Revision/source changes, Stop and
disconnect revoke pending and retained PNGs. See the
[operator reference](../../../../../.agents/skills/vibeshape-export/references/picture-render.md).

Draft uses Three.js raster rendering with shadows and a generated environment. Standard and High use
`three-gpu-pathtracer` **0.0.24** (MIT; Garrett Johnson), with 24 and 64 samples and five bounces.
The published WebGL release accepts Three.js >=0.180.0 and three-mesh-bvh >=0.7.4, compatible with the
repository's pinned 0.185.1 / 0.9.15. Upstream's current main branch has moved to WebGPU; do not update
this dependency from main without reviewing the renderer boundary. The package license is retained
in the dependency; the release build must include it in the generated browser license inventory. Its xatlas-web
peer is installed but the renderer does not invoke UV unwrapping or load its WASM.

Sources: [published metadata](https://registry.npmjs.org/three-gpu-pathtracer/0.0.24),
[upstream](https://github.com/gkjohnson/three-gpu-pathtracer).
No Extrudo source files were copied or adapted; its progressive-render design was reviewed.

The scene uses private copied buffers, geometries, physical materials, procedural textures, lights
and one disposable WebGL context. Scene presets and finishes are procedural; no assets are fetched.
A fence after each path tracing tile prevents an unbounded GPU command queue. Progress reports named
stages, and measured sample counts only during tracing. Limits are 128 bodies, 200,000 triangles,
32 MiB mesh input, 1920 pixels per dimension, 2,073,600 total pixels, 12 MiB PNG and two minutes.
These are enforced budgets, not measured peak GPU memory claims. Synchronous bounded scene/BVH setup
and a currently executing driver/shader call cannot be preempted by JavaScript cancellation;
cancellation is observed between stages/tiles and during PNG encoding. All private resources and
the private context are released on success, cancellation, stale output, failure and timeout.
The renderer never falls back silently to a different quality.

Compilation remains asynchronous. The private renderer tracks each `compileAsync` call and its
material batches through the public `compile` method. In pinned Three.js 0.185.1, `compileAsync`
polls the mutable `Set<Material>` returned by `compile`. Before disposing the tracer, materials or
context, cleanup clears those owned batches and awaits every tracked compilation promise. The next
poll settles without touching disposed programs or waiting for GPU readiness, even on context loss
or timeout. Repeated cancellation is harmless and the single-job lock is released after cleanup.
This relies on the pinned Three compile contract; recheck it against the installed implementation
when upgrading Three. No pathtracer private fields, synchronous shader fallback, or log suppression
are used. The compiling stage is emitted only after the tracer actually starts compiling.

Focused Bun tests cover copied inputs, rejection/limits, projected camera framing, private-resource
cleanup, cancellation while encoding or compiling, repeated abort, stale output, context loss,
timeout, sample progress and single-job admission. `tests/e2e/picture-render.spec.ts` checks real PNG signature/dimensions, hidden-body filtering,
return to settings, unchanged saved model, cancellation after compilation starts, immediate Draft retry and a
completed Standard PNG. Browser execution and final
integrated build/review remain release gates; unit GPU stubs do not prove shader/browser compatibility.
