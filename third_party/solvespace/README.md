# SolveSpace corresponding source

This directory accompanies the exact SolveSpace-derived browser runtime under `packages/sketch-solver/runtime`.

`solvespace-corresponding-source.tar.gz` contains the complete pinned SolveSpace v3.2, Eigen, and mimalloc source archives; the VibeShape patch and flat ABI wrapper; the pinned local build recipe; license and notice texts; and the evidence reports for the promoted outputs.

| Artifact | SHA-256 |
|---|---|
| Corresponding-source bundle | `a7064eb4a1e2defff4a2b310d3d727f0ccf42c4a625f51aad638ce05c13a5c65` |
| ES module | `60c8714fbd5d94a50bdfcde7bd1658cfb2a180ad44be124997905ece7be545c7` |
| WASM | `4f11c532844b963910bf9bf5aebabe67aed7926d1307195cc2d4fcc9f06dee82` |

Run `bun run solvespace:verify:runtime` to verify that the distributed runtime and corresponding-source bundle still match the reviewed artifacts. Run `bun run solvespace:bundle:compliance` after a reviewed source build to reproduce the bundle. A solver upgrade must replace the runtime and corresponding source together and update all recorded hashes in one change.

This bundle supports source availability for repository distribution. A separate hosted or packaged application release must make the same exact corresponding source available alongside the distributed runtime and complete the release compliance review described in `docs/licensing.md`.
