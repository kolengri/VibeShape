# ADR-0093: Reviewed MCP history navigation

- Status: Accepted
- Date: 2026-10-04
- Related: [ADR-0016](0016-persisted-document-session-and-rebuild-sequencing.md), [ADR-0089](0089-owned-assembly-and-library-mcp-drafts.md)

## Context

The editor already owns bounded Undo/Redo checkpoints and persists a restore event through its session queue, write lease and revision CAS. MCP exposed authored History ordering but could not inspect or navigate these saved-change checkpoints. A headless restore or caller-supplied historical snapshot would bypass the existing document authority and human review.

## Decision

Expose `model_history_state`, `undo_model` and `redo_model` through the shared named local and paired remote contract. Every request carries the current `documentId` and revision; navigation also carries a fresh UUIDv7 `commandId`. Document identity is request context, never authority. Strict result correlation requires that identity, base revision, one new publication revision, command identifier and direction.

The existing persistence adapters add an optional read-only `preview(direction)` seam. It returns an owned clone of the next checkpoint's complete authored authority and runtime projection, including source-asset descriptors and assembly authority. Reading it neither accepts a checkpoint nor writes an event. Browser-only preview rebuilds exact model geometry and, for v4 authority, exact assembly geometry with the repository-owned source closure. Historical snapshots and source bytes never leave through these three tools.

A history proposal captures one actor, request, target and five-minute expiry. It always requests manual browser Apply/Discard, including sessions with CAD auto-apply enabled. The review distinguishes the saved target revision from the new revision that Apply publishes. Invalid saved geometry remains explicit in preview and can be restored through the same ordinary history semantics; an unavailable exact preview fails closed.

After approval, the coordinator rechecks the active document, revision, expiry, cancellation, persisted command identity and canonical complete target. A private controller grant additionally requires the exact visible review in `applying` state, actor/request/draft/preview equality and unchanged complete checkpoint. Only that grant may exclude the automation-busy editor block; all other active editor work remains blocking. It calls the ordinary session history queue/CAS with the captured MCP actor and command identifier. UI Undo/Redo retain their user actor and generated identifiers.

Cancellation or disposal before publication prevents navigation. Once the authorized ordinary publication begins, its actual persistence result owns settlement; cancellation cannot turn a saved restore into a claimed rollback. A stale/forged/unconfirmed receipt is a diagnostic requiring inspection rather than replay. Local and remote transports validate the same result schema, request context and 128 KiB budget.

## Consequences

- Saved Undo/Redo stacks remain session-local and bounded by the existing checkpoint policy. Reopening retains the saved authored state and restore events but starts empty transient stacks.
- A new authored change clears Redo. Rejection, preview, expiry and unavailable history do not change stacks or document revisions.
- No document schema migration, storage replacement, new kernel or arbitrary restore API is introduced.
- Acceptance covers cloned target ownership and stack nonmutation across v1/v2/v4, actor-preserving ordinary restore events, stale same-base target and approval failures, cancellation around publication, strict transport correlation, and real paired MCP native preview/Apply/Discard/reload.
