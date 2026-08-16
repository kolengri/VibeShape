# Codex agent team

VibeShape keeps a project-scoped Codex team under `.codex/agents/`. The primary agent owns requirements, architecture, delegation, integration, and final decisions. Supporting agents isolate read-heavy investigation, browser evidence, bounded implementation, and review so the primary context stays focused.

The setup follows the official [Codex subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents) rather than relying on prompt-only role simulation.

## Configuration

`.codex/config.toml` enables subagents, caps the session at three concurrent supporting threads, and assigns `gpt-5.6-luna` with medium reasoning as the default for unspecified subagents. This keeps the primary model available for coordination while preventing unbounded parallel work.

`fork_turns` is an execution-time spawn option, not a project configuration field in the current Codex schema. Repository routing rules therefore require `fork_turns = "none"` when the active client supports it and require the primary agent to pass a minimal task packet explicitly.

## Roles

| Agent | Model | Requested sandbox | Use |
| --- | --- | --- | --- |
| `vibeshape_researcher` | `gpt-5.6-luna`, medium | Read-only | Trace code, ADRs, tests, and official documentation for one bounded question. |
| `vibeshape_browser_debugger` | `gpt-5.6-luna`, high | Workspace write | Reproduce UI failures and collect browser, console, network, screenshot, and Playwright evidence without editing source. |
| `vibeshape_coder` | `gpt-5.6-luna`, medium | Workspace write | Implement one isolated slice after boundaries and acceptance criteria are known. |
| `vibeshape_reviewer` | `gpt-5.6-terra`, high | Read-only | Review the real diff for correctness, regressions, security, performance, accessibility, and missing tests. |

## Routing contract

Use subagents only for independent, bounded work. Good candidates include parallel package exploration, documentation verification, browser reproduction, focused test execution, and final diff review. Keep architecture decisions, ambiguous debugging, overlapping edits, destructive operations, GitHub writes, and final acceptance in the primary thread.

For a typical UI regression:

1. The primary agent defines the symptom, scope, and evidence required.
2. `vibeshape_browser_debugger` reproduces the failure while `vibeshape_researcher` maps the owning code paths.
3. The primary agent reconciles both results and delegates one bounded fix to `vibeshape_coder` or implements it directly.
4. `vibeshape_reviewer` reviews the resulting diff while deterministic tests run in a separate non-writing task when useful.
5. The primary agent resolves valid findings, runs the repository verification contract, and owns commit and pull-request actions.

Every delegated task packet must include the objective, relevant paths, applicable ADRs or skills, constraints, expected evidence, and the requested return format. Full parent-history inheritance is prohibited by default because it defeats context isolation.

## Safety and concurrency

- Never run two agents that may edit the same files.
- Do not use `gpt-5.6-sol` for subagents without explicit per-task user approval.
- Subagents inherit the active permission policy, and live parent sandbox overrides can take precedence over a custom agent's requested `sandbox_mode`. A researcher or reviewer is capability-enforced read-only only when the active parent run is also read-only; otherwise its non-editing contract is instruction-enforced.
- Non-editing agents must not modify source, tests, documentation, Git state, or external systems even when the active parent permission mode technically permits writes.
- The browser debugger's workspace-write request allows diagnostic artifacts but does not create an artifact-only filesystem boundary. Its source-code prohibition is instruction-enforced.
- Supporting agents do not commit, push, merge, publish, or send messages unless the primary agent delegates that exact external action.
- The primary agent must inspect returned evidence instead of treating a subagent conclusion as authoritative.

## Local validation

Run Codex from the repository root so the project configuration and custom agents are discovered. Validate the installed client's configuration with:

```bash
codex --strict-config doctor --summary
```

If a client predates custom agents or rejects a documented field, update Codex before weakening the repository contract. Do not copy personal credentials, MCP tokens, or machine-specific paths into `.codex/`.
