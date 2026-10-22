# ADR-0126: Explicit native assistant project access

- Status: Accepted
- Date: 2026-10-22
- Partially supersedes: [ADR-0115](0115-automatic-native-project-mcp-access.md) for explicit connection after Stop AI

## Context

An embedded agent can complete ACP initialization while its project automation connection is still
unavailable or retains a stopped grant. Showing a usable chat in that state leads to `not-paired`
on the first model read. Connecting an agent is the person's deliberate authorization to work in
that project; requiring a second Enable AI session action contradicts that interaction.

## Decision

An explicit built-in agent connection establishes fresh native project access. Its connection owner
coordinates the ACP lifecycle and project automation readiness rather than depending on the visible
status control to finish pairing. Prompt dispatch must respect that readiness and the current
connection generation. Lazy MCP initialization remains supported through bounded bootstrap reads.

Stop AI still revokes access, cancels pending readiness and persists across reload, discovery,
automatic reconnect and New chat. Only deliberate Connect or Enable AI session can authorize a
fresh grant. Stale connection completions cannot re-enable a stopped or replaced owner. External
MCP clients retain their separate consent policy, and project credentials and document authority
remain isolated. No interrupted prompt or uncertain CAD write is replayed.

## Verification

Cover initial and delayed pairing, explicit reconnection after Stop, automatic startup after Stop,
lazy MCP clients, cancellation during readiness, stale disconnect completions, project isolation,
and absence of prompt dispatch before the connection's applicable readiness condition.
