# ADR-0115: Automatic Native Project MCP Access

- Status: Accepted
- Date: 2026-10-19
- Partially superseded by: [ADR-0126](0126-explicit-native-assistant-project-access.md) for explicit connection after Stop AI
- Partially superseded by: [ADR-0116](0116-connected-assistant-model-authority-and-checkpoints.md) for built-in chat model-write authorization
- Partially supersedes: [ADR-0111](0111-native-project-assistant-and-handoffs.md) for embedded ACP
  pairing; [ADR-0100](0100-remembered-local-mcp-preferences.md) for native project preference scope

## Context

The embedded assistant already receives a private MCP attachment for its selected project. Requiring
a second browser pairing action leaves an apparently connected assistant unable to inspect that
project. Reusing the external server name can also hide its tools: an ACP adapter may discard an
injected name found in any provider configuration layer, including a disabled entry.

## Decision

Connecting the configured embedded ACP agent authorizes read and proposal tools for that project's
private attachment by default. The native project owner selects this policy explicitly through the
existing local automation connection. Generic local, development HTTP, copied external desktop,
and remote clients retain their existing pairing and consent rules.
The native host supplies matching initialization instructions describing its automatic project
scope, approval policy, and Stop behavior; the adapter's default external instructions stay manual.

The first `model_info` call on a never-paired native attachment may wait up to five seconds for the
ordinary renderer discovery and pairing handshake. This bridges agents that initialize MCP lazily
when their first prompt arrives. It grants no authority: timeout, cancellation, client release,
and service closure end the wait. After any prior grant or revocation, unpaired calls fail
immediately. Writes, previews, and exports are never deferred across a future grant or replayed.

Use a bounded internal server name derived from the complete project identity. Keep it stable
across reconnect and ACP resume, distinct for projects sharing a UUIDv7 timestamp, and separate from
the external `vibeshape` configuration name. The full private descriptor and project-bound broker
remain authoritative; the abbreviated name is neither a credential nor a project selector. Do not
read or rewrite the person's provider configuration to enable the embedded attachment.

Native approval preferences are scoped per project, separate from external client preferences.
Fresh native access uses manual Apply. Only an explicitly chosen existing approval mode can enable
its supported auto-apply scope. Exact preview, revision checks, actor ownership, cancellation,
background project authority, and the ordinary reviewed commit path remain unchanged. Embedded
attachments cannot grant project management.

Explicit Stop AI clears recovery and approval preferences, revokes the credential, and records a
project-scoped disabled preference. Discovery, reload, and owner recreation cannot silently undo
Stop. Unreadable or malformed native access preferences keep automatic access disabled. Explicit
Enable AI session clears that preference. Disconnecting ACP alone tears down its
process; reconnecting it retains the native access policy. No interrupted operation is replayed.

## Verification

Cover injected ACP parameters with a disabled external `vibeshape` configuration entry, distinct
projects sharing a UUIDv7 prefix, stable resumed names, and unchanged private descriptors. Cover
fresh native `model_info` without Enable, default manual review, isolated approval preferences,
external manual pairing, Stop across recreation, and late automatic grants racing Stop. Preserve
ordinary exact-preview and Apply integration coverage.
