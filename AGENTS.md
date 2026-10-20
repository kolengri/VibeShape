# Repository instructions

## Canonical language

- Use English for all documentation, ADRs, README files, contribution guides, issue/PR templates, source identifiers, test descriptions, developer diagnostics, and code comments.
- Keep comments concise and explain intent, invariants, ownership, or non-obvious constraints. Do not restate the code.
- Do not add bilingual comments or parallel translated documentation to the source tree.
- User-facing product copy must be authored in English and routed through the localization layer when localization is introduced.
- Put product copy in typed ICU message catalogs; do not concatenate translated fragments or use display copy as a domain identifier.
- English is the source catalog. Every added locale must match its keys and placeholders before merge.
- Preserve official product, library, standard, and file-format names exactly as published.

## Architecture discipline

- Read the relevant ADRs before changing the CAD kernel, worker boundary, data model, storage, UI system, package manager, or license.
- Geometry changes require invariant and failure tests. Never depend on transient OCCT face/edge indices as persistent identity.
- Keep `packages/domain` independent of React, Three.js, persistence, and the geometry adapter.
- Use Bun workspaces and `bun.lock`; keep Vite as the browser build pipeline unless an ADR supersedes that decision.
- Treat generated shadcn components as reviewed project source, not as opaque dependencies.
- Build form controls as state-agnostic, uncontrolled-first primitives before adding separate TanStack Form adapters.
- Async action controls must prevent duplicate activation, expose accessible pending state, and release their lock on both fulfillment and rejection.
- Create scoped vanilla Zustand stores once inside React providers with lazy `useState`; reset a scope by remounting an owning keyed boundary, never by mutating refs during render.

## Project skills

For tasks using VibeShape as a CAD application, start with `vibeshape-use` and load its modeling, inspection, organization, or export workflows as needed. See [the portable application-use skill pack](docs/agent-skills.md). These tasks do not activate source-development verification or Git workflows unless repository changes are also requested.

Use the repository-local skills under `.agents/skills` when their descriptions match the task:

- `vibeshape-ui-workflow` for React, Tailwind, shadcn, accessibility, and CAD interaction work;
- `vibeshape-icon-design` for SVG artwork, optical sizing, catalog registration, and colored-family integration;
- `vibeshape-testing` for runtime changes and regression coverage;
- `vibeshape-verify-scope` before reporting implementation work complete;
- `vibeshape-dependency-audit` for audits, upgrades, CVEs, and engine dependency changes;
- `vibeshape-feature-boundaries` before placing new CAD capabilities, modules, extension seams, or automation surfaces;
- `vibeshape-fallow` for changed-code intelligence, cleanup evidence, duplication, complexity, styling drift, and package-boundary findings;
- `vibeshape-local-diagnostics` for local runtime, browser, worker, WASM, persistence, and stale-UI failures;
- `vibeshape-type-guards` for runtime narrowing and schema-boundary decisions;
- `vibeshape-documentation-sync` after durable implementation, architecture, or changes to MCP contracts and agent workflows.

Keep detailed procedures in skills rather than expanding this always-loaded file.

When a change affects a capability available through MCP, its tool/resource contract, or the agent workflow, use `vibeshape-documentation-sync` to update the affected operator skills and their bundle in the same task. UI availability alone does not establish MCP support.

Default source lookup to scoped `rg` and direct reads, including multi-step investigations. Use the optional global `efficient-code-tools` skill only for structural code queries, dependency/consumer graphs, or verbose diagnostics. Reuse current evidence; repository verification remains authoritative.

## Tooling discipline

- Use the source-owned colored family for CAD application/shared-control icons through `@vibeshape/ui/components/icons`; follow `vibeshape-icon-design` for artwork. Edit SVG masters/catalog, run `bun run icons:generate`, and verify `bun run icons:check`. Do not add direct Lucide imports or app-local action glyphs there.

- Use Biome as the formatter, linter, and import organizer after the code scaffold exists.
- Run the Fallow changed-code audit after TypeScript, JavaScript, TSX, CSS, or package-manifest changes; investigate graph evidence before deleting or suppressing reported code.
- Keep separate TypeScript configurations for browser, worker, and library environments; do not expose Node or Bun globals to browser packages by default.
- Use Zod for untrusted, persisted, versioned, file, worker, and protocol payloads. Use `is-what` for small runtime-kind narrowing inside those validated boundaries; never treat `isObjectLike<T>` or another shallow predicate as shape validation.
- Prefer explicit package subpath exports. Do not create a generic shared `utils` package until concrete cross-package reuse exists.
- Add Turborepo only after measured task-graph or caching needs justify it.
