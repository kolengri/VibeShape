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
