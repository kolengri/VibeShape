---
name: vibeshape-documentation-sync
description: Keep VibeShape's English documentation and MCP operator skills aligned with durable code, package, workflow, schema, architecture, UX, format, performance, and licensing changes. Use after adding or removing workspaces, changing developer commands or public APIs, changing MCP tools/resources or behavior available to agents, altering accepted boundaries, updating dependencies or engine versions, or whenever README, AGENTS, ADR, roadmap, risk, or implementation docs may be stale.
---

# VibeShape Documentation Sync

## Update Durable Truth Only

Run a documentation pass when a change affects onboarding, architecture, public package behavior, file or protocol schema, user workflow, release gates, dependency versions, performance budgets, security limits, licensing, or known limitations. Skip one-off implementation detail that does not change how the project is understood or operated.

## Canonical Ownership

| Change | Primary documentation |
|---|---|
| Product scope or capability | `docs/product/` and feature matrix |
| MCP tools/resources, exposed CAD behavior, or agent workflow | Operator skills under `.agents/skills/vibeshape-{use,modeling,inspection,organization,export}`, bundled data, and affected MCP guides |
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
6. Check local Markdown links, Cyrillic, trailing whitespace, and `git diff --check`. For project skills, `bun run skills:validate` checks local file and Markdown anchor targets across all skill entrypoints and references; external URLs remain a separate evidence check.
7. Use `vibeshape-verify-scope`; docs-only work does not require typecheck unless generated or linted code also changed.

Never rewrite an accepted ADR retroactively. Create a superseding ADR and link both records.

## Synchronize MCP Operator Skills

Apply this workflow when adding, changing, or removing a tool/resource, changing behavior reachable through an existing MCP tool, or altering units, revisions, selection, review, recovery, errors, limits, or transport availability. An internal refactor with unchanged operator behavior does not require instruction churn.

1. Compare the changed contract with the actual advertised schemas, tool descriptions, and local/remote adapter behavior. A capability in the editor is not necessarily exposed through MCP.
2. Update the affected operator skill or conditional reference in the same task. Correct capability/unsupported lists, construction recipes, target selection, safety boundaries, and delivery steps as relevant. Keep live schemas authoritative; do not copy the entire tool catalog into every skill.
3. Update the local authoring guide, remote guide, or canonical automation documentation when its claims change. For a distinct new operator workflow, add a skill only when the existing owners do not cover it; include it in the bundle registry and adjust affected discovery tests.
4. After operator Markdown changes, run `bun run skills:bundle`, include the generated `packages/automation-api/src/generated/agent-skills.json` in the same commit, then run `bun run skills:validate`. Do not edit generated JSON by hand. Developer-only skill edits do not require bundle regeneration.
5. Check that the prose matches the changed capability and available transport, and use `vibeshape-verify-scope` for the affected schema/adapter/packaging checks. `skills:validate` detects stale generated data, not missing or incorrect explanations of new behavior. If existing instructions already cover the change, state that reason instead of making cosmetic edits.

See [the operator skill pack](../../../docs/agent-skills.md) for runtime discovery, file ownership, and installation.
