# ADR-0119: Explicit recovery of private CAD intent

- Status: Accepted
- Date: 2026-10-20
- Supersedes: the unconditional private CAD intent discard in
  [ADR-0095](0095-local-mcp-continuous-recovery.md)
- Preserves: authenticated recovery, actor rotation, uncertain-write reconciliation and ordinary
  preview/review/commit authority

## Decision

Retain a bounded semantic command journal outside disposable document automation handles during a
transient local connection interruption. Dispose the old handle and revoke its actor normally.
Retention conveys no authority to the replacement actor and does not retain geometry, render ports,
review approval, export buffers or a pending persistence request.

The connection owns this journal only in the current tab's memory. Authenticated resume must match
the captured document, approved client and previous bearer lineage before the journal becomes
available. Retain at most four complete journals, each with at most 64 commands, within a combined
128 KiB serialized budget and the original draft expiry. Reject incomplete or oversized capture
without retaining a partial command sequence. Stop, explicit disconnect, revocation, client or
project replacement and expiry clear the owner and invalidate late captures. Reload and application
restart do not preserve these journals. Remote sessions receive no tab-memory recovery grant.

Cancellation and queued capture settle commands already accepted by the host before publishing a
journal. Reconcile the current committed revision after resume: an already committed or stale base
must not become a recoverable private draft. A transaction accepted by persistence may still finish;
neither capture nor restore retries or reverses it.

## Public contract

`list_recoverable_drafts` accepts no operation arguments. Its revision-bound result lists recovery
IDs, original draft IDs, exact committed bases, private revisions, command counts, expiry and ordered
semantic intent. Public intent contains command kind, schema version and payload, without the old
actor, command IDs or credentials. The existing optional project guard still applies.

`restore_draft` accepts a listed `recoveryId` and exact `baseRevision`. Explicit restoration creates
a new private draft and new command IDs attributed to the current actor. It validates and applies
the complete intent through the ordinary dispatcher and authority preflight in isolated private
state. Failure publishes no partial draft. The response names the current-actor attribution and
the new draft state; the original journal and its attribution remain private.

Restoration reacquires existing committed source assets through the current project's authority.
Missing descriptors, bytes, ownership or a materialization port reject the whole restoration and
leave the journal available for inspection. Binary uploads, source bytes and separate assembly or
metadata proposals are not retained in this CAD command journal.

Restoration is not a saved change or review approval. The client must inspect the saved model and
reconcile uncertain outcomes first, then deliberately adopt compatible intent, preview it and use
the existing reviewed `commit_draft` path. Never restore or repeat a write whose saved outcome is
unknown. Connected assistants should also commit small, usable validated milestones frequently;
memory recovery is not a substitute for durable checkpoints.

## Consequences and verification

This retains recoverable work across a transient authenticated reconnect without keeping revoked
actors alive or silently changing historical command attribution. It adds a bounded memory owner
and an explicit adoption operation. Browser reload, expiry, overflow, unavailable source assets
or a changed saved base can still make private work unavailable; committed stages remain durable.

Tests cover queued accepted work and disposal, exact identity and base checks, new attribution and
IDs, atomic failure, command and byte limits, expiry, late capture invalidation, repeated reconnects,
Stop/project/client isolation, broker result ownership and absence of persistent-write replay.
