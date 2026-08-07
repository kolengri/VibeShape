---
name: vibeshape-dependency-audit
description: Audit and safely remediate JavaScript, TypeScript, WASM, native-source, build-tool, and browser dependencies in the VibeShape Bun monorepo. Use for `bun audit`, CVEs, dependency upgrades, lockfile changes, vulnerable transitive packages, OCCT/OpenCascade.js/Replicad/SolveSpace updates, license alerts, or supply-chain review.
---

# VibeShape Dependency Audit

## Establish Scope

Before changing dependencies:

1. Read the owning workspace manifest, Bun catalog, `bun.lock`, and `docs/licensing.md`.
2. Resolve current CLI and package behavior through Context7 or the official upstream source.
3. Classify each finding as direct, transitive, build-only, browser-shipped, WASM/native-source, or false positive.
4. Record severity, affected versions, minimum safe version, and whether a fix is breaking.

## Remediate Conservatively

- Prefer the smallest safe direct-dependency update.
- Update the parent dependency for a transitive issue before considering an override.
- Keep unrelated upgrades out of the change.
- Do not use a floating version to fix an advisory.
- Ask before a breaking major update or a change that can alter geometry, file output, or solver results.
- Use Bun catalogs for shared versions and keep dependencies in the workspace that uses them.
- Rerun `bun audit` after every remediation set.

## CAD and WASM Gate

An OCCT, OpenCascade.js, Replicad, SolveSpace, Emscripten, Three.js, or format-library update also requires:

- exact upstream source and build identifier;
- license and source-offer review;
- geometry or solver corpus before-and-after comparison;
- startup, bundle-size, memory, and leak comparison when applicable;
- STEP/STL/3MF round-trip checks when output may change;
- file/cache engine metadata and migration impact review.

Do not accept an update solely because audit output is clean.

## Verify and Report

Use `vibeshape-verify-scope` for affected workspaces. Report fixed advisories, exact package changes, lockfile impact, license changes, behavior-sensitive checks, and any unresolved finding. Never claim success without rerunning the audit and relevant regression corpus.
