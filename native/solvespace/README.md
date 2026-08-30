# SolveSpace solver subset

This directory defines VibeShape's reviewed SolveSpace v3.2 source adaptation. It does not embed the experimental SolveSpace web application or its stateful JavaScript API.

## Boundary

`vibeshape_solver_abi.cpp` exposes one stateless solve call over typed arrays. The adapter validates record sizes, limits, handles, supported native types, and structural references before it copies flat parameters, entities, constraints, values, and dragged-parameter handles into a temporary `Slvs_System`; calls `Slvs_Solve`; and returns copied parameter values, status, degrees of freedom, maximum equation residual, failed constraint handles, and current WASM heap capacity. No C++ pointer or mutable SolveSpace object crosses the boundary. Production domain code must still enforce semantic compatibility between constraint and entity kinds.

`solvespace-v3.2-vibeshape.patch`:

- embeds the exact source revision when building from a source archive without `.git` metadata;
- exposes a read-only maximum-residual function from the C solver boundary;
- adds one allowlisted private equation for the oriented-chord half-plane used by the exact bounded
  elliptical-arc locus described in ADR-0029;
- replaces the broad, stateful upstream Embind target with the VibeShape flat ABI;
- emits a separate ES module and WASM file with a 16 MiB initial and 64 MiB maximum heap.

## Local-only commands

Heavy source builds and evidence runs intentionally have no GitHub Actions workflow and reject truthy `CI` environments.

```bash
bun run solvespace:prepare
VIBESHAPE_DOCKER_BIN=/path/to/docker bun run solvespace:build
bun run solvespace:evidence
bun run solvespace:bundle:compliance
```

`solvespace:prepare` verifies the pinned SolveSpace, Eigen, and mimalloc archives. `solvespace:build` runs the pinned Emscripten image and writes review candidates under `.artifacts/solvespace-build`. `solvespace:evidence` runs the typed adapter corpus in Bun and the raw ABI corpus in a real Chromium module worker. The compliance command creates a local corresponding-source archive with the exact sources, patch, wrapper, build recipe, evidence, and license texts.

The build sets `SOURCE_DATE_EPOCH`, `TZ=UTC`, and `LC_ALL=C`. This is required because mimalloc includes compilation date and time strings; without those variables, functionally identical WASM outputs have different hashes.

Generated candidates, reports, source downloads, and compliance archives remain ignored under `.artifacts`. The exact reviewed runtime is promoted to `packages/sketch-solver/runtime`; its matching public source bundle is `third_party/solvespace/solvespace-corresponding-source.tar.gz`. `bun run solvespace:verify:runtime` verifies all three artifacts. Do not replace or publish a generated binary without replacing the matching corresponding-source bundle and completing the release review.
