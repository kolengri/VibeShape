# Viewport mesh update performance

## Scope and decision

The October 8, 2026 investigation starts from `bb4964fd5ab4`. OCCT rebuilds, tessellation,
and surface-texture relief already run in workers. Viewport redraw requests already coalesce
within a browser frame. The remaining measured cost was rebuilding every visible body's
Three.js geometry, materials, bounds, and `EdgesGeometry` on each mesh publication.

The viewport now reconciles the currently visible bodies by feature ID and output role.
Equal positions, normals, and indices retain their geometry, edges, materials, and GPU buffers.
Comparison uses exact array values, including newly transferred arrays; it does not infer equality
from a feature ID, kernel content hash, or floating-point tolerance. Appearance and original
texture-source geometry must also match. A changed body replaces only its own resources.

Mesh inputs remain immutable display snapshots. Equal transferred arrays replace the retained CPU
array references without incrementing the GPU attribute version. Current triangle-to-face metadata
is refreshed even when the render geometry is equal. Mesh publication still clears ephemeral
selection and picking stacks as before. Hidden, removed, replaced, and disposed bodies release
their owned resources immediately; this is not a cache of historical model revisions.

This preserves [the worker boundary](../adr/0002-geometry-worker-boundary.md) and
[the viewport architecture](../adr/0005-threejs-webgl2-viewport.md). MCP commands, native geometry,
document authority, and operator workflows are unchanged.

## Local measurement

A one-off CPU benchmark compared the former complete-replacement path with the production
`ModelMeshPresentation` on macOS arm64, Bun 1.4.2, and Three.js 0.185.1. The fixture contains eight
spheres with 64 longitudinal and 32 latitudinal segments, totaling 31,744 triangles. Every update
receives freshly cloned arrays, modeling the transferred worker response. Cloning is outside the
timed section. Each path runs six warm-up updates followed by twelve measured updates. The changed
case modifies one position in the last body on every update; the other seven bodies remain equal.

| CPU work per publication | Before median (range) | After median (range) |
| --- | --- | --- |
| Eight equal bodies | 36.83 ms (35.59–40.82) | 0.38 ms (0.36–0.59) |
| One changed body, seven equal bodies | 38.01 ms (36.48–43.85) | 5.56 ms (5.07–8.79) |

These are synthetic CPU timings, excluding kernel rebuilds, transfers, React updates, GPU drawing,
and thumbnails. They do not establish an application-wide speedup, frame rate, memory reduction,
or production latency improvement. Initial creation and changed-body edge extraction remain
synchronous. Comparison cost grows linearly with equal mesh data.

## Acceptance evidence

- `packages/viewer/src/model-meshes.test.ts` covers equal transferred arrays, changed positions,
  normals and indices, current face IDs, sibling roles and ordering, appearance changes, original
  texture sources, and disposal ownership.
- `tests/e2e/mesh-resource-updates.spec.ts` exercises the real viewport and WebGL buffer lifecycle
  in Chromium, Firefox, and WebKit. It tracks the model's surface buffers independently of gizmos:
  equal publication performs no upload or release; changed and hidden bodies release their buffers.
- The existing body-selection browser corpus covers sibling identity, tree/viewport selection,
  removal, and coalesced wheel redraws. The viewport component corpus retains preview, visibility,
  selection, and unchanged-save-publication coverage.

## Further candidates

Dense hover raycasting, thumbnail rendering/PNG encoding, and startup code splitting remain
profiling candidates. The production build reports that static viewport imports prevent its
dynamic imports from forming a separate chunk. That warning identifies a dependency boundary,
not a measured startup bottleneck. Worker-side edge extraction, a picking acceleration structure,
or OffscreenCanvas would add ownership, protocol, or memory costs and need a representative
browser measurement before implementation.
