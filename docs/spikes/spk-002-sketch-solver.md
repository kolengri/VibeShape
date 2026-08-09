# SPK-002 — SolveSpace sketch solver evidence

## Result

**Pass — the SolveSpace v3.2 solver subset is viable behind a flat worker-owned WASM ABI.**

The spike clears the solver-selection gate. The generated binary is never imported by product UI code; subsequent production work promotes the exact reviewed output only behind the document-worker boundary.

## Production promotion status

The non-visual promotion gate is now complete. Sketch schema v0 defines bounded origin-plane point, line, circle, and arc records, every P0 constraint family, semantic reference compatibility, and Quantity-backed dimensions. Ordinary revisioned add, update, and remove commands provide deterministic tamper-resistant replay, persistence commits accept the same events, and `.vshape` v0 preserves the analytical records and authored expressions.

Document protocol v5 carries exact-revision `solveSketch` requests, strict solution records, and deterministic profile results. `@vibeshape/sketch-solver` evaluates document variables, maps stable IDs to ephemeral ABI handles, restores compatible prior solutions, applies explicit drag targets last, and maps solved values and conflicts back to stable IDs. The post-spike production extractor derives bounded endpoint-connected analytical profiles without changing the native ABI. The document session rebuilds the committed snapshot before retrying one recoverable solve after worker replacement. The real-browser production harness solves a `#width`-driven fully constrained line, derives one `#width` by `#height` rectangular profile, performs two continuation/drag solves, and solves a 1,000-point sketch in the actual generated worker WASM. `bun run solvespace:verify:runtime` independently fixes the promoted module and WASM to the reviewed hashes below.

Profile detection and stable selectors were not part of this solver spike; ADR-0018 adds their endpoint-connected production boundary separately. Interior-intersection splitting, selector-backed sketch features, sketch-mode interaction, and conflict repair UX remain product work.

## Scope

The spike answers whether VibeShape can isolate the solver without adopting the experimental SolveSpace web application or passing native objects into TypeScript.

It covers:

- point, line, circle, arc, distance, workplane, and normal entities;
- every P0 constraint primitive;
- fully, under-, and over-constrained classification;
- conflicting constraint handles;
- dragged and fixed point input;
- degenerate and coincident geometry;
- 100 perturbations for each of 15 constraint fixtures plus 100 larger line-drag perturbations;
- 1,000 create, solve, and dispose cycles;
- Bun and Chromium module-worker execution;
- source and output provenance, bit reproducibility, and corresponding-source packaging.

The original spike does not cover profile extraction, product UI interaction, solution-branch continuity across complex drags, very large sketches beyond the initial 1,000-point product budget, or every non-P0 SolveSpace constraint. Production serialization, construction flags, ordinary commands, the initial continuation policy, and endpoint-connected profile extraction were implemented after the spike and are summarized above.

## Reproducible inputs

| Input | Revision | Archive SHA-256 |
|---|---|---|
| SolveSpace v3.2 | `27b6a080c8b669421bd4d444650c3b8eddec5687` | `dce38b12e26ba221c1a5aa3388d1188c152207664e364a99d71f290512352cb1` |
| Eigen | `3147391d946bb4b6c68edd901f2add6ac1f31f8c` | `0c8c490764f9c2a793133491adca0cd073b73e0bde965c68cbe58d91b5ed4261` |
| mimalloc | `f81bf1b31af819a31195e08f9546dc80f8931587` | `b9dffb5b3d3218cd402fd7ca9d6b123d46c29d06485d769ebbfa7bb23c6773c2` |
| Emscripten | 6.0.6, commit `ce75e06884093bcefb86a6b8fd56a5d62a4cc245` | image `sha256:1107465ce37d6d95942e53774ef2d272bea3880bb07d37fe63213469ef2d05dc` |

