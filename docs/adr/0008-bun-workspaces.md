# ADR-0008: Bun Workspaces for the Monorepo

- Status: **Accepted**
- Date: 2026-08-07

## Context

The future codebase naturally separates into a web application, domain layer, worker protocol, CAD adapter, persistence layer, format packages, viewer, and UI system. It needs a single lockfile, local package boundaries, aligned versions, and reproducible CI.

## Decision

Use Bun workspaces (`apps/*` and `packages/*`) as the package manager, script runtime, and workspace orchestrator. Local dependencies use `workspace:*`, shared versions use Bun catalogs, the lockfile is `bun.lock`, and CI installation uses `bun ci`.

Vite remains the browser bundler. Vitest and Playwright run through Bun. Do not add Turborepo until task caching or graph orchestration solves a measured problem.

## Consequences

- The toolchain has fewer commands and fast dependency installation.
- The Bun version must be pinned in `packageManager` and CI.
- Fixture tests and CI must verify Node.js compatibility for third-party CLIs.
- Package manifests remain self-contained; the root manifest does not become a dumping ground for dependencies.
- Migrating away from Bun would require lockfile and CI changes, but would not alter the domain architecture.

## Rejected Alternatives

- pnpm workspaces were technically suitable, but Bun was selected and its current workspaces and catalogs meet the requirements.
- npm workspaces provide less of the required orchestration and catalog ergonomics.
- Turborepo from day one adds a layer without a demonstrated bottleneck.
- Using the Bun bundler instead of Vite is premature for the React, Tailwind, worker, and WASM pipeline.
