# ADR-0100: Remembered browser-local MCP preferences

- Status: Accepted
- Date: 2026-10-07
- Supersedes: local consent-reset scope in [ADR-0052](0052-session-cad-auto-apply.md), [ADR-0095](0095-local-mcp-continuous-recovery.md), and [ADR-0097](0097-mcp-project-management.md)
- Preserves: remote OAuth consent and [CAD eligibility](0099-complete-session-cad-auto-apply.md)

## Decision

After a person enables local AI access, remember the approved local client's name/version and
CAD approval mode in browser-origin localStorage. Defaults remain disabled and manual. The preference
contains no token, actor, document data, or project-management permission and never enters a backup.
It applies to projects opened in that browser origin, including fresh browser sessions. Client
metadata limits preference reuse; it is not an authentication credential. Local access retains its
existing same-origin, loopback launcher trust boundary. Remote OAuth consent is unchanged.

Keep authenticated recovery tokens in tab-scoped sessionStorage. Prefer authenticated resume when
its unexpired token matches the live document and approved client. Without usable recovery state,
the remembered client preference allows a fresh local pairing with a new document handle and actor.
Validate the returned client again before applying the remembered mode. A different client requires
explicit approval. Browser storage failures cannot enable a new automatic approval choice.

Fresh local pairing may replace suspended broker authority after validating the new request, but
never displaces an active owner. Replacement invalidates the old token and disposes private work.
Stop AI clears the remembered preference and recovery credential before network revocation; a late
pairing response cannot recreate either. Returning to manual approval persists that choice.
Rejected stale credentials on polling, renewal, or resume allow fresh pairing for the remembered
client. Other terminal protocol/recovery failures stop automatic retries for that connection owner
while retaining the preference for a later browser session or explicit retry.

Project changes release the old captured handle. Local authorized project transitions restore the
remembered CAD mode on the replacement handle. Manual navigation reconnects through the ordinary
status discovery after the destination is ready. Project-management permission remains separate and
is not restored on fresh pairing or recovery. No interrupted operation, draft, review, or export is
replayed; inspect model_info and the saved revision before continuing.

## Verification

Cover fresh browser sessions, reload, manual-mode persistence, Stop races, client replacement,
malformed/unavailable storage, project transitions, and suspended-versus-active broker replacement.
Exercise fresh-session and reload behavior with real browser storage and the MCP adapter.
