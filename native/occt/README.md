# Controlled OCCT WASM build

## Status

This directory owns the reproducible local builder, controlled evidence harnesses, and corresponding-source bundle contract for the SPK-001 geometry candidate. The artifact remains quarantined under `.artifacts` and is selected only by Vite's `controlled-occt` mode; the normal application dependency graph still uses the locked published package.

The source-reproduction, operation-history, allocator-plateau, controlled-performance, independent-application STEP, and technical release-bundle gates are closed. SPK-001 passes its Phase 0 stop/go gate. Production promotion still requires the facade decision and extended corpus described in [SPK-001](../../docs/spikes/spk-001-occt-worker.md). A public release also requires the repository-wide release checklist and legal review.

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

Run the controlled local Chromium performance budget against the staged package:

```bash
bun run occt:evidence:performance
```

Export the controlled browser fixture and validate it with local headless FreeCAD:

```bash
bun run occt:evidence:step
```

The command resolves `FreeCADCmd` or `freecadcmd` from `PATH`, checks the standard macOS application paths, or accepts an absolute `VIBESHAPE_FREECAD_CMD`. It rejects `CI`, uses an isolated FreeCAD configuration under `.artifacts`, and validates the exact STEP bytes, one valid solid, volume, and bounds.

Create and verify the corresponding-source archive from the staged build evidence:

```bash
bun run occt:bundle:compliance
bun run occt:verify:compliance
```

The generator rejects any environment where `CI` is set. It writes the bundle, archive, and report under `.artifacts/occt-build/compliance`; none are committed.

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

The controlled matrix runs five full batches and 1,000 lifecycle operations per batch across Replicad-facing, direct Embind, and native probes. After the first full-fixture warmup, the measured post-disposal allocator moved from 481,864 to 482,312 bytes across four further batches: 448 bytes of retained drift. Every 1,000-operation lifecycle block retained zero bytes. The executable ceilings are 64 KiB post-warmup drift and 8 KiB per lifecycle block.

`heapCapacityBytes` remains a high-water mark and is not treated as live native allocation. The controlled build exposes `mallinfo()` arena, allocated, and free bytes through `VibeShapeAllocatorStats`, plus native lifecycle and allocator-purge controls through `VibeShapeOcctDiagnostics`.

## CI policy

Heavy OCCT image builds, allocator matrices, stable performance evidence, independent FreeCAD STEP evidence, and corresponding-source bundle generation are local-only because they are expensive. They have no GitHub Actions workflow and must not be added to pull-request, push, scheduled, or manual workflows without a recorded CI-budget decision. Normal pull requests run the fast repository verification workflow once; the squash-merged tree is not rerun on `main`. Generated OCCT packages, evidence, and bundles are never committed.

## Promotion gate

Before the controlled package becomes the normal worker dependency:

1. compare the controlled direct boundary with Replicad for the production feature surface;
2. repeat the required extended format and lifecycle corpus across target browsers and independent kernels where practical;
3. update `OPENCASCADE_SOURCE_REVISION` only when the controlled artifact is the package actually loaded by the production worker.

The local technical bundle already preserves the five checksum-verified source archives, exact modification, build recipe, evidence, output files and hashes, license texts, notices, and replacement instructions. Its payload inventory covers 38 files and 88,067,680 bytes; the verifier covers 40 files after including `manifest.json` and `SHA256SUMS`. This is engineering evidence, not a substitute for legal review or the complete application release notice/SBOM.
