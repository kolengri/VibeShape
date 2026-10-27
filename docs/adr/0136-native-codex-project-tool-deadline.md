# ADR-0136: Native Codex Project Tool Deadline

- Status: Accepted
- Date: 2026-10-27
- Extends: [ADR-0135](0135-cad-execution-without-default-deadlines.md) for the built-in Codex client

## Context

Removing server and worker deadlines does not configure the client that waits for tools/call.
The installed Codex 0.160.1 uses a 300-second default. Its numeric zero setting is an immediate
timeout, not a disable sentinel. The built-in chat injects a stable `vs_…` server, so a global
`vibeshape` setting does not apply. The JavaScript `@agentclientprotocol/codex-acp` 2.2.2 adapter
reconstructs standard ACP servers from command, arguments and environment, dropping timeout fields.

## Decision

For the Codex executable, supply the full existing project MCP launch descriptor and a minimum
600-second tool deadline in child-only `CODEX_CONFIG.mcp_servers`. Preserve unrelated configuration,
other server entries and a longer timeout already supplied for this process-local project entry.
The trusted host owns this attachment's transport descriptor; no model input supplies its command.

After initialization verifies the supported adapter identity and version, new and loaded sessions
send an empty standard ACP server list. The verified adapter then retains the complete runtime
configuration instead of replacing it. Other adapters and unknown versions keep their existing
standard ACP injection. Existing project name, descriptor, permission, Stop, resume, model settings
and teardown ownership remain in their current services.

Do not use a dotted timeout sibling alongside a parent `mcp_servers` override: native Codex applies
request overrides from a hash map without a defined order, so a later parent table can erase the
timeout. Normalize any existing dotted overrides for the host-owned project entry into the complete
entry, retaining longer valid timeout values and replacing stale transport fields with the current
descriptor. Unrelated override keys remain unchanged. Do not patch installed adapters or write a global per-project configuration entry, which
would interfere with ordinary injection and outlive its owning desktop attachment.

## Evidence and Consequences

An isolated installed-Codex app-server probe configured a local synthetic MCP tool directly without
any model turn: a 600-second setting completed an 80 ms tool, 0.02 seconds produced a 20 ms timeout,
and zero produced a zero-duration timeout. This verifies native application of the setting without
claiming a measured ten-minute compute run. Adapter source confirms the complete configuration path
is shared by new, load and resume requests.

Tests cover process-local environment merging, project isolation, preserved unrelated settings,
new/load session injection, unverified adapter fallback and failure without secret disclosure.
The operator bundle describes the tested version boundary. Installing a new desktop build and
starting a fresh adapter connection are necessary to change an active client's policy. Other ACP
implementations retain their own deadlines; the server still cannot change arbitrary clients.
