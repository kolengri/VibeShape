# Controlled OCCT WASM build

## Status

This directory owns the reproducible local builder and memory-evidence harness for the SPK-001 controlled geometry candidate. The artifact remains quarantined under `.artifacts` and is selected only by Vite's `controlled-occt` mode; the normal application dependency graph still uses the locked published package.

The source-reproduction and allocator-plateau blockers are closed. Production promotion still requires operation-history coverage, independent STEP validation, declared performance budgets, and the release compliance bundle described in [SPK-001](../../docs/spikes/spk-001-occt-worker.md).

## Pinned inputs

| Input | Identity | SHA-256 or digest |
|---|---|---|
| OpenCascade.js source | `5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7` | `7107d5a36712542997895efa17b44ea0e2b956c3908cbe98b7d95c194f1e556f` |
| OCCT source | `bb368e271e24f63078129283148ce83db6b9670a` | `fabda9f139f2c09e675d5b9717110175b0ad5d9fb09187e3d56687220d2687e6` |
| Replicad build config | `19fb8212e0bb12a07a7a49f96950f8903903d469` | `83a9fd99e39b77d7128270e08764cafd334117fbd0d083792b3a49aaa181787f` |
| RapidJSON source | `v1.1.0` | `bf7ced29704a1e696fbccf2a2b4ea068e7774fa37f6d7dd4039d0787f8bed98e` |
| FreeType source | `VER-2-13-0` | `a683f1091aee95d2deaca9292d976f87415610b8ae1ea186abeebcb08e83ab12` |
| Emscripten SDK image | `linux/amd64` | `sha256:4c3e0a0dac61430b719e82118ae9b2c7480902a2713267e80fa296d39f7ab921` |
| Registry comparison builder | `linux/amd64` | `sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d` |

The machine-readable constants live in `scripts/occt-build-config.ts`. Changing an identity, checksum, platform, configured binding, compiler input, or destructor patch is a geometry dependency change and requires the dependency-audit and regression gates.

## Local commands

Prepare and verify exact sources without Docker:

```bash
bun run occt:prepare
```

Build the unpatched and patched source images, compare the unpatched output contract with the registry baseline, and stage the patched package:

```bash
bun run occt:build:source
```

Run the allocator-instrumented Chromium matrices against an already staged package:

```bash
bun run occt:evidence:memory
```

Run both stages when the builder inputs changed:

```bash
bun run occt:evidence
```

Set `VIBESHAPE_DOCKER_BIN` when the Docker-compatible executable is not named `docker`, for example:

```bash
VIBESHAPE_DOCKER_BIN=/path/to/docker bun run occt:build:source
```

The source build targets `linux/amd64`. An ARM64 workstation therefore needs a Docker runtime with AMD64 emulation. The first build compiles OCCT and the configured bindings and can take tens of minutes; Docker layer caching makes unchanged repeats substantially faster.

## Build contract

The builder:

- verifies all source archives before constructing the Docker context;
- builds OpenCascade.js and OCCT from those archives rather than copying a registry image;
- generates only the 262 bindings selected by the reviewed Replicad configuration;
- builds an unpatched image and a destructor-policy-corrected image from the same source objects;
- requires the unpatched JavaScript and declarations to match the registry output exactly;
- requires equal output dimensions and an identical WebAssembly import/export interface;
- records both comparison and patched-output manifests under `.artifacts/occt-build`.

The upstream link is not bit-reproducible: repeated builds can produce different WASM bytes while preserving the same dimensions and runtime interface. The harness therefore records hashes but rejects drift through a structural output contract instead of asserting a false static WASM hash.

The generator patch preserves the ordinary public one-argument destructor when OCCT also declares placement delete. This corrects the OpenCascade.js policy that previously emitted a no-op native destructor for affected OCCT classes.

## Runtime ownership and memory evidence

The worker keeps Replicad behind the geometry adapter but owns critical OCCT lifetimes directly:

- primitive, boolean, and fillet builders use explicit `try/finally` cleanup;
- tessellation deletes every owned explorer, face, transform, point, normal, triangle, and mesher wrapper;
- STL export consumes the attached triangulation and then calls `BRepTools.Clean`;
- STEP import clears reader-owned shapes, and STEP export resets the writer model;
- topology counting avoids Replicad iterators that retain raw explorer wrappers.

The controlled matrix runs five full batches and 1,000 lifecycle operations per batch across Replicad-facing, direct Embind, and native probes. After the first full-fixture warmup, the measured post-disposal allocator moved from 481,872 to 482,304 bytes across four further batches: 432 bytes of retained drift. Every 1,000-operation lifecycle block retained zero bytes. The executable ceilings are 64 KiB post-warmup drift and 8 KiB per lifecycle block.

`heapCapacityBytes` remains a high-water mark and is not treated as live native allocation. The controlled build exposes `mallinfo()` arena, allocated, and free bytes through `VibeShapeAllocatorStats`, plus native lifecycle and allocator-purge controls through `VibeShapeOcctDiagnostics`.

## CI policy

Heavy OCCT image builds and extended Playwright evidence are local-first because they are expensive. `.github/workflows/controlled-occt.yml` is manual-only and must not be added to pull-request or push triggers without a recorded CI-budget decision. Normal pull requests run the fast repository verification workflow; generated OCCT packages and evidence are never committed.

## Promotion gate

Before the controlled package becomes the normal worker dependency:

1. verify operation history required by stable topology references;
2. open exported STEP independently in a second implementation;
3. record cold startup, long-task, p95 operation, and peak-memory budgets on declared hardware;
4. repeat the required cross-browser and recovery matrix;
5. archive exact source inputs, patch, build report, output hashes, license texts, notices, and replacement instructions;
6. update `OPENCASCADE_SOURCE_REVISION` only when the controlled artifact is the package actually loaded by the production worker.
