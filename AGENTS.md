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

Use the repository-local skills under `.agents/skills` when their descriptions match the task:

- `vibeshape-ui-workflow` for React, Tailwind, shadcn, accessibility, and CAD interaction work;
- `vibeshape-testing` for runtime changes and regression coverage;
- `vibeshape-verify-scope` before reporting implementation work complete;
- `vibeshape-dependency-audit` for audits, upgrades, CVEs, and engine dependency changes;
- `vibeshape-feature-boundaries` before placing new CAD capabilities, modules, extension seams, or automation surfaces;
- `vibeshape-fallow` for changed-code intelligence, cleanup evidence, duplication, complexity, styling drift, and package-boundary findings;
- `vibeshape-local-diagnostics` for local runtime, browser, worker, WASM, persistence, and stale-UI failures;
- `vibeshape-type-guards` for runtime narrowing and schema-boundary decisions;
- `vibeshape-documentation-sync` after durable implementation or architecture changes.

Keep detailed procedures in skills rather than expanding this always-loaded file.

## Multi-agent routing

- Keep the primary agent on the user-selected model for planning, architecture, ambiguous debugging, coordination, and final decisions. Never spawn a subagent on `gpt-5.6-sol` without explicit per-task user approval.
- For complex work with at least two independent bounded subtasks, delegate read-heavy exploration, diagnostics, verification, or review when it materially reduces elapsed time or keeps noisy evidence out of the primary context. Keep simple or tightly sequential work in the primary thread.
- Prefer the project agents in `.codex/agents/`: `vibeshape_researcher` for code and documentation investigation, `vibeshape_browser_debugger` for browser evidence, `vibeshape_coder` for one isolated implementation slice, and `vibeshape_reviewer` for owner-level review.
- Use `gpt-5.6-luna` for unspecified or temporary subagents. Reserve `gpt-5.6-terra` for review or other work that demonstrably needs stronger reasoning than a bounded Luna task.
- Spawn subagents with `fork_turns = "none"` when the client supports it. Pass only the task, relevant paths, accepted decisions, constraints, and expected output; never forward the full conversation by default.
- Allow only one writer per overlapping file set. Parallelize write work only when ownership is disjoint and explicit; otherwise use researcher or reviewer agents in parallel and keep implementation sequential.
- Wait for every required subagent result, validate its evidence in the primary thread, and make the final decision centrally. Subagents must not commit, push, merge, or perform external write actions unless that exact action was delegated.

See [the Codex agent team guide](docs/codex-agent-team.md) for role contracts and routing examples.

## Tooling discipline

- Use Biome as the formatter, linter, and import organizer after the code scaffold exists.
- Run the Fallow changed-code audit after TypeScript, JavaScript, TSX, CSS, or package-manifest changes; investigate graph evidence before deleting or suppressing reported code.
- Keep separate TypeScript configurations for browser, worker, and library environments; do not expose Node or Bun globals to browser packages by default.
- Use Zod for untrusted, persisted, versioned, file, worker, and protocol payloads. Use `is-what` for small runtime-kind narrowing inside those validated boundaries; never treat `isObjectLike<T>` or another shallow predicate as shape validation.
- Prefer explicit package subpath exports. Do not create a generic shared `utils` package until concrete cross-package reuse exists.
- Add Turborepo only after measured task-graph or caching needs justify it.