The selected solver translation units are `constrainteq.cpp`, `entity.cpp`, `expr.cpp`, `platform/platformbase.cpp`, `system.cpp`, `util.cpp`, and `slvs/lib.cpp`, with the public `include/slvs.h`, Eigen, and mimalloc dependencies. GUI, CLI, tests, OpenMP, the experimental web UI, and unrelated native application sources are not linked into the WASM target.

## Patch and ABI

The reviewed patch and wrapper live under `native/solvespace`.

The patch:

1. embeds the exact SolveSpace commit for archive-only builds;
2. exposes the maximum residual of generated equations after `Slvs_Solve`;
3. replaces upstream `jslib.cpp` with the VibeShape wrapper;
4. emits an ES module plus separate WASM for web, worker, and Node environments;
5. removes filesystem support and bounds memory from 16 MiB to 64 MiB.

### Input layout

| Buffer | Type | Stride | Fields |
|---|---|---:|---|
| Parameter metadata | `Uint32Array` | 2 | handle, group |
| Parameter values | `Float64Array` | 1 | value |
| Entity records | `Uint32Array` | 14 | handle, group, type, workplane, four points, normal, distance, four parameters |
| Constraint records | `Uint32Array` | 12 | handle, group, type, workplane, two points, four entities, two flags |
| Constraint values | `Float64Array` | 1 | scalar value |
| Dragged parameters | `Uint32Array` | 1 | parameter handle |

The boundary rejects malformed strides, non-finite scalar inputs, zero solve groups, duplicate or zero handles, zero record groups, unsupported native types, dangling entity or constraint references, unknown dragged-parameter handles, more than 10,000 parameters, more than 5,000 entities, more than 10,000 constraints, or more dragged handles than parameters. Zod performs the same structural fail-fast validation before native execution. Product-level semantic compatibility between each constraint and referenced entity kind remains the responsibility of the production sketch domain; the worker hard-restart policy remains the final containment boundary for unexpected native faults.

The raw native rejection corpus verifies stable status codes for a duplicate handle (`-5`), unsupported entity type (`-6`), and dangling reference (`-4`). These cases never enter `Slvs_Solve`.

### Output

The native result contains:

- ABI status;
- SolveSpace result code;
- degrees of freedom;
- maximum equation residual;
- copied solved `Float64Array` values;
- copied failed-constraint `Uint32Array` handles.

The TypeScript adapter validates the native result and normalizes it to `fully-constrained`, `under-constrained`, `over-constrained`, or `failed`. `SketchSolverSession.dispose()` prevents use-after-dispose while retaining no native session pointer.

## P0 mapping and evidence

| Product constraint | Native primitive | Evidence |
|---|---|---|
| Coincidence | `SLVS_C_POINTS_COINCIDENT` | Pass |
| Horizontal / vertical | `SLVS_C_HORIZONTAL`, `SLVS_C_VERTICAL` | Pass |
| Parallel / perpendicular | `SLVS_C_PARALLEL`, `SLVS_C_PERPENDICULAR` | Pass |
| Equal | `SLVS_C_EQUAL_LENGTH_LINES`; equal-radius equation where applicable | Pass |
| Tangent | `SLVS_C_ARC_LINE_TANGENT` | Pass |
| Concentric | coincident center points | Pass at primitive mapping |
| Point on line / curve | `SLVS_C_PT_ON_LINE`, `SLVS_C_PT_ON_CIRCLE` | Pass |
| Fixed | `SLVS_C_WHERE_DRAGGED` | Pass |
| Horizontal / vertical distance | `SLVS_C_PROJ_PT_DISTANCE` against immutable axes | Pass |
| General distance | `SLVS_C_PT_PT_DISTANCE` | Pass |
| Angle | `SLVS_C_ANGLE` | Pass |
| Radius / diameter | `SLVS_C_DIAMETER` with UI-level radius conversion | Pass |

The native solver reports the fully constrained fixture with zero degrees of freedom, the under-constrained fixture with three degrees of freedom, and the contradictory-distance fixture as inconsistent with conflicting handles `2` and `4`. The adapter never deletes those constraints.

## Measurements

