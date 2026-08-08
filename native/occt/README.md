# Controlled OCCT WASM build

## Status

This is a **rework harness**, not the production geometry dependency. It prepares exact source archives, derives Replicad's reviewed binding list, adds allocator and lifecycle instrumentation, and can invoke one immutable OpenCascade.js builder image. It does not automatically replace the locked `replicad-opencascadejs` artifact.

The first successful build must still pass the complete SPK-001 geometry, exchange, browser, memory, and license gates before promotion. The upstream builder image is pinned by digest, but a later release build must also reproduce that image from archived sources rather than rely only on a registry artifact.

## Pinned inputs

| Input | Identity | SHA-256 or digest |
|---|---|---|
| OpenCascade.js source | `5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7` | `7107d5a36712542997895efa17b44ea0e2b956c3908cbe98b7d95c194f1e556f` |
| OCCT source | `bb368e271e24f63078129283148ce83db6b9670a` | `fabda9f139f2c09e675d5b9717110175b0ad5d9fb09187e3d56687220d2687e6` |
| Replicad build config | `19fb8212e0bb12a07a7a49f96950f8903903d469` | `83a9fd99e39b77d7128270e08764cafd334117fbd0d083792b3a49aaa181787f` |
| OpenCascade.js builder | `linux/amd64` | `sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d` |
| Emscripten in upstream Dockerfile | `3.1.14` | Included in the pinned builder; a source-built image remains required for release reproducibility |

The machine-readable constants live in `scripts/occt-build-config.ts`. Changing any identity, URL, checksum, platform, binding, compiler flag, or builder digest is a geometry dependency change and requires the full dependency audit and regression gate.

## Prepare sources and config

```bash
bun run occt:prepare
```

The command downloads the three official GitHub source archives, verifies every SHA-256 digest, extracts the exact Replicad single-threaded build config, and writes an instrumented config under `.artifacts/occt-build/input`.

The generated config:

- preserves the binding list used by `replicad-opencascadejs@0.23.0`;
- renames the artifact to `vibeshape_occt`;
- exposes `mallinfo()` arena, allocated, and free bytes through `VibeShapeAllocatorStats`;
- exposes native C++ scoped box/cylinder cycles and `Standard::Purge()` through `VibeShapeOcctDiagnostics`;
- fails when the reviewed upstream anchors change instead of applying an ambiguous patch.

## Build

Docker is required only for the build step:

```bash
bun run occt:build
```

The command runs the pinned `linux/amd64` image, using emulation where the local Docker installation supports it, then validates the JavaScript, WebAssembly, and TypeScript outputs and writes the generated-config and output SHA-256 digests to `.artifacts/occt-build/build-report.json`.

It also stages a private package under `.artifacts/occt-build/package`. The normal application build never consumes that directory. The `controlled-occt` Vite mode aliases only `replicad-opencascadejs` to the staged package so the existing adapter can run the controlled artifact without mutating `node_modules` or changing production dependency resolution.

The `Controlled OCCT evidence` workflow runs automatically when its build, adapter-selection, or geometry-evidence paths change and can also be started manually after it exists on the default branch. It builds with read-only repository permissions, runs the extended allocator-instrumented Chromium fixture, and retains the build report, exact sources, outputs, and Playwright evidence for seven days. A successful workflow artifact is engineering evidence, not a release distribution.

The generated artifacts remain quarantined in `.artifacts`. Promotion requires:

1. replace the worker import behind the existing adapter boundary;
2. record the output digests and exact source bundle in release metadata;
3. rerun geometry invariants, STEP/STL round-trip, three-browser E2E, stage-isolated allocator metrics, and extended lifecycle batches;
4. compare raw, gzip, and Brotli size plus initialization and operation timings;
5. archive license texts, patches, the source inputs, build report, and replacement instructions;
6. update `OPENCASCADE_SOURCE_REVISION` only after the artifact actually used by the worker is the controlled build.

## Memory metrics

The worker protocol now reports ordered memory snapshots from initialization through shape disposal. With the published package, `source` is `heap-capacity-only` and allocator values are `null`. A successful controlled build changes the source to `allocator-instrumented` and reports:

- `arenaBytes` — memory obtained by the allocator;
- `allocatedBytes` — live allocated bytes from `mallinfo().uordblks`;
- `freeBytes` — allocator-owned free bytes from `mallinfo().fordblks`;
- `heapCapacityBytes` — Emscripten linear-memory capacity, which does not shrink.

This distinction is required before interpreting retained linear-memory capacity as a native leak.

The operation-isolation matrix demonstrates that native C++ scoped box and cylinder cycles return to their exact pre-loop live allocation, while equivalent generated-binding calls retain allocation linearly. The pinned OpenCascade.js generator replaces `raw_destructor<T>` with a no-op when it detects placement delete; OCCT's `DEFINE_STANDARD_ALLOC` declares placement delete alongside a usable ordinary delete. The next controlled build must reproduce the builder image from the archived sources with a reviewed generator correction. It must not promote the current registry-built artifact or hide the problem behind worker restart alone.
