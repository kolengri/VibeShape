# SPK-001 — OCCT/Replicad worker evidence

- Status: **Rework**
- Reviewed: 2026-08-08
- Adapter build: `spike-2`

## Decision

The Replicad path is functionally viable for browser-based exact modeling, tessellation, STEP round-trip, and binary STL export inside a Web Worker. It is **not yet accepted as the production geometry adapter**.

Two release-critical gates remain open:

1. The published `replicad-opencascadejs` package does not identify the exact OCCT source revision used to build its WASM artifact. VibeShape therefore cannot yet reproduce the artifact or satisfy its planned corresponding-source release process.
2. The stress harness proves wrapper cleanup but cannot prove allocator cleanup. Across five consecutive 1,000-operation batches, the Emscripten heap capacity grew from 20,185,088 bytes to 260,243,456 bytes. Emscripten does not shrink its linear memory, and the published binding does not expose live allocator bytes, so this result cannot distinguish a retained high-water mark from a native leak.

Continue SPK-001 by executing and validating the prepared project-controlled OpenCascade.js build, then run its allocator instrumentation against the same fixture. Do not spread Replicad types outside the adapter or begin topology-dependent production features yet.

The rework now has two additional pieces of executable evidence:

- protocol v2 captures ordered Emscripten heap checkpoints after every modeling, tessellation, exchange, lifecycle, and final shape-disposal stage and accepts allocator metrics only from a complete validated binding;
- the browser harness terminates the first worker, initializes a fresh worker, rebuilds the same invariant fixture, and disposes it successfully in Chromium, Firefox, and WebKit.

The controlled-build harness pins and verifies the OpenCascade.js, OCCT, and Replicad source archives plus the builder image digest and derives the allocator-instrumented build config deterministically. Docker is unavailable on the current development host, so no controlled WASM output is claimed yet.

## Implemented boundary

The spike adds:

- a strict Zod protocol with protocol version, request ID, document ID, revision, and generation on every message;
- runtime request and response validation on both sides of the worker boundary;
- sequential kernel operation dispatch;
- logical cancellation and stale-generation rejection;
- typed progress and failure diagnostics;
- transferable mesh buffers for positions, normals, indices, and triangle-to-face IDs;
- explicit adapter-owned shape registration and deterministic deletion;
- health and document-disposal messages;
- a browser harness at `/spikes/geometry-worker.html`;
- deterministic Vitest protocol/runtime coverage and Playwright browser coverage.
- stage-isolated heap-capacity evidence with nullable allocator-level metrics;
- hard worker restart, engine reinitialization, invariant rebuild, and disposal evidence;
- a source-checksum and controlled-build preparation harness under `native/occt`.

The protocol is spike-specific. Production document commands such as preview, commit, rebuild, import, and export remain future schema work.

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
| Extended lifecycle batch | 1,000 |

The worker performs:

1. centered box creation;
2. cylinder creation and boolean cut;
3. top-plane edge selection and fillet;
4. `BRepCheck_Analyzer` validation and invariant measurement;
5. tessellation to transferable typed arrays;
6. STEP export;
7. STEP reimport and invariant comparison;
8. binary STL export;
9. repeated create, cut, and deterministic disposal;
10. final cleanup and health reporting.

The fillet selection proves the required operation, but it is not a production `TopoRef` solution. SPK-003 still owns stable semantic topology references and operation-history evaluation.

## Pinned inputs and provenance

| Input | Version or identity | Evidence | Release assessment |
|---|---|---|---|
| Replicad | `0.23.1`; npm `gitHead` `45b9b8b7c594cd5dc38617edaf220ab4cd72778f` | Exact catalog pin and `bun.lock` integrity | MIT package provenance is adequate |
| Replicad custom OCJS package | `0.23.0`; npm `gitHead` `19fb8212e0bb12a07a7a49f96950f8903903d469` | Exact catalog pin and `bun.lock` integrity | Loader/package provenance is known |
| Embedded OCCT source | Unknown | The published metadata and runtime do not expose it | **Blocking** for reproducibility and LGPL source delivery |
| Runtime schema | Zod `4.4.3` | Exact catalog pin and `bun.lock` integrity | MIT; accepted for the protocol boundary |
| Toolchain | Bun `1.3.14`, Vite `8.2.1`, Playwright `1.62.1` | Root pins and lockfile | Accepted for the spike |

