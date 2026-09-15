# ADR-0042: Exact Automation Draft Application Path

- Status: Accepted
- Date: 2026-09-07
- Related: [ADR-0013](0013-microkernel-modules-and-mcp-automation.md), [ADR-0039](0039-committed-document-undo.md), [ADR-0041](0041-revision-bound-model-measurements.md)

## Decision

Extend the existing automation host and application worker port. A draft is a disposable command
sequence over an identified committed revision. It never becomes an independent persistence
interface or an alternative document authority.

The host retains original validated commands beside its reduced draft events. Commit passes those
commands to the ordinary persistent session, which dispatches them again against its current head.
The versioned persistence adapter translates the transaction into the existing history journal and
records one undo checkpoint. Event-to-command reconstruction is not allowed. The browser adapter must
reject a different active document, stale base, lost write lease, or changed command result before
any write. The first adapter supports an existing open project; creating a browser project remains a
separate ordinary application action.

Exact preview creates a fresh disposable document worker. It must never reuse the committed worker:
successful rebuilds can become that worker's recovery head. A preview returns validated derived
measurement evidence and bounded structured failures through the shared query registry, without raw
meshes, topology graphs, native handles, or arbitrary diagnostics. Preview schema version 2 includes
exact geometry validity and bounded measurements; the former summary-only version does not certify
geometry. Default pages retain ADR-0041's limits and construction-plane exclusion.

Commit evaluates geometry again and rejects failed or blocked evaluations anywhere in the draft,
including outputs beyond the first response page. The host checks the original document revision
before and after asynchronous work and checks expiry at completion. A draft does not become current
merely because its worker succeeded. Its commit still crosses the ordinary atomic persistence port.

The application preview service owns cancellation and worker release. Starting another calculation
cancels its predecessor. Cancellation settles the caller promptly even if a worker never responds;
late results cannot replace a newer result, and every worker is terminated after use. Session and
transport coordinators must connect cancellation, close, disconnection, and revocation to that service.

## Acceptance gates

- Real worker preview and ordinary browser persistence/undo integration, including native reopen.
- Input ownership, original command retention, and equal preview/commit authored intent.
- Current document, revision, lease, expiry, cancellation, and stale-result failure tests.
- Invalid geometry outside bounded output pages prevents the entire commit; corrections can retry.
- No active-worker recovery-head mutation or retained disposable native resources.
- Host-owned review/confirmation and a paired-client round trip before transport exposure.

This decision does not accept a public extension SDK, new persistence schema, or MCP transport. The
adapter-neutral host, disposable worker service, and browser persistence composition are implemented.
The host-owned browser review gate is also implemented. The first paired-client transport subset is
accepted separately in [ADR-0043](0043-local-stdio-mcp-browser-session.md); broader tool coverage remains open.

## Prerequisite evidence

The adapter-neutral host and application service pass 1,643 tests in 200 files, full typechecking,
Biome, Fallow, and production build checks. The real-worker browser fixture passes in Chromium,
Firefox, and WebKit and proves rejection and correction of a geometrically invalid fillet with five
fresh worker lifecycles. Its commit store is deliberately in-memory. Independent review confirms that
this does not establish the ordinary persistent session, writer lease, undo checkpoint, or native
reopen path. The subsequent browser composition below addresses those integration gates.

## Browser persistence composition

`createActiveDocumentAutomationSession` captures the open application session and connects the host
to `PersistentDocumentSession.commitDraft`. The application redispatches retained commands and checks
canonical equality against the expected draft snapshot before calling the repository. The ordinary
versioned adapter owns atomic history storage and one undo checkpoint. No persistence schema or
alternate document authority is introduced.

The controller publishes the committed snapshot and rebuild, releases its pending save state on
typed failures or unexpected rejection, and reflects a lost writer lease in editor eligibility.
Unexpected rejection reports an unconfirmed commit rather than asserting that storage was untouched.
Revision changes cancel private calculations; handle disposal, project change, and page exit close
their ownership scope. Paired-client disconnection and revocation are not implemented by this seam.

The runtime-loaded factory is a trusted internal integration boundary exercised by browser tests.
Its narrow Fallow unused-export suppression documents that dynamic consumer and should disappear
when a static transport composition owns the call. It grants no authenticated client identity or pairing permission. The required review port below
now owns confirmation. A paired real-client round trip keeps this decision proposed.

## Browser composition evidence

Validation passed after the prewrite intent/lease ordering fix:

- `bun run test --maxWorkers=4`: 1,648 tests in 200 files;
- `bun run test:e2e tests/e2e/automation-document-commit.spec.ts tests/e2e/automation-document-cancellation.spec.ts --workers=3`:
  18 cases in one uninterrupted Chromium/Firefox/WebKit run;
