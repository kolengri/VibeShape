# Rebuilding and replacing the controlled OCCT WebAssembly module

This document describes the technical replacement path for VibeShape's controlled OpenCascade.js/OCCT module. It is not legal advice and does not replace the license texts or notices shipped in the compliance bundle.

## Bundle layout

The generated bundle contains:

- exact source archives under `build/context/sources`;
- the reviewed OpenCascade.js patch and corrected generator source under `build/context/patches`;
- the purpose-owned binding generator and allowlist under `build/context`;
- the pinned Docker recipe and toolchain identities;
- the generated build configuration under `build/input`;
- the corresponding JavaScript, WebAssembly, and TypeScript outputs under `artifacts` and `package`;
- exact license texts, notices, hashes, and build reports.

Verify `manifest.json` and `SHA256SUMS` before using the bundle. A changed source archive, patch, build recipe, or output intentionally invalidates the original manifest and must be documented in a replacement build.

## Build the supplied sources

From the extracted bundle root:

```bash
docker build \
  --platform linux/amd64 \
  --target patched-builder \
  --tag local/vibeshape-occt-builder \
  build/context

mkdir -p output
cp build/input/vibeshape_occt.yml output/

docker run --rm \
  --platform linux/amd64 \
  --volume "$PWD/output:/src" \
  local/vibeshape-occt-builder \
  vibeshape_occt.yml
```

The output directory must contain:

- `vibeshape_occt.js`;
- `vibeshape_occt.wasm`;
- `vibeshape_occt.d.ts`.

The build targets `linux/amd64`. An ARM64 workstation needs a Docker-compatible runtime with AMD64 emulation.

## Build a modified OCCT module

Replace the relevant archive in `build/context/sources`, or edit the OpenCascade.js correction under `build/context/patches`, before building. Keep the expected archive names because the Dockerfile refers to them directly. Record the new upstream revision, archive digest, patch, toolchain, build configuration, and output hashes. Do not present a modified artifact with VibeShape's original manifest.

The supplied Dockerfile copies `patches/bindings.py` into the patched builder. If the modified OpenCascade.js source changes `src/bindings.py`, update both the corrected file and the human-readable patch.

## Use the replacement in a self-hosted VibeShape checkout

Create the controlled package layout:

```text
.artifacts/occt-build/package/
  package.json
  src/
    replicad_single.js
    replicad_single.wasm
    replicad_single.d.ts
```

Copy or rename the three generated outputs to those `replicad_single.*` names. The package metadata can follow the supplied `package/package.json`, but it should use a version that identifies the replacement source revision.

Run VibeShape in controlled mode:

```bash
bun run --cwd apps/web dev:e2e -- --mode controlled-occt
```

The controlled Vite mode aliases `replicad-opencascadejs` to `.artifacts/occt-build/package`. The normal application mode continues to use the lockfile dependency, so replacing the quarantined artifact never silently changes a regular build.

Before distributing a replacement, rerun the geometry, memory, performance, source-provenance, and license checks that apply to the modified module. Preserve the LGPL-2.1 texts, the OCCT exception, corresponding source, modification record, and all other applicable notices.
