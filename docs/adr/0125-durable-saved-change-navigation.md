# ADR-0125: Durable saved-change navigation and atomic batch restore

- Status: Accepted
- Date: 2026-10-21
- Supersedes: the session-local navigation retention/reopen decisions in [ADR-0039](../adr/0039-committed-document-undo.md) and [ADR-0093](../adr/0093-reviewed-mcp-history-navigation.md)

## Context

Agents need to restore the state before a batch of saved edits with one reviewed operation. A chain of individual Undo requests repeats preview and persistence and may stop partway through. The editor already retains a verified event journal in IndexedDB, but its ordinary navigation stacks held full snapshots in memory, were limited to 100 entries and 32 MiB, and were discarded on reopen.

## Decision

Persist compact before/after publication-revision references for ordinary Undo/Redo alongside the existing project head. Publish stack changes in the same IndexedDB transaction as the model event sequence, snapshot, head and recovery metadata. A failed transaction changes neither the saved model nor its navigation state. Reuse the verified historical journal and snapshot resolver instead of storing a second full copy of every model in a dedicated history database.

Restore the saved navigation references when reopening a project. Load exact historical target authority asynchronously on demand, validating existing checksums and replay boundaries. Keep a bounded cache of full snapshots; its 32 MiB estimated serialized-size budget evicts cached values, not durable navigation references. There is no fixed step-count limit. Browser storage quota, existing document/journal validation limits, explicit project deletion and supported import/copy boundaries still apply.

The optional field is additive in the existing project-record schema and needs no new IndexedDB store. Older strict builds may reject project metadata containing this field; downgrade compatibility is not promised. Older projects without explicit saved navigation metadata begin with empty navigation stacks. Do not infer publication ownership or whole-transaction boundaries from ambiguous historical event identifiers. Internal assistant turn checkpoints retain their actor-bound lifetime, pinned snapshot budgets and intervening-edit invalidation rules; durable ordinary navigation does not grant an assistant ownership of another actor's changes.

Extend the existing `undo_model` and `redo_model` contracts with optional `targetRevision`. Omission retains one-step behavior. A supplied revision must select an existing checkpoint in the requested direction. Capture the revision before an edit batch and use it as the Undo target. Preview and revalidate the complete selected authority, then publish one ordinary restore event at a new monotonically increasing revision. Move all crossed navigation entries only after successful persistence, preserving ordinary single-step Redo ordering. A new successful authored change clears Redo; semantic no-ops do not create entries or clear it.

Batch restore includes every intervening save, regardless of actor. It is not selective reversion. The tool cannot accept a raw historical snapshot, script, native topology index or approval flag. Existing exact-preview, actor, document, command identity, expiry, cancellation, write lease and revision-CAS rules remain authoritative. External MCP clients retain manual Apply/Discard, including CAD auto-apply sessions; built-in connected assistants use their host-selected connected model authority.

## Consequences

- Ordinary Undo/Redo survives reload and application restart for publications with saved navigation metadata.
- Large histories retain compact references while exact old states are loaded only when needed.
- Batch restore uses one preview, one saved restore publication and one rebuild rather than a partially completed sequence of writes.
- Quota, corrupted or missing history targets, stale revisions and rejected reviews fail without fabricating navigation or overwriting another saved head. Recovery with bounded loss disables navigation metadata rather than applying pointers to a different recovered head.
- Persistent browser storage can reduce automatic eviction risk but does not remove quota or replace external backups.
- Acceptance covers whole-draft grouping, no-op behavior, multi-step Undo/Redo, memory-cache misses, reopen/recovery, authority upgrades, failed/quota writes, corrupted targets, local/remote contract correlation and actual browser preview/commit/reload.
