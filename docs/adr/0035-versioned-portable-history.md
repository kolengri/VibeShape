# ADR-0035: Versioned portable history

- Status: Accepted
- Date: 2026-09-01
- Extends: [ADR-0004](0004-local-first-storage.md), [ADR-0026](0026-document-dependency-graph-and-interleaved-history.md)

## Context

The strict `.vshape` version-1 archive contains a final schema-version-1 document and the complete legacy
schema-version-0 event journal that proves it through replay followed by migration. Once a project is promoted,
new edits use anchored schema-version-1 History events that cannot be represented by that legacy journal.
Changing the version-1 paths or event meaning in place would let an older strict reader mistake an unsupported
authoritative layout for the contract it already understands.

Some recovered projects can have a valid promoted snapshot and a valid versioned suffix even when part of the
legacy prefix is unavailable. A portable backup must distinguish that bounded checkpoint from a complete replayable
history instead of presenting inferred or missing records as authoritative.

## Decision

Introduce `.vshape` format version 2 with exactly five ZIP entries:

- `manifest.json`;
- `document.json`, containing the final `DocumentSnapshotV1`;
- `journal/seed.json`, containing either `null` or the exact promotion/checkpoint snapshot;
- `journal/legacy-prefix.jsonl`, containing strict legacy `DocumentEvent` records;
- `journal/versioned-suffix.jsonl`, containing strict anchored `VersionedDocumentEvent` records.

Every semantic entry declares its exact path, media type, byte length, and SHA-256 digest. The two event streams
share one aggregate 100,000-record limit. Empty streams encode as zero bytes; non-empty streams use canonical JSON
records with one final newline. Readers reject missing, duplicate, undeclared, oversized, malformed, or incorrectly
typed entries before treating their contents as document authority.

Version 2 has two explicit history modes:

- `complete` either replays a native versioned journal from `null`, or replays and migrates the complete legacy
  prefix to canonical equality with the non-null seed before replaying the versioned suffix;
- `checkpoint` requires a non-null seed, an empty legacy prefix, a bounded migration diagnostic, and at least one
  unavailable-record identifier.

Both modes replay the complete versioned suffix through the schema-version-1 reducer and require canonical equality
with `document.json`. Complete mode rejects degraded-recovery evidence. Checkpoint mode never claims that records
before its seed are complete.

Version-0 and version-1 codecs, entry layouts, and readers remain unchanged and fail closed on version-2 archives.
Product import, export, project copy, promotion-on-open, and controller adoption remain separate persistence and
application integration gates.

## Consequences

- A promoted project can retain anchored post-promotion History without weakening the version-1 contract.
- A checkpoint archive remains usable while carrying explicit, bounded evidence that earlier history is unavailable.
- The seed duplicates semantic state by design so replay can prove the promotion boundary independently of the final
  document.
- Import and project-copy code must resolve project, command, and transaction identity collisions explicitly; it
  must not silently overwrite an existing local authority.
- Old readers reject version 2 instead of partially importing a document whose history they cannot interpret.

## Rejected alternatives

- **Extend format version 1 in place:** this changes an accepted strict contract without giving old readers a safe
  dispatch boundary.
- **Store only the final snapshot:** this loses replay proof, History intent, and the distinction between complete
  and degraded recovery.
- **Mix legacy and versioned events in one NDJSON stream:** record meaning and replay seed become implicit, and an
  anchored event can be misclassified by a legacy reader.
- **Treat every recovered snapshot as complete:** this hides bounded data loss and creates false document authority.
