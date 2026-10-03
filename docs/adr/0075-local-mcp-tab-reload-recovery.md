# ADR-0075: Authenticated local MCP recovery after a tab reload

- Status: Accepted
- Date: 2026-10-03
- Supersedes: the local page-exit revocation rule in [ADR-0043](0043-local-stdio-mcp-browser-session.md)
- Preserves: remote transport rules in [ADR-0058](0058-remote-mcp-paired-browser-transport.md)

## Decision

A previously paired local editor may resume the same document after reload in the same tab.
At page exit, the browser disposes its automation handle, aborts pending execution, resets
its auto-apply grant, and sends an authenticated keepalive suspend request. A strict,
short-lived resume record containing the document ID, bearer token, original expiry, and
60-second recovery deadline lives only in sessionStorage. It is removed on successful
recovery, Stop AI, failed recovery, or expiry; it never enters project files or localStorage.
If storage is unavailable, page exit retains the former immediate-revocation behavior.

The bridge suspends tool access for at most 60 seconds, capped by the existing one-hour
session expiry. Resume requires the current bearer token and the identical document ID.
It rotates the token, replaces the broker pair, creates a new actor and browser handle,
and resets poll sequencing without extending expiry. Late requests from the former pair
cannot revoke or mutate the new one. MCP-client changes still revoke the session.

Any pending request settles with an uncertain-outcome diagnostic. No operation, draft,
review, export resource or auto-apply authorization is carried over or replayed. After an
uncertain write, the agent must inspect the saved revision before deciding what to do next.
Stop AI and project changes revoke access. A closed tab cannot retain tool access while
suspended; its token expires after the bounded grace period. A lost suspend request leaves
the existing 15-second liveness deadline in force, so recovery may require manual pairing.

## Boundaries and verification

This changes local stdio transport only, including its prepared static editor distribution.
Remote OAuth sessions still require fresh pairing and exact client consent after reload.
There is no automatic reconnect after arbitrary network failures or expired access.

Broker tests cover authenticated suspension, interrupted requests, no replay, token rotation,
document isolation, unchanged expiry and revoked/expired credentials. Browser lifecycle tests
cover fresh-instance restoration, delayed document readiness, explicit revocation, malformed
storage and recovery expiry. Real-client browser verification checks reload and a subsequent
model_info read, with auto-apply off.
