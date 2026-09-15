# ADR-0039: Committed document undo and redo

- Status: Accepted
- Date: 2026-09-05
- Extends: [ADR-0016](0016-persisted-document-session-and-rebuild-sequencing.md),
  [ADR-0026](0026-document-dependency-graph-and-interleaved-history.md), and
  [ADR-0035](0035-versioned-portable-history.md)

## Decision

Committed Undo and Redo are serialized application actions over the versioned document authority.
They renew the writer lease, validate an expected document revision, select a known semantic
checkpoint, persist a compensating event and snapshot atomically, then rebuild the saved revision.
They never decrement a revision, erase a journal suffix, or restore transient worker/viewport state.

The versioned persistence adapter retains a before/after checkpoint for each successful ordinary
commit and one checkpoint for a whole successful draft transaction. Document creation has no undo
entry. A transaction with no net semantic change does not add a checkpoint or clear redo. A
successful semantic edit clears redo. Failed validation, lease acquisition, or persistence does
not move either stack. Rebuild failure after persistence leaves the undo/redo result saved and
retryable.

The first release retains at most 100 checkpoints and a conservative 32 MiB estimate of their
canonical JSON encoded as UTF-16. Oldest entries are evicted first. A single operation exceeding
that checkpoint budget leaves no retained undo entry. The durable journal is independent of this
limit. Stacks reset on document reopen or project switch; **the result of an applied undo remains
saved**, while navigation through the previous session's edits does not survive restart.

The v1-only `org.vibeshape.document.restored` event contains the ordinary event envelope, direction,
and a historical `targetRevision`. It does not duplicate the whole model on every navigation.
The application selects a checkpoint it owns. Persistence resolves the target from its own
checksummed history, independently of the caller's proposed resulting snapshot. Complete portable
replay obtains targets from already replayed revisions; a suffix without its target fails closed.

Reduction requires a separately resolved, validated target with that exact revision. It validates
same-document identity, immutable creation time, strictly historical target revision, current
revision continuity, full dependency/History integrity, and canonical first-party semantic inputs.
Incomplete dependency models and semantic no-ops fail closed. The resulting snapshot uses the
event's fresh revision and update timestamp. Restoring full semantic state preserves interleaved
History and declarations that cannot be recovered from legacy deletion payloads alone.

UI and future automation callers request navigation by direction and expected revision. They do
not receive a generic replace-document command. Legacy v0 journals and reducers remain unchanged;
documents without writable versioned authority cannot use committed undo. The pure domain never
reads storage itself.

Existing v1 persistence transactions store the event without an IndexedDB store migration.
Native v2 archives replay revision references within their verified journal. Copying a journal
preserves revision relationships while assigning fresh document, command, and transaction IDs.
Older readers that do not recognize this event fail closed rather than silently dropping undo.

## UI contract

- The idle model toolbar and command palette expose committed Undo and Redo.
- `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` use sketch draft history while editing a sketch.
- An active sketch or feature task blocks committed navigation; text inputs retain text editing.
- Pending navigation prevents duplicate activation and exposes the shared async button state.
- A save failure leaves navigation retryable. Successful navigation clears transient model selection.

## Verification

Require command, adapter, and session tests for revision monotonicity, transaction grouping,
dependency restoration, no-op transactions, redo truncation, checkpoint bounds, persistence
exceptions, lease loss, rebuild failure, and reopened-state policy. Require native replay/copy
and browser create/edit/delete/undo/redo/reopen coverage, including recovery of a missing or corrupt
historical snapshot from a verified journal. Sketch draft shortcuts keep their existing behavior.

## Consequences

Undo remains reusable by automation without granting storage or kernel access. Referenced history
must remain available: pruning or compaction must preserve every referenced target or introduce a
separately versioned checkpoint representation. Restart-persistent navigation and history compaction
require separate evidence and must preserve the same atomicity and History contracts.
