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
or production latency improvement. This describes the October 8 source state; current edge
preparation runs in the worker. Comparison cost grows linearly with equal mesh data.

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

Ordinary hover is already frame-coalesced, edges are prepared in the worker, and feature-level
highlights borrow model geometry. Those mechanisms are existing mitigations, not new proposals.
Dense hover raycasting, active thumbnail rendering/PNG encoding, and startup code splitting remain
profiling candidates. The production build reports that static viewport imports prevent its
dynamic imports from forming a separate chunk. That warning identifies a dependency boundary,
not a measured startup bottleneck. A picking acceleration structure or OffscreenCanvas would add
ownership, protocol, or memory costs and need a representative
browser measurement before implementation.

## October 21 interaction work

Three further CPU paths were measured against `79dc38721424cc72d7d33b8cd91a1777f4241b76`
using identical synthetic inputs on macOS arm64 / Apple M5 / Bun 1.4.2. Each path uses five warmups
and 25 measured batches. These numbers exclude GPU drawing and are not frame-rate claims.

| CPU batch | Before median | After median | Before / after p95 |
| --- | --- | --- | --- |
| 30 face transitions, 480,000 triangles, warm face metadata | 64.588 ms | 0.149 ms | 68.596 / 0.464 ms |
| 12 section offsets over 64 bodies, 196,608 triangles | 216.430 ms | 18.342 ms | 349.836 / 20.722 ms |
| Nine thumbnail requests, eight superseded, preparation only | 289.171 ms | 35.119 ms | 320.828 / 40.359 ms |

Face extraction now indexes triangle offsets lazily by immutable face-metadata array, with WeakMap
lifetime and unchanged output order/ownership. A cold first extraction measured 2.206 → 1.532 ms;
the warm batch benefit does not describe first use. The index adds memory proportional to triangle
count. Section extraction rejects a body only when the plane misses its cached conservative bounds
plus welding tolerance; crossing, tangent, hole and manifold handling retain the original algorithm.

Background project thumbnails debounce for 250 ms before snapshot preparation. Superseded pending
requests are aborted before buffer copying or renderer creation, reducing the measured burst from
nine prepared snapshots to one. Explicit previews retain eager snapshots and serialization. An
already-running synchronous render/encode cannot be interrupted; disposal still completes and stale
results are ignored. The CPU measurement ends at an identical missing-browser failure and excludes
successful PNG rendering/encoding; the real WebGL preview browser test verifies successful output.

The unchanged dense-raycast control measured 278.755 → 317.108 ms per 16 picks, with overlapping
ranges (270.072–366.913 / 269.851–471.001 ms). Shared machine load was uncontrolled, so no raycasting
speedup or overall interaction-latency claim follows from this run. Renderer DPR, antialiasing,
geometry quality, picking identity, and document/MCP contracts are unchanged.

Targeted tests cover face metadata replacement, exact copied buffers, tolerance-boundary section
planes, thumbnail cancellation/serialization/disposal, debounce, unmount, and bounded retries.
Chromium browser coverage verifies successful preview PNGs, camera preservation, section dragging
and cancellation in both themes, and unchanged saved solids. Reproduction fixtures, source hashes,
raw timing samples and logs are retained in the task's local artifact directory under
`artifacts/ux-tool-usability/performance/`; these local artifacts are not distributed application data.