- `bun run typecheck`, `bun run format:check`, `bun run lint`, `bun run fallow:audit`, and
  `bun run build`;
- `bun ci --ignore-scripts` and the critical dependency audit. Only existing local workspace links
  changed; no third-party versions or license inventory changed.

The browser matrix proves a two-command draft commits to the real project, appears in the viewport,
undoes in one step, redoes, survives reload, and preserves its transaction, command IDs, and actor in
the replay-validated native backup. Lease takeover and a newer human edit reject the commit. Injected
persistence rejection releases the editor save lock. Deferred real-worker responses settle as failed
before release on handle disposal or a human revision change; late results add no geometry, and the
human edit survives reopening. These tests do not prove paired transport disconnection or revocation.

Independent review found and verified a correction to lease ordering: a mismatched expected snapshot
now fails before lease acquisition or renewal, as well as before history persistence. No actionable
findings remained in this slice. The initial cold-server run had a Firefox dependency-loading failure;
the final uninterrupted matrix above passed. Production chunk-size and dynamic-import warnings remain
performance work, not a release certification.

## Host-owned review application path

Every host configuration must provide a review port. After exact geometry validation, commit sends
a detached actor, parsed original commands, and validated preview to that trusted port. Only an
explicit approved result proceeds; rejected, cancelled, malformed, and thrown results cannot write.
The host rechecks revision and expiry after approval. Its serial queue prevents draft edits while
review is pending, and approval is neither retained nor transferred to a later commit attempt.

The browser provides the port through a single visible review surface owned by the active document
controller's application lifetime. Each connection has a private owner and each request has a fresh
UI identity. The panel shows proposed actions, common dimensions, and bounded exact measurements;
destructive actions use registry-owned confirmation metadata. Apply awaits ordinary persistence,
Discard removes the owned draft, and persistent errors can be dismissed. An unattended review times
out without renewing its draft. Revision changes, cancellation, and disposal release pending review.

The ordinary transaction's own revision publication does not cancel its confirmation. Once persistence
has started, cancellation does not promise rollback. A lost session before persistence yields a
review-cancelled outcome; an unexpected persistence error remains an unconfirmed save. The internal
review surface is not a paired MCP client or a general visual geometry/topology comparison tool.

## Review delivery evidence

- `bun run test --maxWorkers=4`: 1,668 tests in 202 files. Host tests cover approval, rejection,
  cancellation, malformed/thrown decisions, missing review ports, stale/expired approval, retained
  command isolation, and fresh review after a draft edit. Browser-state and component tests cover
  owner/request identity, expiry, pending controls, destructive confirmation, and error dismissal.
- `bun run test:e2e tests/e2e/automation-document-commit.spec.ts tests/e2e/automation-document-cancellation.spec.ts tests/e2e/automation-review.spec.ts tests/e2e/automation-draft-geometry.spec.ts --workers=3`:
  all 33 cases passed in one Chromium/Firefox/WebKit run. They exercise real UI approval, atomic
  persistence/undo/native history, rejection and draft discard, human-edit races, cancellation before
  and after Apply, late private-worker results, and native geometry failure/correction.
- Full workspace typechecks, Biome format/lint, Fallow, production build, English/local-link scans,
  and whitespace checks passed. The existing production chunk-size and dynamic-import warnings remain.

The initial Chromium integration run passed seven cases but timed out in the persistence-rejection
fixture: it attempted another modeling task while the new persistent review error was still open.
The fixture now verifies the unconfirmed-save message and dismisses it before proceeding; the final
33-case run above passed. No product timeout was enlarged. Independent review found no remaining
production-code findings after the lifecycle and UI corrections.

The focused discard/review fixture additionally passed in all three browsers after disabling
screenshot transitions. Visual inspection covered light/dark themes at 1024 pixels, a long client
identity, and a 512 CSS-pixel viewport representing 200% zoom. Apply and Discard remain in view after
scrolling, without horizontal document overflow. These screenshots inspect the review panel; they
do not assert a proposed 3D mesh overlay.

## Local transport follow-up

The local stdio slice now uses this exact application path. Disconnect during an already entered
persistence transaction preserves the applying review until the actual result; it cannot report
cancellation as evidence of rollback. A real browser barrier test holds the ordinary commit after
Apply, disposes the connection, releases it, and verifies the committed features, Undo/Redo, and
native history. [ADR-0043](0043-local-stdio-mcp-browser-session.md) owns the transport policy and limits.
