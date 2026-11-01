# ADR-0147: Derived model picture rendering

- Status: Accepted
- Date: 2026-11-02

## Decision

Extend the existing viewer with disposable picture rendering and Model inspection commands with
a Render Picture dialog. Render visible committed terminal bodies with copied mesh buffers and
authored colours. The host captures document, revision and visible-source identity; changes
invalidate pending work and output. Rendering creates no CAD feature, command, migration or Undo
entry. Dialog settings are temporary. Presets provide Studio, Wooden table, Workbench and Outdoor
scenes, per-body finishes, and auto-framed or captured current orthographic cameras. A current
camera must belong to the requested project. Saved camera presets and Blender remain outside scope.
Enabled authored surface relief and assembly occurrence placement are explicitly unsupported in
both UI capture and MCP preparation; neither path silently renders their undecorated base geometry.

Draft uses Three.js raster rendering. Standard and High use the pinned MIT WebGL
`three-gpu-pathtracer` 0.0.24 with 24 and 64 samples. Procedural scenes require no asset downloads.
Reuse the installed Three.js and mesh BVH rather than implementing another light-transport core.

One private renderer owns its context, geometry, materials, textures and compilation lifecycle.
Cancellation, timeout, source invalidation and context loss drain shader compilation before
resource disposal. The adapter relies on Three.js 0.185.1's public `compile`/`compileAsync`
material-batch polling contract, which needs regression checks when upgrading. Body, triangle,
mesh-byte, pixel, PNG-byte and duration budgets bound work. Synchronous driver calls remain
non-preemptible. Named stages and measured sample counts promise no fixed render latency.

The browser owns PNG preview and download. Paired automation uses the same renderer and existing
actor-bound export retention, chunk reads and discard. Transport budgets apply independently of
render budgets; oversized output is rejected rather than embedded in a query or rendered at
silently reduced quality. No automatic file write, download or model mutation accompanies a read.

## Consequences

Input, camera, budget and lifecycle tests complement real browser PNG, progressive completion,
compilation cancellation and immediate retry tests. Mock GPU checks alone cannot establish shader
compatibility. Generated browser notices must include the reachable rendering dependencies.
See the [implementation contract](../../apps/web/src/features/picture-render/README.md) and
[operator workflow](../../.agents/skills/vibeshape-export/references/picture-render.md).
