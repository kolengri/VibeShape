# SPK-001 — OCCT/Replicad worker evidence

- Status: **Rework — source build, history API, and memory gates passed**
- Reviewed: 2026-08-08
- Adapter builds: published `spike-2`; controlled evidence `spike-controlled-1`

## Decision

The controlled OCCT path is viable for browser-based exact modeling, transient operation-history capture, tessellation, STEP round-trip, binary STL export, deterministic native ownership, and bounded repeated execution inside a Web Worker.

Three earlier blockers are closed:

1. The project now builds the pinned OpenCascade.js and OCCT revisions from verified source archives, applies a reviewed generator correction, and compares an unpatched source build with the immutable registry baseline before accepting the patched artifact.
2. Boolean and fillet builders expose the documented modified, generated, and deleted relations needed as inputs to the SPK-003 stable-reference experiment. The worker captures aggregate evidence after boolean result simplification without persisting transient OCCT identities.
3. Allocator-instrumented evidence now reaches a measured plateau. The seven-operation matrix retains zero bytes inside every 1,000-operation lifecycle block, and post-disposal live allocation drifts by 448 bytes across four full batches after warmup.

The controlled artifact remains quarantined and SPK-001 remains **Rework**, not production acceptance. The remaining stop/go work is independent STEP validation, declared cold-start and long-task budgets, and the release compliance bundle. SPK-003 still owns semantic output roles, stable `TopoRef` resolution, and ambiguity behavior. Replicad and OCCT types remain inside the geometry adapter boundary.

## Implemented boundary

The spike provides:

- a strict Zod protocol with protocol version, request ID, document ID, revision, and generation;
- runtime validation on both sides of the worker boundary;
- aggregate transient boolean and fillet history statistics in protocol v3;
- sequential dispatch, logical cancellation, and stale-generation rejection;
- transferable positions, normals, indices, and triangle-to-face IDs;
- progress and structured failure diagnostics;
- adapter-owned shape registration, health, and document disposal;
- ordered heap-capacity and allocator checkpoints;
- hard worker restart and cold-baseline verification;
- direct native lifecycle and allocator-purge diagnostics;
- a source-built controlled package selected only by Vite's `controlled-occt` mode;
- deterministic Vitest and Playwright coverage.

The protocol is spike-specific. Production preview, commit, rebuild, import, export, and recovery commands remain future schema work.

## Fixture and operations

The deterministic fixture uses millimeters:

| Parameter | Value |
|---|---:|
| Box | 60 × 40 × 20 |
| Through cylinder | radius 8, height 30, origin `(0, 0, -5)` |
| Top-edge fillet | radius 1.5 |
| Mesh linear tolerance | 0.05 |
| Mesh angular tolerance | 0.1 radians |
| Fast PR lifecycle count | 3 |
| Controlled lifecycle batch | 1,000 |
| Controlled full batches | 5 |

The worker performs:

1. centered box creation;
2. cylinder creation, boolean cut, and post-simplification history capture;
3. top-plane edge selection, fillet, and documented history capture;
4. validity, volume, surface, bounds, face, edge, and solid measurement;
5. tessellation to transferable typed arrays;
6. STEP export and reimport;
7. independent invariant measurement of the imported shape;
8. binary STL export;
9. repeated lifecycle operations and deterministic disposal;
10. final cleanup, worker restart, invariant rebuild, and health reporting.

The fixture does not solve stable topological naming. SPK-003 still owns semantic topology references, geometric signatures, relation selection, and ambiguity handling.

## Pinned inputs and provenance

Published feasibility dependencies:

| Input | Version or identity | Assessment |
|---|---|---|
| Replicad | `0.23.1`; npm `gitHead` `45b9b8b7c594cd5dc38617edaf220ab4cd72778f` | MIT package, retained behind the adapter |
| Replicad OpenCascade.js package | `0.23.0`; npm `gitHead` `19fb8212e0bb12a07a7a49f96950f8903903d469` | Published wrapper does not disclose the embedded OCCT revision |
| Runtime schema | Zod `4.4.3` | Exact catalog pin and lockfile integrity |

Controlled source-build inputs:

| Input | Exact identity | Verification |
|---|---|---|
| OpenCascade.js | `5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7` | SHA-256 `7107d5a36712542997895efa17b44ea0e2b956c3908cbe98b7d95c194f1e556f` |
| OCCT | `bb368e271e24f63078129283148ce83db6b9670a` | SHA-256 `fabda9f139f2c09e675d5b9717110175b0ad5d9fb09187e3d56687220d2687e6` |
| Replicad build config | `19fb8212e0bb12a07a7a49f96950f8903903d469` | SHA-256 `83a9fd99e39b77d7128270e08764cafd334117fbd0d083792b3a49aaa181787f` |
| RapidJSON | `v1.1.0` | SHA-256 `bf7ced29704a1e696fbccf2a2b4ea068e7774fa37f6d7dd4039d0787f8bed98e` |
| FreeType | `VER-2-13-0` | SHA-256 `a683f1091aee95d2deaca9292d976f87415610b8ae1ea186abeebcb08e83ab12` |
| Emscripten SDK image | `linux/amd64` | Digest `sha256:4c3e0a0dac61430b719e82118ae9b2c7480902a2713267e80fa296d39f7ab921` |
| Registry comparison builder | `linux/amd64` | Digest `sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d` |

