# ADR-0073: Immutable local assembly library revisions

- Status: Accepted storage and authority contract; staged product integration
- Date: 2026-10-03
- Extends: [ADR-0067](0069-frozen-assembly-source-authority.md),
  [ADR-0060](0062-durable-source-assets-and-portable-closure.md)

## Decision

Reusable library items live in a separate local IndexedDB database through Dexie. Its version-1
stores are item metadata, immutable numbered revisions, and content-addressed source bytes. This
does not migrate document storage or make library availability a document recovery dependency.
Each revision captures one typed frozen assembly definition, its complete semantic dependency
closure, stable source producer/output identities and exact source descriptor closure. Exact,
triangle-mesh and imported planar sketch sources retain their original representations.

Item names and up to 32 tags are mutable searchable metadata. Optimistic `metadataRevision`
advances on every metadata or version publication; it serializes concurrent tabs inside the same
read/write transaction. Numbered content revisions advance independently and old revisions are
never overwritten. Item and revision records use strict versioned Zod schemas. A library is bounded
to 10,000 items, 1024 revisions per item, 16 MiB canonical UTF-8 definition records and 64 MiB unique
source-byte closures; existing frozen-node and per-asset budgets also apply.

Publication copies caller-owned semantic content and bytes before asynchronous work. SHA-256
verifies every supplied byte blob and checksums the complete canonical revision content. Required
existing blobs are also reverified before immutable bytes, revision and item head commit together
in one IndexedDB transaction. WebCrypto inside a live transaction uses `Dexie.waitFor`. Invalid
closure, mismatched digest, stale metadata revision, quota failure and aborted publication leave
all three stores unchanged. Reading a revision revalidates strict records, its canonical checksum
and every required source byte. Returned buffers belong to the caller. A future library database
version rejects explicitly; Dexie's same-schema compatibility fallback does not authorize an older
runtime to read or write newer library authority.

The checksum proves stored semantic and byte integrity. It does not prove a Part source's claimed
native content hash. Saving inspected geometry and rendering inserted sources require the existing
worker boundary to rebuild frozen semantic intent and verify that claim.

## Document insertion and references

`definition.insert-pinned` carries a fully validated frozen definition with a caller-captured new
definition UUID and pin revision 1. `definition.relink-pinned` replaces explicit frozen source
intent at the existing definition UUID and advances its pin revision exactly once. Existing
occurrence IDs and joints survive a relink. Source producer UUIDs and selected output roles remain
inside the original frozen model; they are not rebound to current document features or native
enumeration order. Foreign pins can coexist with later edited live producers because rebuilding
uses an isolated immutable closure.

Both mutations merge their source descriptors into the document's own immutable asset authority.
Matching descriptors are reused; changed descriptors, reused asset/output identities and collisions
with live document records reject atomically. The document persistence transaction receives the
library's verified source bytes and commits them with ordinary events, snapshot and head. Historical
insertions and relinks remain in the full asset closure after Undo or removal. Portable V4 backup
and native project copy retain these frozen definitions, provenance and historical source bytes.

An optional `libraryBinding` contains exactly an item UUID and a numbered version. Omitting it
inserts a copy; including it records a reference pinned to that version. Neither mode follows a
new library revision automatically. Explicit relink selects new frozen content and binding.
`definition.detach-library` removes only the binding while retaining source intent and pin revision.
A live-source `definition.relink` captures new document sources and clears the previous binding.
Existing V4 authority has no binding default, and historical V2 contracts remain unchanged.

## Evidence boundary

Schema and command fixtures cover exact source closure, foreign producer preservation, explicit
relink/detach, identity drift, invalid atomic rejection, replay, Undo/Redo, native copy and portable
historical byte retention. Low-level Chromium, Firefox and WebKit fixtures exercise real IndexedDB
publication, restart, concurrent stale writes, injected quota rollback, checksum/byte corruption,
missing closure, bounded name/tag search and future-version rejection.

Library UI, inspected save workflows and browser document publication are separate integration
gates. This storage module does not imply shared/cloud libraries, automatic reference updates,
editable feature-subgraph extraction or physical fit.