Measurements were collected locally on 2026-08-08. Timing values are evidence for this machine and run, not universal product budgets.

| Measurement | Result |
|---|---:|
| ES module | 14,889 bytes |
| WASM | 251,544 bytes |
| Combined uncompressed output | 266,433 bytes |
| Bun module initialization | 13.80 ms |
| Chromium worker fixture count | 19 |
| Chromium worker solve batch | 12.6 ms |
| Initial Chromium WASM heap | 16,777,216 bytes |
| Post-corpus heap | 37,879,808 bytes |
| Lifecycle solve p50 | 0.023 ms |
| Lifecycle solve p95 | 0.031 ms |
| Lifecycle solve maximum | 1.393 ms |
| Heap before 1,000 lifecycle cycles | 37,879,808 bytes |
| Heap after 1,000 lifecycle cycles | 37,879,808 bytes |
| Constraint perturbation solves | 1,500 |
| Canonical line perturbation solves | 100 |
| Maximum successful residual | `9.03e-9`; acceptance threshold `1e-7` |

The zero-length line fixture returns an under-constrained result without trapping or producing a non-finite residual. Coincident points solve normally.

## Bit reproducibility

The first clean-build comparison detected different WASM hashes even though behavior and module JavaScript matched. WAT comparison isolated the difference to mimalloc's compilation date and time strings. The build now pins `SOURCE_DATE_EPOCH=1774563433`, `TZ=UTC`, and `LC_ALL=C`.

Two subsequent clean local builds were byte-identical:

| Output | SHA-256 |
|---|---|
| `vibeshape_slvs.mjs` | `60c8714fbd5d94a50bdfcde7bd1658cfb2a180ad44be124997905ece7be545c7` |
| `vibeshape_slvs.wasm` | `c9e3e35084b3812e9eae7bdff8fd3290394918c88ba38504e58a9a9d4a2bd978` |

## Local commands and CI budget

```bash
bun run solvespace:prepare
VIBESHAPE_DOCKER_BIN=/path/to/docker bun run solvespace:build
bun run solvespace:evidence
bun run solvespace:bundle:compliance
```

All four paths are local-only where they perform native work and reject truthy `CI`. There is no SolveSpace source-build or extended-evidence GitHub Actions workflow. Ordinary PR CI verifies the checked-in runtime hashes and runs fast TypeScript tests; it never downloads or source-builds SolveSpace. Production Vite and Playwright verification remain local pre-merge gates.

## Licensing and corresponding source

SolveSpace is GPL-3.0-or-later. The generated local corresponding-source archive contains:

- complete exact SolveSpace, Eigen, and mimalloc source archives;
- the VibeShape patch and ABI wrapper;
- the build recipe and pinned image identity;
- build, Bun, and Chromium evidence reports;
- SolveSpace, Eigen, and mimalloc license and notice texts;
- a file manifest and SHA-256 checksums.

This technical bundle supports compliance but does not replace release legal review, a complete application SBOM, or distribution-specific notices.

## Unsupported and deferred behavior

No required P0 primitive is unsupported by the selected native subset. Deferred behavior includes cubic and curve-to-curve tangency, 3D sketch constraints, reference dimensions, budgets beyond the initial 1,000-point harness, complex drag branch continuity, profile extraction, and user-facing repair guidance. These are not reasons to replace the solver now; they are explicit product acceptance work.

## Stop/go decision

**Go** with the narrow SolveSpace v3.2 WASM solver boundary selected in [ADR-0014](../adr/0014-solvespace-flat-wasm-solver.md).

The production sketch domain, protocol v5, initial branch-continuation policy, variable-backed dimensions, recovery, deterministic endpoint-connected profiles, stable boundary selectors, and 1,000-point browser budget now consume this ABI. The next sketch work is interior-intersection splitting, selector-backed features, and the accessible sketch interaction slice. The next independent Phase 0 uncertainty at the time of this decision was SPK-003 stable topology references; that spike has since passed separately.
