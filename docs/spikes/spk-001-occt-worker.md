# SPK-001 — OCCT/Replicad worker evidence

- Status: **Pass — Phase 0 stop/go gate cleared**
- Reviewed: 2026-08-08
- Adapter builds: published `spike-2`; controlled evidence `spike-controlled-1`

## Decision

The controlled OCCT path is viable for browser-based exact modeling, transient operation-history capture, tessellation, STEP round-trip, binary STL export, deterministic native ownership, bounded repeated execution, and the declared local performance budget inside a Web Worker.

Six earlier blockers are closed:

1. The project now builds the pinned OpenCascade.js and OCCT revisions from verified source archives, applies a reviewed generator correction, and compares an unpatched source build with the immutable registry baseline before accepting the patched artifact.
2. Boolean and fillet builders expose the documented modified, generated, and deleted relations needed as inputs to the SPK-003 stable-reference experiment. The worker captures aggregate evidence after boolean result simplification without persisting transient OCCT identities.
3. Allocator-instrumented evidence now reaches a measured plateau. The seven-operation matrix retains zero bytes inside every 1,000-operation lifecycle block, and post-disposal live allocation drifts by 448 bytes across four full batches after warmup.
4. Twenty cold workers on the declared Apple M1 baseline reach a 178.5 ms initialization p95 and 278.8 ms complete-fixture p95. No main-thread long task was observed, and both peak WASM capacity and live native allocation remain below their executable ceilings.
5. A verified local corresponding-source bundle preserves the exact source archives, reviewed modification, build recipe, evidence, output files and hashes, license texts, notices, and replacement instructions for the controlled candidate.
6. A controlled browser export is transferred as raw STEP bytes and imported by headless FreeCAD 1.1.3 as one valid solid. Its volume and bounds match the producer within executable tolerances.

SPK-001 passes its Phase 0 stop/go gate. The controlled artifact remains quarantined rather than becoming the production dependency automatically. Production-facade comparison, extended target-browser and format cases, and release legal review remain promotion work rather than unresolved spike evidence. SPK-003 still owns semantic output roles, stable `TopoRef` resolution, and ambiguity behavior. Replicad and OCCT types remain inside the geometry adapter boundary.

## Implemented boundary

The spike provides:

- a strict Zod protocol with protocol version, request ID, document ID, revision, and generation;
- runtime validation on both sides of the worker boundary;
- aggregate transient boolean and fillet history statistics in protocol v4;
- sequential dispatch, logical cancellation, and stale-generation rejection;
- transferable positions, normals, indices, triangle-to-face IDs, and exported STEP bytes;
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
7. invariant measurement of the OCCT-round-tripped shape;
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

This single functional sample is not used for the performance decision. The controlled benchmark below owns the p95 evidence.

## Operation-history evidence

Protocol v4 reports aggregate history statistics by source topology type and transfers the generated STEP file without copying it through JSON evidence. This proves that the required OCCT relation APIs are available through the pinned bindings and can be queried across the worker boundary; it intentionally does not expose native handles or treat transient topology hashes as persistent identity.

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

## Controlled performance evidence

`bun run occt:evidence:performance` uses a dedicated Chromium Playwright configuration that refuses to run when `CI` is set. It executes 10 sequential page runs and creates two fresh geometry workers per page, producing 20 raw worker samples against the locally staged controlled artifact. Every worker performs the complete primitive, boolean, fillet, validation, tessellation, STEP export/import, STL export, one-iteration lifecycle, disposal, and invariant path.

The declared baseline is:

| Property | Value |
|---|---|
| CPU | Apple M1, 8 logical cores |
| Memory | 16 GiB |
| OS | macOS, Darwin 25.5.0, arm64 |
| Browser | Chromium 151.0.7922.34 |
| Asset state | Local Vite server; warm HTTP asset cache; fresh worker and WASM instance per sample |

The measured result was:

| Metric | Budget | Result |
|---|---:|---:|
| Worker initialization p95 | 500 ms | 178.5 ms |
| Complete fixture p95 | 500 ms | 278.8 ms |
| Main-thread longest task | 100 ms | 0 observed |
| Peak WASM linear-memory capacity | 64 MiB | 20,185,088 bytes |
| Peak live native allocation | 4 MiB | 921,832 bytes |

The initialization range was 166.1–189.9 ms. Complete fixture samples ranged from 260.6–295.1 ms. Chromium reported support for `longtask` entries and observed none across the 10 page runs. The harness writes raw samples, exact upstream revisions, safe hardware characteristics, budgets, and summaries to `.artifacts/occt-build/geometry-worker-performance-evidence.json` before asserting the ceilings.

This result closes the SPK-001 controlled worker budget on the declared machine. It does not claim universal device performance, production PWA cold-network loading, viewport performance, or feature-corpus rebuild performance; those receive separate baselines when their product paths exist.

## Corresponding-source bundle evidence