Prepared controlled-build inputs:

| Input | Exact identity | Verification |
|---|---|---|
| OpenCascade.js source | `5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7` | GitHub archive SHA-256 `7107d5a36712542997895efa17b44ea0e2b956c3908cbe98b7d95c194f1e556f` |
| OCCT source | `bb368e271e24f63078129283148ce83db6b9670a` | Official GitHub archive SHA-256 `fabda9f139f2c09e675d5b9717110175b0ad5d9fb09187e3d56687220d2687e6` |
| Replicad build config | `19fb8212e0bb12a07a7a49f96950f8903903d469` | GitHub archive SHA-256 `83a9fd99e39b77d7128270e08764cafd334117fbd0d083792b3a49aaa181787f` |
| OpenCascade.js builder image | `linux/amd64` | Registry digest `sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d` |

`bun run occt:prepare` downloaded and verified all three archives and generated the instrumented config successfully. The image is immutable, but relying on the registry image alone is not the final release reproducibility standard; the image must later be rebuilt from archived sources and compared.

The npm package declares `replicad-opencascadejs` as MIT. That declaration covers the package wrapper and does not erase the LGPL obligations of the embedded OCCT-derived WASM. The runtime reports `opencascadeSourceRevision: null` deliberately; a guessed value would be false provenance.

## Payload size

Measured from `replicad_single.wasm` with the exact locked package:

| Encoding | Bytes | MiB |
|---|---:|---:|
| Raw | 10,855,736 | 10.35 |
| gzip level 9 | 4,535,371 | 4.33 |
| Brotli quality 11 | 3,382,379 | 3.23 |

These numbers cover the WASM file only. They do not include the Replicad JavaScript, application code, HTTP headers, cache behavior, or source-compliance artifacts. A production custom build must repeat this measurement from a clean reproducible build.

## Functional result

One warm local Chromium sample on an Apple M1 MacBook Pro with 16 GB memory produced:

| Measurement | Result |
|---|---:|
| Engine initialization | 105.8 ms |
| Complete modeled scenario | 328.4 ms |
| Valid solids | 1 |
| Volume | 43,858.197429 mm³ |
| Surface area | 9,241.790019 mm² |
| Faces / edges | 12 / 25 |
| Mesh vertices / triangles | 5,057 / 8,912 |
| STEP bytes | 36,290 |
| Binary STL bytes | 445,684 |
| STEP relative volume error | `4.811e-15` |

The measured bounds differ from `(-30, -20, 0)` to `(30, 20, 20)` by approximately `1e-7`, which is expected kernel tolerance behavior. Tests compare numeric geometry within tolerance and never depend on byte equality, topology order, or exact triangle order.

This is a development-server sample, not a stable performance benchmark. It does not establish cold network startup, p95 performance, peak resident memory, or main-thread responsiveness on controlled hardware.

## Browser matrix

The default three-iteration scenario passed through Playwright in:

| Engine | Playwright browser version | Result | Observed test duration |
|---|---:|---|---:|
| Chromium | 151.0.7922.34 | Pass | 1.1 s |
| Firefox | 153.0 | Pass | 3.1 s |
| WebKit | 26.5 | Pass | 1.7 s |

The duration includes page and harness overhead and is not a kernel-only benchmark. Automated WebKit does not replace the required manual Safari release smoke test.

## Lifetime evidence

The fast browser gate checks three create/cut/dispose iterations in every Playwright engine. The extended Chromium command is:

```bash
VIBESHAPE_GEOMETRY_LIFECYCLE_ITERATIONS=1000 \
VIBESHAPE_GEOMETRY_LIFECYCLE_BATCHES=5 \
bun run test:e2e -- --project=chromium tests/e2e/geometry-worker.spec.ts
```

