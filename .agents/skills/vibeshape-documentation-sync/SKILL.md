---
name: vibeshape-documentation-sync
description: Keep VibeShape's English documentation aligned with durable code, package, workflow, schema, architecture, UX, format, performance, and licensing changes. Use after adding or removing workspaces, changing developer commands or public APIs, altering accepted boundaries, updating dependencies or engine versions, or whenever README, AGENTS, ADR, roadmap, risk, or implementation docs may be stale.
---

# VibeShape Documentation Sync

## Update Durable Truth Only

Run a documentation pass when a change affects onboarding, architecture, public package behavior, file or protocol schema, user workflow, release gates, dependency versions, performance budgets, security limits, licensing, or known limitations. Skip one-off implementation detail that does not change how the project is understood or operated.

## Canonical Ownership

| Change | Primary documentation |
|---|---|
| Product scope or capability | `docs/product/` and feature matrix |
| UI behavior or acceptance | design/UX guidelines and UX flows |
| Package or process boundary | architecture docs; ADR when costly to reverse |
| Geometry, solver, or topology | geometry architecture, testing, risks, ADR |
| Persistence or `.vshape` | data model, local-first storage, security, testing |
| STEP, STL, 3MF, print checks | 3D-printing, testing, licensing when relevant |
| Tooling, scripts, versions | technology stack, implementation blueprint, README when onboarding changes |
| Dependency evidence | research sources and licensing matrix |
| Delivery sequence | roadmap and implementation blueprint |
| Repository-wide agent guardrail | concise `AGENTS.md`; detailed procedure in a project skill |

Keep one canonical explanation and link to it elsewhere. Do not duplicate the same rule across several long sections.

## Workflow

1. List the durable facts changed by the implementation.
2. Read the related ADR before editing its consequences.
3. Verify unstable library facts through Context7 and other claims through primary sources.
4. Update the minimum coherent document set, including risks, tests, licensing, and known limitations when affected.
5. Keep documentation, comments, identifiers, examples, commit text, and project skills in English.
6. Check local Markdown links, Cyrillic, trailing whitespace, and `git diff --check`.
7. Use `vibeshape-verify-scope`; docs-only work does not require typecheck unless generated or linted code also changed.

Never rewrite an accepted ADR retroactively. Create a superseding ADR and link both records.