The builder generates the 262 bindings selected by the reviewed Replicad configuration. The unpatched source image and patched image share the same compiled OCCT source objects; only the generated binding destructor policy differs.

## Source reproduction contract

The unpatched source build must match the registry baseline through:

- exact JavaScript bytes and SHA-256;
- exact TypeScript declaration bytes and SHA-256;
- equal output dimensions;
- identical sorted WebAssembly imports and exports.

Repeated upstream links are not bit-reproducible: the registry builder can produce different WASM hashes for the same inputs while preserving dimensions and the runtime interface. The harness records every hash but deliberately uses the structural contract instead of a false static-WASM-hash assertion.

The locally verified patched output is:

| Output | Bytes | SHA-256 |
|---|---:|---|
| `vibeshape_occt.js` | 135,503 | `32a41bedb97df18af4c7fd8f57b32418315af1620eae42730cd98b3a14e7adf6` |
| `vibeshape_occt.wasm` | 10,856,959 | `7195d6866a895c6648bba4dc04e8b49edb76f52d531b29972343c3c076ff36dd` |
| `vibeshape_occt.d.ts` | 410,813 | `82bf07aa9cb20b2a241e34525de89880b20ee97fb3c4f0ffbe566a6082e46ab5` |

The corrected WASM is 90 bytes larger than the paired unpatched source output. JavaScript and declarations remain exact, and the WebAssembly interface remains unchanged.

## Destructor correction and ownership model

The pinned OpenCascade.js generator emitted a no-op `raw_destructor<T>` whenever a class declared two-argument placement delete. OCCT's `DEFINE_STANDARD_ALLOC` declares placement delete together with a usable public ordinary delete, so generated `.delete()` calls invalidated JS handles without running the native destructor.

The reviewed correction suppresses destruction only when ordinary deletion is unavailable. Generator fixtures cover public, non-public, ordinary, and placement-delete combinations. Direct Embind primitive loops return to their pre-loop live allocation with the patched package.

Replicad 0.23.1 also routes several high-level operations through `FinalizationRegistry`-based scopes that do not deterministically delete temporary bindings at function return. VibeShape therefore owns the critical adapter path:

- primitives, boolean cut, and fillet use explicit OCCT builders and `try/finally`;
- tessellation explicitly deletes owned mesh, explorer, face, location, transform, node, normal, connectivity, and triangle wrappers;
- STL export consumes the existing triangulation and calls `BRepTools.Clean` immediately afterward;
- STEP import calls `ClearShapes`, and STEP export resets its writer model;
- topology counts use direct explorers and delete every raw current shape.
- history capture deletes every explorer, current-shape, and returned list wrapper before the builder is released.

Replicad remains the facade and type wrapper inside the adapter. The project-owned layer supplies deterministic native ownership where the upstream high-level scopes cannot.

## Functional result

One local controlled Chromium sample produced:

| Measurement | Result |
|---|---:|
| Engine initialization | 191.7 ms |
| Complete modeled scenario | 229.3 ms |
| Valid solids | 1 |
| Volume | 43,858.197429 mm³ |
| Surface area | 9,241.790019 mm² |
| Faces / edges | 12 / 25 |
| Mesh vertices / triangles | 5,043 / 8,898 |
| STEP bytes | 35,650 |
| Binary STL bytes | 444,984 |
| STEP relative volume error | `6.47e-15` |

Bounds remain within approximately `1e-7` of `(-30, -20, 0)` to `(30, 20, 20)`, which is expected kernel-tolerance behavior. Tests never depend on topology order, exact triangle order, or exchange-file byte equality.

This is a local development sample, not a p95 benchmark. Hardware, browser process state, AMD64 emulation during the separate build, and development-server overhead affect timings.

## Operation-history evidence

Protocol v3 reports aggregate history statistics by source topology type. This proves that the required OCCT relation APIs are available through the pinned bindings and can be queried across the worker boundary; it intentionally does not expose native handles or treat transient topology hashes as persistent identity.

The boolean adapter enables history collection, builds the cut, calls `SimplifyResult`, and only then reads the merged `Modified`, `Generated`, and `IsDeleted` relations for source vertices, edges, faces, and solids. The fillet adapter follows the narrower OCCT contract: it reads `Generated` for source vertices and edges, then `Modified` and `IsDeleted` for source faces.

One local controlled fixture produced:

| Operation and source topology | Sources | Modified relations | Generated relations | Deleted sources |
|---|---:|---:|---:|---:|
| Boolean vertices | 10 | 0 | 0 | 2 |
| Boolean edges | 15 | 1 | 2 | 2 |
| Boolean faces | 9 | 3 | 6 | 2 |
| Boolean solids | 2 | 1 | 0 | 1 |
| Fillet vertices | 10 | 0 | 0 | 0 |
| Fillet edges | 15 | 0 | 5 | 0 |
| Fillet faces | 7 | 6 | 0 | 0 |

Tests require internally consistent counts and meaningful relation families, not exact ordering or a frozen topology count. `HashCode` is used only to deduplicate explorer occurrences inside one evaluation. Turning these transient relationships into durable semantic references is explicitly deferred to SPK-003.

## Memory evidence

`heapCapacityBytes` is Emscripten's linear-memory high-water mark and does not shrink. The controlled build therefore exposes `mallinfo()` live allocation through `VibeShapeAllocatorStats`:

- `arenaBytes` — allocator-owned arena capacity;
- `allocatedBytes` — live allocated bytes;
- `freeBytes` — allocator-owned free bytes.

`bun run occt:evidence:memory` executes:

- seven operation scenarios with 5 × 1,000 lifecycle iterations each;
- four allocator-purge controls with 5 × 1,000 iterations each;
- full boolean, fillet, validation, tessellation, STEP, STL, disposal, and worker-restart checks in every scenario.

The representative post-disposal plateau was:

| Checkpoint | Live allocated bytes |
|---|---:|
| Cold initialized | 128,336 |
| Batch 1 disposed after warmup | 481,864 |
| Batch 2 disposed | 481,976 |
| Batch 3 disposed | 482,088 |
| Batch 4 disposed | 482,200 |
| Batch 5 disposed | 482,312 |

Post-warmup retained drift is **448 bytes** across four further complete batches. The executable ceiling is 64 KiB. Every isolated 1,000-operation lifecycle block records **0 bytes** of growth; its executable ceiling is 8 KiB.

The first full run creates stable STEP and OCCT process caches. Tessellation temporarily adds approximately 393 KiB, and `BRepTools.Clean` releases that attached triangulation after STL export. Final shape disposal releases approximately 47 KiB of exact-model and imported-shape state. Arena capacity can still grow while live allocation remains flat, so allocator capacity is not reported as a leak.

The purge control releases no additional cached blocks and does not change the plateau. A fresh worker returns to the exact cold allocator checkpoint, validating the hard-release fallback independently of the steady-state result.

## Browser and CI policy

The fast fixture passes in Chromium, Firefox, and WebKit. The extended allocator matrix is Chromium-only because it consumes a locally staged controlled package and is intended for targeted native evidence, not every pull request.

Heavy OCCT image builds and extended memory matrices are local-first. The `Controlled OCCT evidence` GitHub workflow is manual-only; pull requests and pushes do not consume Actions minutes for this workload. Generated sources, images, packages, reports, and Playwright JSON remain under `.artifacts` and are not committed.

## Verification ownership

Executable evidence is owned by:

- `packages/protocol/src/geometry-worker.test.ts` for schema and structured-clone validation;
- `packages/geometry-worker/src/runtime.test.ts` for dispatch, initialization, transfer, cancellation, and stale generations;
- `packages/geometry-worker/src/memory-profile.test.ts` for allocator-binding validation;
- `packages/geometry-worker/src/occt-diagnostics.test.ts` for native lifecycle and purge controls;
- `packages/geometry-worker/src/occt-history.test.ts` for relation-family selection, transient topology deduplication, and wrapper cleanup;
- `packages/geometry-worker/src/occt-shapes.test.ts` for primitive, boolean, and fillet ownership;
- `packages/geometry-worker/src/occt-mesh.test.ts` for tessellation and STL cleanup;
- `packages/geometry-worker/src/occt-exchange.test.ts` for STEP reader/writer ownership;
- `scripts/occt-build-config.test.ts` for deterministic instrumentation;
- `scripts/occt-builder-context.test.ts` for immutable builder context creation;
- `scripts/build-occt-source-builder.test.ts` for paired output-contract comparison;
- `scripts/run-occt-memory-evidence.test.ts` for the local matrix contract;
- `tests/e2e/geometry-worker.spec.ts` for real worker, WASM, geometry, exchange, plateau, restart, and disposal behavior.

## Remaining stop/go work

- Open the exported STEP fixture independently in FreeCAD or another implementation.
- Measure cold startup, main-thread long tasks, p95 operation latency, and peak memory on declared baseline hardware.
- Compare the controlled direct boundary with Replicad on maintainability and the operation surface needed by production features, including the durable history records required by SPK-003.
- Repeat the required extended format and lifecycle cases across target browsers where practical.
- Archive the exact source bundle, patch, build recipe, output manifest, license texts, notices, and replacement instructions for release.

Until those items pass, ADR-0001 remains **Accepted for spike** rather than accepted for production.