Five batches passed 5,000 total lifecycle iterations in one worker. Adapter-owned shape counts returned from 2 to 2 inside every batch and to 0 after the completed request. WASM heap capacity behaved as follows:

| Batch | Before | After | Growth |
|---:|---:|---:|---:|
| 1 | 20,185,088 | 150,536,192 | 130,351,104 |
| 2 | 150,536,192 | 180,682,752 | 30,146,560 |
| 3 | 180,682,752 | 216,858,624 | 36,175,872 |
| 4 | 216,858,624 | 216,858,624 | 0 |
| 5 | 260,243,456 | 260,243,456 | 0 |

The gap between batch 4 after-state and batch 5 before-state occurred during the next full model, tessellation, and STEP round-trip before the lifecycle subtest. Total linear-memory capacity still rose by 240,058,368 bytes from the first observed baseline. This is unexplained growth and fails the current stop/go memory criterion even though wrapper ownership is balanced.

### Stage and restart evidence

A warm Chromium protocol-v2 sample with three lifecycle iterations produced:

| Checkpoint | Heap capacity |
|---|---:|
| Initialized through validation | 16,777,216 bytes |
| After tessellation | 20,185,088 bytes |
| STEP export/import, STL export, lifecycle, and final shape disposal | 20,185,088 bytes |
| Fresh worker immediately after reinitialization | 16,777,216 bytes |

This sample locates the first capacity growth in tessellation and confirms that final shape disposal does not shrink linear memory, which is expected with Emscripten memory growth. It does **not** prove that tessellation leaks: the published binding still reports `heap-capacity-only`, and all allocator values remain `null`.

After terminating the first worker, the fresh worker returned to the 16,777,216-byte baseline, rebuilt the same valid solid with matching volume, ran a one-iteration ownership check, and disposed to zero owned shapes. This validates the hard restart path at the spike level; production document restoration still depends on committed snapshot work from the persistence phase.

Required follow-up:

- expose `mallinfo2` or equivalent allocated/live byte metrics in a controlled binding;
- record peak and steady-state bytes separately from linear-memory capacity;
- isolate primitive, boolean, fillet, mesh, STEP writer, and STEP reader loops to locate growth;
- repeat batches until a numeric plateau is established or a leak is fixed;
- test worker termination and document recovery as the hard memory-release path;
- define an accepted steady-state and per-document budget through benchmark evidence.

## Verification

The executable evidence is owned by:

- `packages/protocol/src/geometry-worker.test.ts` for schema and structured-clone payload validation;
- `packages/geometry-worker/src/runtime.test.ts` for invalid input, initialization, transfer lists, cancellation, and stale generations;
- `packages/geometry-worker/src/memory-profile.test.ts` for missing, complete, malformed, and invalid allocator bindings;
- `scripts/occt-build-config.test.ts` for deterministic config instrumentation and upstream-anchor drift;
- `tests/e2e/geometry-worker.spec.ts` for real worker, WASM, modeling, exchange, invariant, progress, lifetime, and disposal behavior.

Playwright attaches a compact JSON evidence record to the HTML report for each browser run. Failure artifacts remain under `.artifacts/playwright` and are not committed.

## Remaining stop/go work

- Execute the prepared controlled OpenCascade.js build on a Docker-capable host and verify its generated report.
- Rebuild the pinned builder image from archived sources, compare it with the registry-pinned build, and publish the final build instructions.
- Add allocator-level memory instrumentation and close the unexplained-growth result.
- Compare the controlled direct binding with Replicad on API coverage, size, speed, and maintainability.
- Verify operation history needed by SPK-003.
- Open exported STEP independently in FreeCAD or another reader.
- Measure cold startup, main-thread long tasks, p95 operations, and memory on a declared baseline device.
- Repeat the extended lifecycle and format matrix across target browsers where practical.

Until those items pass, ADR-0001 remains **Accepted for spike** rather than accepted for production.
