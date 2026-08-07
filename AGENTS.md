# Repository instructions

## Canonical language

- Use English for all documentation, ADRs, README files, contribution guides, issue/PR templates, source identifiers, test descriptions, developer diagnostics, and code comments.
- Keep comments concise and explain intent, invariants, ownership, or non-obvious constraints. Do not restate the code.
- Do not add bilingual comments or parallel translated documentation to the source tree.
- User-facing product copy must be authored in English and routed through the localization layer when localization is introduced.
- Preserve official product, library, standard, and file-format names exactly as published.

## Architecture discipline

- Read the relevant ADRs before changing the CAD kernel, worker boundary, data model, storage, UI system, package manager, or license.
- Geometry changes require invariant and failure tests. Never depend on transient OCCT face/edge indices as persistent identity.
- Keep `packages/domain` independent of React, Three.js, persistence, and the geometry adapter.
- Use Bun workspaces and `bun.lock`; keep Vite as the browser build pipeline unless an ADR supersedes that decision.
- Treat generated shadcn components as reviewed project source, not as opaque dependencies.

## Project skills

Use the repository-local skills under `.agents/skills` when their descriptions match the task:

- `vibeshape-ui-workflow` for React, Tailwind, shadcn, accessibility, and CAD interaction work;
- `vibeshape-testing` for runtime changes and regression coverage;
- `vibeshape-verify-scope` before reporting implementation work complete;
- `vibeshape-dependency-audit` for audits, upgrades, CVEs, and engine dependency changes;
- `vibeshape-type-guards` for runtime narrowing and schema-boundary decisions;
- `vibeshape-documentation-sync` after durable implementation or architecture changes.

Keep detailed procedures in skills rather than expanding this always-loaded file.

## Tooling discipline

- Use Biome as the formatter, linter, and import organizer after the code scaffold exists.
- Keep separate TypeScript configurations for browser, worker, and library environments; do not expose Node or Bun globals to browser packages by default.
- Prefer explicit package subpath exports. Do not create a generic shared `utils` package until concrete cross-package reuse exists.
- Add Turborepo only after measured task-graph or caching needs justify it.
