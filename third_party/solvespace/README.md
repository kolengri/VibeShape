# SolveSpace corresponding source

This directory accompanies the exact SolveSpace-derived browser runtime under `packages/sketch-solver/runtime`.

`solvespace-corresponding-source.tar.gz` contains the complete pinned SolveSpace v3.2, Eigen, and mimalloc source archives; the VibeShape patch and flat ABI wrapper; the pinned local build recipe; license and notice texts; and the evidence reports for the promoted outputs.

| Artifact | SHA-256 |
|---|---|
| Corresponding-source bundle | `297f843724a48893737ae451616c70875ee8ec22c26d6dd91fcaca8b72db144b` |
| ES module | `60c8714fbd5d94a50bdfcde7bd1658cfb2a180ad44be124997905ece7be545c7` |
| WASM | `c9e3e35084b3812e9eae7bdff8fd3290394918c88ba38504e58a9a9d4a2bd978` |

Run `bun run solvespace:verify:runtime` to verify that the distributed runtime and corresponding-source bundle still match the reviewed artifacts. Run `bun run solvespace:bundle:compliance` after a reviewed source build to reproduce the bundle. A solver upgrade must replace the runtime and corresponding source together and update all recorded hashes in one change.

This bundle supports source availability for repository distribution. A separate hosted or packaged application release must make the same exact corresponding source available alongside the distributed runtime and complete the release compliance review described in `docs/licensing.md`.
