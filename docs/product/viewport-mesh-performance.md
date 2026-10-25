# Viewport mesh update performance

## October 25 catalogue, reference and graph preparation

Edge-treatment batches and mounted controls share lazy body-scoped topology resolution instead of
constructing the domain index for each selected reference. Nine alternating paired Bun samples,
including fresh preparation, measured 128 references over 2,000 candidates at 928.300 to 8.320 ms
for exact signatures, 942.811 to 7.989 ms for semantic roles, and 1,155.469 to 186.982 ms for drifted
signatures. Statuses and resolved candidate object identities matched. Drift ranking still scans
the complete body for each reference. This is local CPU evidence without memory or browser-frame
measurements; it does not imply equivalent improvement in end-to-end interaction.

Exact-body catalogues index current geometry, successful evaluation and part ownership once per
invocation. Boolean command availability avoids display-option allocation, and mounted Boolean,
Revolve, FDM and History repair tasks retain preparation until their immutable inputs or locale
change. Seven alternating paired Bun samples measured catalogue medians of 2.329 to 0.620 ms for
600 bodies and 73.716 to 3.286 ms for 4,000 bodies; Boolean eligibility measured 0.634 to 0.476 ms
and 5.346 to 2.568 ms respectively. Both variants used the same current application/domain graph
implementation. These are synthetic CPU measurements, excluding browser interaction and drawing.

Reference-frame catalogues validate complete evidence, then prepare only usable planar or straight
supports while retaining every candidate for reference projection and resolution. Local first-match
indexes avoid repeated geometry and graphical-ID scans. Nine alternating paired Bun samples on
2,000-face fixtures measured medians of 70.951 to 60.072 ms for planar faces, 66.200 to 6.057 ms for
spherical faces, and 66.159 to 34.711 ms for a mixture with 20 percent eligible faces. A separate
2,000-body, one-face fixture measured 107.632 to 89.142 ms. Complete catalogue outputs matched;
these timings exclude kernel evaluation and browser latency.

Feature highlights now find installed geometry through an index of the currently presented body
keys. Exact buffer equality still decides whether an overlay may borrow a surface, including copied
arrays and duplicate body keys. The index follows presentation ordering and is replaced or cleared
with its resource owner; it does not own extra geometry or retain removed bodies.

A synthetic Bun 1.4.3 fixture with 2,000 displayed triangle meshes queried each body's installed
surface once per sample. Seven alternating samples after warmup measured a median of 32.719 ms
before and 0.881 ms after indexing. Every lookup returned the exact installed surface geometry for
its body. This measures CPU lookup work only, excluding scene construction, edge-worker completion,
WebGL drawing and total selection latency.

Snapshot dependency-graph construction also reuses its validated records and collected edges while
deriving legacy History and assembling the graph. On synthetic 2,000-node fixtures, seven alternating
samples measured 12.008 to 7.492 ms for independent nodes and 11.880 to 6.900 ms for a dependency
chain. Node records, relations, History, evaluation order and adjacency results matched. This is
graph-preparation evidence, not complete preview or kernel latency. Full document validation and
the existing conservative preview scoping rules remain in place.

## October 24 camera and saved-copy follow-up

Camera-only updates reuse the viewport's world-space scene bounds and installed material clipping.
Ordinary scene render requests conservatively invalidate both preparations, including geometry,
visibility, selection, sketch, decoration, theme, and asynchronous mesh updates. Section decoration
and finite translation handles retain per-frame bounds because their extent depends on camera zoom.
Camera-space depth, near/far planes, and camera retreat still update every frame.

On a synthetic mock-renderer fixture with 500 bodies, 200 sketches, and 120 camera changes, bounds
expansions fell from 145,920 to zero and clipping traversal visits from 145,560 to zero after initial
preparation. All recorded camera positions, clipping depths, and projection matrices were exactly
equal. Single-run fixture time was 54.714 ms before and 13.499 ms after. This verifies avoided CPU
work, not full-app Radial frame rate or GPU performance. Scene-mutation frames still scan the scene.

Saved-project duplication now recovers the source and prepares its independent history in the same
disposable worker as native import. Only database/revision and target-copy metadata cross into that
worker; final repository validation and publication remain on the main thread. A one-off Bun 1.4.3
fixture with 2,001 history events measured timer delay of 110.68 ms for synchronous history-copy
preparation and 1.14 ms for the shared worker preparation phase. Completion was 110.66 ms versus
120.00 ms, with equal resulting snapshots. Worker startup, archive decoding, IndexedDB recovery,
and final publication were outside that timed phase. This is responsiveness evidence, not a total
duplication-time budget.

## October 24 asynchronous preparation

An additional main-thread audit identified section-fill construction, native-file import preparation,
motion PNG archive compression, and an unnecessary Undo publication-budget serialization.

- Section contour extraction and triangulation now run in a lazy viewer worker. Mesh data is copied
  once per source generation; plane changes replace one queued request rather than growing a queue.
  Replaced, disabled, and disposed sections cannot install stale fills. Plane/gizmo interaction and
  WebGL rendering stay on the UI thread.
- Native `.vshape` decoding, complete-history verification, and writable-copy preparation run in a
  disposable worker. Repository validation and atomic publication retain the existing current-action
  checks; no file-format or project authority changes.