`bun run occt:bundle:compliance` assembles a local archive from the already staged controlled build and rejects any environment where `CI` is set. `bun run occt:verify:compliance` independently validates its strict Zod manifest, complete file inventory, payload sizes and hashes, checksum file, and exact pinned source provenance.

The verified bundle contains:

- all five checksum-verified source archives that underpin the build and its configuration;
- the Docker build context, 262-binding allowlist, generator, controlled configuration, and VibeShape build scripts;
- the exact OpenCascade.js destructor patch and the corrected file it produces;
- build, source-baseline, and builder-context evidence;
- the paired controlled package and the raw JavaScript, WebAssembly, and TypeScript declaration outputs;
- OCCT, OpenCascade.js, Replicad build-configuration, RapidJSON, FreeType, and VibeShape license texts;
- third-party notices, replacement instructions, `manifest.json`, and `SHA256SUMS`.

The current payload inventory covers **38 files** and **88,067,680 bytes**; the verifier covers **40 files** after including `manifest.json` and `SHA256SUMS`. The outer uncompressed tar is not claimed to be byte-reproducible; the manifest and checksums define the verified payload contract. The generator also applies the recorded patch to the pinned upstream `bindings.py` in a temporary directory and requires the result to match the controlled builder input, preventing a decorative or drifting modification record.

This closes the SPK-001 technical release-bundle gate. It does not establish provenance for the separate published `replicad-opencascadejs@0.23.0` feasibility artifact, replace the complete VibeShape release notice/SBOM, or constitute legal advice. A public binary or WASM release still requires the repository release checklist and formal legal review.

## Independent STEP application evidence

`bun run occt:evidence:step` refuses to run when `CI` is set. It starts the controlled Vite mode, executes the complete fixture in Chromium, transfers the exact generated STEP bytes from the worker, records a producer report, and invokes a locally installed headless FreeCAD command with an isolated configuration file. The Python validator imports the file through `Part.Shape.read`, hashes the exact input, measures the imported shape, and writes a strict report that is parsed with Zod before the command can pass.

The local result was:

| Measurement | Producer | FreeCAD 1.1.3 | Tolerance |
|---|---:|---:|---:|
| STEP bytes | 35,650 | 35,650 | Exact |
| Valid solid count | 1 | 1 | Exact |
| Volume | 43,858.197429252046 mm³ | 43,858.19742925233 mm³ | Relative error ≤ `1e-8` |
| Bounds | `(-30.0000001, -20.0000001, -0.0000001)` to `(30.0000001, 20.0000001, 20.0000001)` mm | `(-30, -20, 0)` to `(30, 20, 20)` mm | Maximum delta ≤ `1e-5` mm |
| Faces / edges | 12 / 25 | 12 / 25 | Informational |

The measured relative volume error was `6.47e-15`, and the maximum bounds delta was approximately `1.0e-7` mm. The STEP digest is checked within each run but is not documented as a stable artifact identity because the writer includes a generation timestamp in the file header.

This closes the independent-application interoperability gate: a separate installed application and import path consume the browser output successfully. FreeCAD also uses OCCT internally, so this result does **not** establish kernel-diversity interoperability. A broader AP242/AP214, units, multi-body, metadata, malformed-file, and alternative-kernel corpus remains production format work.

## Browser and CI policy

The fast fixture passes in Chromium, Firefox, and WebKit. The extended allocator matrix is Chromium-only because it consumes a locally staged controlled package and is intended for targeted native evidence, not every pull request.

Heavy OCCT image builds, extended memory matrices, stable performance evidence, independent FreeCAD STEP evidence, and corresponding-source bundle generation are local-only and have no GitHub Actions workflow. Their entry points reject `CI`; pull requests cannot consume Actions minutes for these workloads, and the ordinary verification workflow does not rerun the squash-merged tree on `main`. Generated sources, images, packages, bundles, reports, and Playwright JSON remain under `.artifacts` and are not committed.

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
- `scripts/run-occt-performance-evidence.test.ts` for the local-only controlled performance contract;
- `scripts/step-interoperability.test.ts` for controlled producer provenance, strict report schemas, FreeCAD command resolution, and the local-only contract;
- `scripts/verify-step-with-freecad.py` for exact input verification and independent-application shape measurement;
- `scripts/occt-compliance-bundle.test.ts` for strict manifest paths, duplicate rejection, and the local-only generation contract;
- `tests/e2e/geometry-worker.spec.ts` for real worker, WASM, geometry, exchange, plateau, restart, and disposal behavior.
- `tests/performance/occt-performance.spec.ts` for p95 worker initialization, complete-fixture latency, main-thread long tasks, peak WASM capacity, and peak live allocation.

## Remaining production-promotion work

- Compare the controlled direct boundary with Replicad on maintainability and the operation surface needed by production features, including the durable history records required by SPK-003.
- Repeat the required extended format and lifecycle corpus across target browsers and independent kernels where practical.

ADR-0001 remains **Accepted for spike** until the production facade is selected. The SPK-001 stop/go result itself is **Pass** and no longer blocks SPK-002, SPK-003, or SPK-004 work.
