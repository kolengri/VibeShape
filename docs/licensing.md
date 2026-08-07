# Licensing Strategy

## Decision

The VibeShape repository's code and documentation are licensed under **GPL-3.0-or-later**. This choice supports the goal of building free, local CAD software and permits derivative integration of GPL-licensed SolveSpace solver code.

This is an engineering strategy, not legal advice. A formal compliance review is required before the first public binary or WASM release.

## Why GPL-3.0-or-later

- It guarantees that users can access the source code of modified distributed versions.
- It is compatible with the intended use of OCCT under LGPL-2.1 with the Open CASCADE exception.
- It does not conflict with the planned use of GPL-3.0-or-later solver code.
- It does not promise permissive proprietary embedding that may be incompatible with the solver.
- It matches the goal of software that is free as in freedom, not merely free of charge.

If a future business model requires a permissive or commercial SDK, the GPL solver must first be replaced and a new dependency and license audit must be completed. Relicensing existing contributions would require consent from their copyright holders or an appropriate contributor license agreement policy.

## Dependency Matrix

| Component | Verified license | Required action |
|---|---|---|
| VibeShape | GPL-3.0-or-later | Include `LICENSE`, SPDX headers, and source release |
| Open CASCADE Technology | LGPL-2.1 with Open CASCADE exception | Include notices, license text, exact sources and build instructions, and preserve replaceability |
| OpenCascade.js | LGPL-2.1 | Apply the same obligations and verify the files actually bundled |
| Replicad | MIT | Preserve notice and license |
| SolveSpace | GPL-3.0-or-later | Publish sources, patches, and build scripts; keep the combined work GPL-compatible |
| React | MIT | Include a third-party notice |
| React DOM | MIT | Include a third-party notice |
| Three.js | MIT | Include a third-party notice |
| Vite | MIT | Include a build-time notice according to release policy |
| Vite React plugin | MIT | Include a build-time notice according to release policy |
| Zustand | MIT | Include a third-party notice |
| Dexie | Apache-2.0 | Include license and applicable `NOTICE` obligations |
| Zod | MIT | Include a third-party notice |
| Bun | MIT | Pin the toolchain and link its source; it is normally not part of the browser distribution |
| Tailwind CSS / Vite plugin | MIT | Include a third-party notice |
| shadcn/ui source and CLI | MIT | Preserve applicable notices when copying or modifying source |
| Radix UI | MIT | Include a third-party notice |
| Lucide React | ISC | Include a third-party notice |
| TanStack Form | MIT | Include a third-party notice |
| use-intl and ICU formatting dependencies | MIT; BSD-3-Clause for `intl-messageformat` | Include third-party notices; these packages ship in the browser bundle |
| class-variance-authority | Apache-2.0 | Include the license and applicable notice obligations |
| clsx / tailwind-merge | MIT | Include third-party notices |
| TypeScript | Apache-2.0 | Record as a build tool and include the license according to release policy |
| Biome | MIT OR Apache-2.0 | Record the selected license path in build-tool notices |
| Vitest | MIT | Include a build-time notice according to release policy |
| Playwright | Apache-2.0 | Record the test tool; browser distributions are development downloads and are not shipped with the app |
| Testing Library and jsdom | MIT | Record as test tools; they are not shipped with the production browser bundle |
| Fallow static analyzer and GitHub Action | MIT | Pin the development tool and action revision; include its license in build-tool notices according to release policy |
| 3MF specification | Royalty-free specification terms | Follow specification attribution and terms; the VibeShape writer remains GPL-licensed |
| PrusaSlicer / CuraEngine | AGPL-3.0 | Do not bundle in the MVP; record any future integration in a separate ADR |

This matrix is a snapshot from 2026-08-07. The lockfile and software bill of materials are the source of truth for the dependencies present in a release.

Generated shadcn components become part of the VibeShape source tree, but their provenance must not be erased. `THIRD_PARTY_NOTICES` records the upstream project, CLI version, and MIT license. VibeShape modifications are distributed as part of the GPL project while preserving upstream permissive-license notices.

## OCCT Obligations

The official OCCT documentation identifies these minimum obligations:

- Provide users with a prominent notice that OCCT is used and access to the LGPL text.
- Provide the source code of the exact OCCT version used.
- Allow users to run the application with a modified version of OCCT.
- Give special attention to static linking and packaging.

For a web/WASM release, VibeShape must:

1. Expose an `About -> Open source licenses` view.
2. Distribute or link to the exact source archive and patches.
3. Publish reproducible build scripts, flags, and bindings.
4. Avoid obscuring how to replace the `.wasm` module and loader in a self-hosted build.
5. Include notices and license texts in the distribution.
6. Document compliance with the Open CASCADE exception.
7. Never rely only on a link to the upstream `master` branch.

## SolveSpace Reuse

Only the solver files that are needed may be reused, and only while retaining copyright and license notices and publishing the corresponding source and changes. The project must record:

- the upstream commit;
- the list of included files;
- the patch series;
- the Emscripten and build-toolchain versions;
- public build instructions;
- tests that verify the behavior of the modified subset.

Do not describe SolveSpace as a library with a permissive API. Its repository is licensed under GPL-3.0-or-later, and the official web build is explicitly described as experimental.

## Documentation and Contributions

Contributions are accepted under GPL-3.0-or-later by default. `CONTRIBUTING.md` must state the inbound-equals-outbound policy. A Developer Certificate of Origin using `Signed-off-by` is preferable to a heavyweight contributor license agreement until dual licensing becomes a real requirement.

Examples and fixtures imported from third parties must record their provenance and license. Do not add arbitrary STEP or STL files from the internet without permission.

## Release Checklist

- Include the complete `LICENSE` file.
- Generate `THIRD_PARTY_NOTICES` from the lockfile or software bill of materials.
- Make exact OCCT, OpenCascade.js, and SolveSpace sources, patches, and build instructions available.
- Include notices in the About dialog.
- Include all required license texts in the distribution.
- Ensure the source build reproduces the WASM artifact or documents known deviations.
- Do not use trademarks in a way that implies affiliation with Onshape, PTC, or Open CASCADE.
- Give exported sample files a clear license of their own.
- Complete a legal review before the first public hosted release.

## Name and Trademarks

VibeShape is described as an independent browser-based CAD application. Onshape may be mentioned only for functional comparison. Do not use its logos, UI assets, or language that implies an official relationship.
