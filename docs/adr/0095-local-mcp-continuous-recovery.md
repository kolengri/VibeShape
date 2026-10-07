# ADR-0095: Continuous recovery of approved local MCP sessions

- Status: Accepted
- Local commit execution deadline superseded by [ADR-0099](0099-complete-session-cad-auto-apply.md).
- Local browser preference scope superseded by [ADR-0100](0100-remembered-local-mcp-preferences.md).
- Date: 2026-10-04
- Supersedes: local recovery limits in [ADR-0075](0075-local-mcp-tab-reload-recovery.md) and the local disconnect grant reset in [ADR-0052](0052-session-cad-auto-apply.md)
- Preserves: remote consent in [ADR-0058](0058-remote-mcp-paired-browser-transport.md)

## Decision

Recover an already approved local client and document after a transient HTTP failure, tab reload,
owner remount, background pause or restart of its local bridge. Manual pairing and CAD review remain
the defaults. The browser retains a tab-scoped recovery credential and the user's explicit CAD
auto-apply choice in sessionStorage; neither enters a project backup or localStorage. A recovered
handle restores only that recorded choice for the same document and approved client.

The launcher saves a bounded recovery record in a private, current-user-owned directory at
`~/.local/state/vibeshape/local-mcp/<port>.json`. The file has mode 0600 and the directory has mode
0700; linked, publicly accessible and malformed records cannot grant access. A private
`VIBESHAPE_LOCAL_RECOVERY_DIRECTORY` can isolate test or launcher state. Bearer credentials never
enter logs or URLs. The origin, document, original local launcher trust boundary and client
metadata must match. Self-reported client metadata alone is not an identity credential.

The bridge starts restored sessions suspended. Tool access requires an authenticated resume from
the live document tab. A 15-second liveness gap suspends execution without deleting approved
recovery state. A suspended credential expires after its remaining one-hour lease; an active tab
renews its lease before expiry. Stop AI, a changed document, changed client or absolute expiry
clear recovery authority. No access is granted merely because a process started.

## Delivery and uncertainty

Retry only unchanged poll and result envelopes. The broker recognizes the previous poll sequence
with its exact payload and the last accepted result digest. It never runs a CAD operation twice
because an HTTP acknowledgement was lost. Resume rotates the bearer token and actor. A receipt
retains the previous credential within the approval lease until the browser adopts the rotated
credential through an authenticated poll or renewal. It permits retry of a lost resume response
and explicit revocation, while old polls/results remain unauthorized. Checkpoint transitions before
publishing their authorization; storage failure ends in-memory access. Invalidate the durable record
before removing it, and report failure if durable revocation cannot be confirmed.
Stop AI remains available while an approved connection is recovering. If a manual opt-out cannot
be saved in browser storage, end pairing rather than retaining the previous automatic grant.

Disconnect and cancellation settle interrupted work as uncertain, dispose draft resources and
retain no pending operation across recovery. There is no automatic replay of a draft, review,
export or write. The agent must inspect the saved revision before retrying. A transaction already
accepted by persistence may finish; recovery cannot undo it. Manual-only operations remain manual,
including metadata, deletion, History and surface texture proposals.

Heartbeat identity is read directly from the captured active document session. It does not project
measurements or validate derived mesh buffers on the browser main thread. Model inspection retains
its existing complete validation and revision checks.

## Verification

Test lost delivery acknowledgements, resume rotation/retry, process restart, idle suspension,
active renewal, explicit revocation, client/document isolation and private-file boundaries. Exercise
reload and bridge restart with the real MCP SDK and browser, including preservation of an explicit
auto-apply grant and absence of replay. Remote OAuth behavior is unchanged.

Durable process-restart recovery uses POSIX owner and mode enforcement on macOS and Linux. Windows keeps in-process recovery without writing credentials until an owner-only ACL store is available.
