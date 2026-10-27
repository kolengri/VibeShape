# ADR-0062: Durable source assets and portable closure

- Status: Accepted architecture; staged product integration
- Date: 2026-10-03
- Local geometry/resource admission policy partially superseded by [ADR-0134](0134-local-geometry-resource-policy.md)
- Extends: [ADR-0004](0004-local-first-storage.md), [ADR-0035](0035-versioned-portable-history.md), [ADR-0054](0054-authored-parts-and-organizational-history-folders.md)

## Context

Imported source data must remain available after browser restart, Undo, Redo and native-file transfer.
Disposable geometry caches cannot provide this authority. Embedding large byte arrays in every snapshot
or event would duplicate immutable content, while publishing bytes separately from the semantic head
could leave a committed import without its rebuild source after quota failure.

The published V3 document with surface texture layers and format-4 archive are existing contracts. Expanding either in place would
allow older readers or writers to mistake unsupported imported intent for their known authority.

## Decision

Introduce document authority V4 through an explicit captured N-to-N+1 upgrade event. The upgrade
retains the V3 model, authored Parts, History folders and surface texture layers and initializes the new `assets` collection empty.
V0, V1, V2 and published V3 snapshot and event payloads remain unchanged. Compatibility projections are read-only;
older event versions cannot mutate V4 without an explicit V4 authored-change envelope. Sources on V2 are promoted through an empty texture V3 boundary before V4 in the same transaction.

An asset descriptor has its own UUIDv7 identity, SHA-256 content digest, bounded byte length, safe
filename, source format, representation, millimeter normalization record and captured UUIDv7 output
identities. STEP/B-Rep descriptors represent exact solids; STL/3MF/OBJ represent triangle meshes;
SVG/DXF represent sketch curves. A mesh cannot become an exact solid by changing a display label.
Source output identity is authored provenance and never an OCCT enumeration index. Imported features
bind to descriptors and ordinary authored Parts remain the owner of selectable bodies; there is no
parallel imported-body ownership collection.

IndexedDB version 4 adds a content-addressed `assetBlobs` store. Inputs are copied and SHA-256 verified
before publication. The active writer lease and exact semantic revision protect one transaction that
publishes verified source bytes, events, snapshot, project head and recovery marker together. Missing
bytes, digest mismatch, stale revision and quota failure expose no partial semantic revision. Existing
digest records are verified rather than replaced. Recovery verifies required current source bytes and
rejects missing or corrupt data instead of presenting incomplete authority as a successful fallback.

Undo restores descriptors with the complete V4 snapshot and retains their immutable bytes. A source
UUID cannot be reused with a changed descriptor after Undo. Automatic blob deletion is deferred until
a separately reviewed reachability policy can account for every document and historical target.

Native format 5 uses minimum reader version 5 and retains the mixed replayable journal. Its exact
entry whitelist extends the existing four semantic files with `assets/<sha256>.bin` entries declared
in the manifest. The source closure includes the seed, final snapshot and every asset-add event, even
when Undo removed that asset from the current snapshot. Every digest, byte length, semantic checksum,
upgrade boundary and final replay result is verified before atomic local import. Checkpoints remain
explicitly read-only. A missing historical source cannot be silently omitted from a complete backup.

The source limit is 32 MiB per asset, 1024 descriptor/output identities per bounded collection, and
64 MiB of prepared source bytes per publication. Native ZIP limits retain the 32 MiB archive and
64 MiB expanded budget, safe paths and compression-ratio checks; format 5 permits up to 1029 entries.
Resource-limit failures remain explicit and do not relax the archive policy.

## Consequences and evidence

- Source assets are semantic dependencies; solved sketches, meshes and native shapes remain disposable.
- The foundation does not imply that file parsers, import authoring, assemblies or library UI are
  integrated. Those capabilities must use the same revision-safe commands and byte publication port.
- Domain tests cover explicit upgrades, immutable identities, mixed replay, copying and restoration.
- Format tests cover full historical closure, SHA-256, missing/undeclared/traversal entries and older readers.
- Chromium, Firefox and WebKit evidence covers version-3 database migration, quota rollback after
  byte/event writes, stale and mismatched publication, restart, native transfer, historical Redo and
  rejection of corrupt source bytes or unsupported authority heads.
