# ADR-0058: OAuth-protected remote MCP for explicitly paired browser tabs

- Status: Accepted with reduced scope; deployment verification remains gated
- Date: 2026-10-03
- Extends: [ADR-0043](0043-local-stdio-mcp-browser-session.md), [ADR-0052](0052-session-cad-auto-apply.md)

## Decision

Add `apps/remote-mcp`, an HTTPS Streamable HTTP MCP adapter on Cloudflare Workers with SQLite
Durable Objects. Keep the existing Bun/stdio adapter. Both transports reuse the same typed tool
inputs, outputs, descriptions, annotations and browser command executor. The remote tool vocabulary
matches the local tools except `export_model`; bounded remote file resources remain a separate gate.
The hosted editor's ordinary manual file exports remain available.

The browser continues to own the project, exact geometry workers, disposable drafts, review,
revision checks, persistence and Undo. The service does not evaluate scripts, own CAD documents,
read the project library or introduce another command engine. `automation-api/remote-session`
owns the narrow browser transport schema; no browser package imports the MCP SDK or Cloudflare API.

Use the official `@cloudflare/workers-oauth-provider` 1.2.1 for OAuth authorization code flow,
S256 PKCE, resource binding, registered redirect validation and browser-bound one-use consent.
Use the existing `@modelcontextprotocol/sdk` 1.30.0 Web Standards HTTP transport. Do not reimplement
OAuth cryptography. Disable Client ID Metadata Documents, private-use redirects, token exchange,
refresh tokens and remembered consent. Access tokens expire after 15 minutes. Pair again for a
fresh grant. The per-tab admission record expires after one hour and cannot be revived.

## Pairing and consent

1. The person opens **Remote AI** in the exact editor tab and completes a Turnstile challenge.
   The Worker verifies success, the configured editor hostname and `vibeshape-pair` action before
   allocating a per-tab object. Missing challenge configuration fails closed.
2. The service issues a random in-memory browser credential and a separate random pairing locator.
   The browser authenticates its hibernating WebSocket with a first message, receives acknowledgement,
   and displays the pairing code. Neither credential is placed in a URL, storage or a project file.
3. The MCP client follows standard OAuth discovery and registration. Its authorization page displays
   its claimed name and exact return hostname, then accepts the pairing code in a POST form.
   The SDK checks the browser-bound, one-use consent transaction before any tab approval request.
4. The exact paired editor shows the client and return URI. **Allow this client** grants one OAuth
   client for that tab. Names are untrusted display data. Approval never enables auto-apply.
5. Every authenticated tool call checks the live object, exact session and OAuth client, then sends
   a schema-validated operation to that browser's existing automation handle. Manual Apply and the
   browser-only, session-scoped auto-apply policy from ADR-0052 remain authoritative.

An authenticated editor origin is an origin restriction, not a user identity. Turnstile is an
admission defense, not account authentication. This is explicitly shared capability access to one
browser-owned tab; it does not claim account, organization or persistent multi-client authorization.

## Isolation and failure invariants

- One admitted per-tab object, one authenticated browser WebSocket and one explicitly approved client.
  Initialization is one-use. Server-generated session IDs prevent caller-selected session fixation.
- The service retains only expiry, token hash, actor/client identity, admission counters and bounded
  request markers. It never persists CAD operations, results, geometry, project contents or prompts.
  The OAuth SDK's KV holds its own bounded, expiring consent/client/grant/token records.
- Browser revocation disposes the handle and auto-apply grant before awaiting a network acknowledgement.
  Disconnect, page exit, project changes and connection failure close the session. The service checks
  the live object on every request even while an OAuth token remains cryptographically valid.
- Each call is single-flight and revision validation stays in the existing host. Each MCP request ID
  can dispatch once per session; the bounded ledger is never evicted to allow old requests to run again.
  A lost response reports an uncertain outcome. The client must inspect the current revision after
  fresh pairing. An already accepted ordinary persistence transaction may finish and remains undoable.
- A Durable Object restart with an active request marker revokes the session. Idle WebSocket hibernation
  can retain an approved connection; closing the browser does not recreate a handle or auto-apply grant.
  There is no automatic reconnect, durable job queue or write replay.
- Exact configured HTTPS origins, strict redirect metadata, host-only SDK consent cookies, origin
  checks, frame denial, no-referrer/no-store responses and payload budgets constrain CSRF and leaks.
  Browser and OAuth credentials have separate audiences. No wildcard CORS or arbitrary metadata fetch.

## Free-plan admission boundary

An unauthenticated request reaches a coarse per-IP limiter before OAuth KV or per-tab routing.
One fixed admission object serializes UTC-day budgets for client registration, consent creation,
token requests and challenge attempts. Unknown session locators cannot allocate per-tab objects.
The initial personal limits are configurable, not a product user ceiling. Higher limits must satisfy
the conservative OAuth write reservation and need an explicit capacity/deployment decision.

Turnstile is required for tab allocation. Public DCR remains bounded for standard MCP clients.
A distributed attacker can exhaust its small daily registration budget; legitimate requests then
fail closed. This availability limitation blocks claiming scalable public onboarding. Account-backed
admission or a separately approved registration policy is needed before that product claim.

The service uses WebSocket Hibernation with no idle polling or heartbeat loop. Free quotas can still
be exhausted by incoming requests, authorized workload or abuse. A Free account must be verified by
the deployment owner; the code neither purchases a plan nor guarantees uptime or CPU headroom.

See [Remote MCP operation and limits](../remote-mcp.md) for configuration, budgets and open gates.