- Motion PNG sequences retain the existing renderer, frame order, fixed camera, and 64-frame limit.
  Final ZIP compression runs in a disposable worker with cancellation and transferred frame buffers.
- Undo publication serializes a proposed document for its byte budget only when an active,
  unsealed, actor-owned checkpoint can constrain that publication. Exact UTF-16 limits remain intact.

A one-off synthetic Bun 1.4.3 run packaged 64 deterministic incompressible frame buffers of 88 KiB
each. The synchronous path delayed a scheduled timer by 94.09 ms and finished in 94.06 ms; the worker
path delayed it by 1.16 ms and finished in 99.55 ms. Both archives contained 5,775,240 bytes. This is
event-loop responsiveness evidence for packaging, not a browser frame-rate or Radial engine latency
measurement. Worker startup adds latency and memory; the purpose is to keep the UI available.

A separate Chromium smoke used a closed sphere with 65,024 triangles. Cold synchronous extraction
took 48.2 ms; worker dispatch took 0.7 ms, with initial completion after 197.4 ms while 14 frames
advanced. A 101-update burst returned in 1.1 ms and submitted only the active and final plane, without
retransferring geometry. These are illustrative fixture observations, not an application-wide FPS
claim. Native-worker checks also returned exactly equal cap buffers for that fixture.

CAD evaluation, solver work, tessellation, exact exchange exports, planar parsing, crease edges,
and large-body BVH construction already have worker owners. Cheap scalar checks, immediate camera
updates, revision/lease checks, and atomic publication ordering remain synchronous. This change does
not introduce blanket Promise wrappers, adaptive DPR, OffscreenCanvas, or an overall FPS claim.

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

## October 23 context-menu picking

Dense model surfaces now receive an indirect `three-mesh-bvh` index from the existing viewer
preparation worker. Bodies below 10,000 triangles retain ordinary Three.js raycasting. The worker
uses copied model buffers, preserves original triangle order, and transfers the index with its crease
edges. Preview surfaces and edge-only historical highlights do not request an index. Until completion, or on preparation failure, surfaces use stock picking. Each surface installs
its own accelerated raycast; no global Three.js prototype is patched. All-hit selection, stock triangle tie-breaking at exact seams/corners and section
filtering remain available, and replaced or disposed bodies cannot receive a stale index.

A local Chromium headless probe on macOS arm64, Bun 1.4.3 and Three.js 0.185.1 exercised the production
`ModelMeshPresentation`, real module worker and raycast path. A synthetic torus knot used 16 radial
segments and 10,000 or 40,000 tubular segments. Eleven fixed parallel rays were sampled after one
warmup, before and after preparation on the same surface. Triangle indices and distances matched.

| Display triangles | Stock median per ray | Indexed range per ray | Index memory | Worker completion elapsed |
| --- | --- | --- | --- | --- |
| 320,000 | 8.2 ms | 0–0.1 ms | 4,021,536 bytes | 614 ms |
| 1,280,000 | 32.7 ms | 0–0.1 ms | 16,038,368 bytes | 2,523 ms |

Browser timer resolution rounds some indexed samples to zero; these are not zero-cost operations.
Completion elapsed includes crease-edge generation, worker startup, transfers and the intervening
baseline picks. Index construction itself is off the UI thread. Initial surface publication took
4.4 and 10.1 ms respectively. The index adds memory proportional to mesh size and is released with
its owning surface. These synthetic ray timings exclude menu mounting, React updates, GPU drawing
and exact geometry work; they do not establish end-to-end right-click latency on a user's project.

Repeated equivalent face selection also preserves the editor-session state and its subscribers,
including the face ordinal. Competing edge/body/part/tree selections still clear, and tool-specific
viewport callbacks still run. Explicit face picks skip empty edge-clear callbacks, preventing the
application from clearing and republishing an unchanged face. Source-owned icons retain their immutable
per-instance JSX artwork across host updates while preserving instance-local gradient/mask IDs and
dynamic sizing, props, refs, children and CSS theme tokens. The first selection of a different face continues to update commands
and the shell normally. No document, persistence or MCP operator contract changes.

Regression coverage checks native worker transfers, all-hit and clipped picking equivalence,
triangle-to-face identity after equal-buffer replacement, malformed output bounds, superseded-body
completion, index disposal, and redundant selection notifications. Local probe inputs and raw samples
are retained under `artifacts/slow-part-context-click/` and are not distributed application data.

A separate development-mode Chromium comparison opened the same 20 mm box menu eight times, after
waiting one second for initial background work. The baseline intercepted only the selection action,
empty edge-clear callback and icon-artwork calculation to restore their prior implementations; the
model, Vite server, menu, browser settings and profiler were otherwise the same. The baseline and final
runs were serial and used fresh contexts. First-open DOM latency was 121.2 → 96.2 ms. The seven repeated
openings had overlapping ranges, 36.8–102.1 → 41.1–52.2 ms; median DOM latency did not improve
(40.9 → 50.6 ms), while the observed slowest repeat decreased. Median time to the second animation frame
after insertion was 96.8 → 70.4 ms. That frame timestamp is a paint proxy, not an input-to-photon
measurement. These small development-mode samples establish reduced redundant work and a narrower
observed tail, not a production latency guarantee or a uniform speedup on small parts.
