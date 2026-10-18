# Local-first persistence and recovery

## Decision

Use three independent layers:

1. **IndexedDB/Dexie** for projects, domain snapshots, event journals, metadata, and small blobs.
2. **OPFS** for large B-Rep and mesh caches plus export staging.
3. **User-controlled `.vshape` files** for portable backups and exchange.

OPFS is not a user document. Clearing site data can remove it. The application must explicitly offer `.vshape` export and show when a project exists only inside browser storage.

## IndexedDB stores

Proposed tables:

- `projects`: ID, name, timestamps, head revision, and dirty/clean marker;
- `projectThumbnails`: document ID, exact semantic revision, generation time, media type, and bounded derived bytes;
- `snapshots`: document ID and revision, schema version, compressed domain state, checksum;
- `events`: document ID and revision/sequence, command or event payload;
- `imports`: source metadata and optional small embedded blob or OPFS key;
- `settings`: local application preferences and printer profiles;
- `recovery`: active transaction markers;
- `cacheIndex`: content hash to OPFS path, size, last access, and engine build;
- `migrations`: applied storage migrations.

SPK-005 implements the original six active stores: `projects`, `snapshots`, `events`, `recovery`, `leases`, and `cacheIndex`. The additive product schema v2 introduces `projectThumbnails` without rewriting existing stores or records. IndexedDB schema v3 adds parallel `projectsV1`, `snapshotsV1`, `eventsV1`, and `recoveryV1` stores for History-bearing documents. Version-0 stores remain unchanged and readable during adoption. Imports, settings, and explicit migration history remain production additions. See [SPK-005 evidence](../spikes/spk-005-local-first.md).

Schema-version-1 promotion is an explicit atomic transaction. It reconstructs and compares the authoritative migrated recovery result, rejects any bounded loss, requires an unchanged legacy head and the active writer lease, stores that exact migrated snapshot and recovery metadata in the v1 tables, and retains migration provenance plus bounded unavailable-record evidence. It does not fabricate v1 events for legacy revisions. New v1 events form a suffix after the promoted snapshot. The first successful v1 commit marks the project `current`; before that, `journal-derived` or `snapshot-derived` identifies how History was recovered. Every v1 write and lease acquisition strictly parses the stored project head and reports corruption instead of replacing it. Once the v1 head exists, every legacy semantic write, import, copy publication, clean close, and deletion path fails closed instead of forking the document. Explicit v1 project deletion removes both generations only after its exact-revision and lease checks pass.

The version-1 adoption boundary uses a compatibility adapter without rewriting the editor session. Existing v1 projects recover through an adapter that projects the authoritative History-bearing
snapshot to the current worker and UI contract while translating new legacy-shaped add events into anchored v1
History insertions. A complete v0 recovery is promoted only after a writer lease is acquired; lease contention or
lossy recovery leaves the legacy project unmodified and read-only. The project-library façade always prefers v1
authority, but can still export a complete unpromoted legacy project while another tab owns its lease.

The current editor then explicitly upgrades a fully recovered, writable V1 project to authored V2 authority.
The upgrade appends one event and retains the preceding journal. Existing version-3 IndexedDB stores hold
strict V1/V2/V3 record variants; no database-version change or destructive rewrite is required. V2 owns the
model, canonical History, stable parts, and organizational folders. Compatibility projections serve the
geometry worker and never replace that authority. Model and metadata commands, including Undo/Redo, persist
one complete authored result with the normal revision and lease checks. Unsupported heads fail closed before
writable recovery. See [ADR-0054](../adr/0054-authored-parts-and-organizational-history-folders.md).

The first texture Apply upgrades V2 to V3 authority while saving the reviewed layer collection in
one revision and transaction. Existing stores retain explicit record variants and the project head
records `textureUpgradeRevision`. Semantic model/metadata writes, recovery, and Undo/Redo retain
complete texture intent; recovery refuses a result before that recorded upgrade boundary. A worker
compatibility projection remains disposable and cannot replace V3 authority.

Native saves use format 3 for V2 parts/folders and format 4 for V3 texture authority, retaining verified
mixed history and original actors. V4 uses format 5 and V5 repair authority uses format 6; the authored
reader accepts formats 0–6. Opening a complete
archive creates fresh document, command, and transaction identities while preserving document-local
feature, part, folder, and texture-layer identities. Read-only checkpoints cannot become writable
copies. Older builds reject unsupported authority before recovery fallback; rolling back the
application must not overwrite or downgrade the current browser database. See
[ADR-0059](../adr/0059-editable-surface-texture-layers.md).

The production repository now also exposes a bounded authoritative local-project summary read, exact-revision project deletion, verified v2 portable-project reads, atomic semantic-copy publication, and atomic imports over both storage generations. Project listing parses every returned head through the strict generation-specific schema, exposes only document ID, name, revision, creation/modification timestamps, latest external-backup time, and an optional exact-revision preview, then sorts deterministically by modification time and fails closed on corrupt semantic records or an unsupported project count. Preview parsing, count, and aggregate bytes are independently bounded; invalid, stale, or unavailable derived records fail open to no preview. Local duplication verifies and replays the complete native or promoted history, remaps document plus globally unique command and transaction identities in the domain, preserves History and entity identities, appends a copy-name event, then publishes the copied legacy prefix, v1 seed/suffix, head snapshot, clean-close metadata, and project record in one transaction with no recovery marker, lease, or external-backup timestamp. An available source preview is copied afterward as best-effort derived work and never changes semantic success. Project deletion rejects stale summaries and any live writer lease, then removes both generations of project heads, events, snapshots, previews, recovery markers, and expired lease in one transaction. Export rereads the authoritative head and complete replay boundary, verifies stored checksums, and refuses corrupt or incomplete history unless it can produce an explicitly evidenced read-only checkpoint archive. Writable import occurs only after `.vshape` validation and complete replay proof. Existing document IDs in either generation fail closed instead of being replaced.

## Commit protocol

The source-asset foundation adds IndexedDB version 4's immutable, digest-addressed `assetBlobs` store.
Document V4 contains typed descriptors and captured output identities; it retains the V2 model and
authored Parts without duplicating imported-body ownership. Byte publication uses the same transaction
as events, snapshot, project head and recovery marker. Undo retains bytes, and format-5 backups include
the full historical asset closure needed by Redo. Source corruption fails closed. Product import
parsers and authoring adapters must use these ports before claiming a complete import workflow.
See [ADR-0062](../adr/0062-durable-source-assets-and-portable-closure.md).

V5 repair authority uses the same IndexedDB stores with strict V5 head, event, snapshot, and recovery
record variants. Explicit retained-History removal atomically adopts older authored authority and
records `repairUpgradeRevision`; texture/source adoption boundaries may share that revision when
their empty collections are introduced in the same event. Recovery cannot fall back before a recorded
adoption boundary. Normal repair and Undo/Redo persist complete repair intent and suspended part
identities, and confirmed authority projections include automatically restored descendants. Format-6
export/import/copy preserves replay proof and the full source closure. See
[ADR-0103](../adr/0103-retained-history-repair-authority.md).

A user command becomes committed only after:

1. Domain validation.
2. One IndexedDB transaction records the event or bounded transaction-tagged event sequence, final snapshot, new head revision, recovery marker, and writer-lease check.
3. The transaction is confirmed.
4. The UI swaps to the new committed state.
5. Derived geometry rebuilds from that saved semantic revision; infrastructure failure remains retryable and does not roll back the document.

OPFS cache writes are independent of semantic atomicity. Publish a cache-index entry only after a complete write and checksum. Orphan cleanup removes unregistered temporary files.

Committed Undo/Redo follows this same protocol. Its event references an earlier revision resolved
from repository-owned verified history; it never decrements the head or deletes newer events.
Recovery and portable replay retain referenced targets, including when stored historical snapshots
are missing or corrupt. Navigation stacks are session-local; saved navigation results remain durable.
See [ADR-0039](../adr/0039-committed-document-undo.md) for the bounds and replay contract.

## Immutable local parts library

`vibeshape-assembly-library` is a separate version-1 IndexedDB/Dexie database. Its mutable item
metadata and head revision use optimistic concurrency; every published version and source blob is
immutable. Publication commits the verified blobs, version and item head in one transaction.
Metadata rename/tag edits do not rewrite historical versions. Reads verify source digests and
bounded canonical definition closure; corrupt, missing, future-version or quota failures return a
diagnostic without partial publication. Search uses local item names and tags.

Library publication does not advance CAD History. Insert, explicit reference update and detach use
one ordinary authored document transaction; inserted pins carry their verified source bytes into
the project database and format-5 historical closure. A portable project therefore rebuilds without
access to the library. See [ADR-0073](../adr/0073-immutable-local-assembly-library.md).

## Autosave

- Debounce for 0.5–2 seconds after a committed command, never after each pointer move.
- Flush on `visibilitychange` and `pagehide` as best effort, but never depend on it for correctness.
- Create a periodic snapshot after N events or M MiB of journal data.
- Write a clean-close marker after the final flush.
- A quota error enters an explicit degraded state and offers `.vshape` export.
- Never use `localStorage` for projects; its size and transaction model are insufficient.

## Recovery

At startup:

1. Find documents without a clean-close marker.
2. Verify snapshot and event checksums.
3. Replay through the last complete event.
4. Open the result as a recovery copy.
5. Rebuild geometry from domain state.
6. Ignore B-Rep cache when build, tolerance, version, or checksum differs.
7. Offer compare, save, or discard.

A corrupted event never destroys the preceding snapshot. A diagnostic bundle may include versions, hashes, and command kinds, but excludes geometry and project names without consent.

### Document-worker recovery handoff

`@vibeshape/document-worker` provides in-process recovery for an active document. Its session retains the latest successfully rebuilt semantic snapshot and mesh policy, replaces a failed worker, increments generation, and rebuilds every native result. It never treats retained meshes or B-Rep state as recovery input.

That memory is intentionally not durable. After a page reload, browser crash, or full application restart, the persistence layer first completes checksum verification and event replay, then passes the recovered committed `DocumentSnapshot` to a new document-worker session. The product document controller implements this handoff without letting the worker write IndexedDB or the persistence package import worker or OCCT code.

## Persistent storage

After the first saved project, the UI MAY call `navigator.storage.persist()` from a user gesture. Denial does not block work; the application explains that the browser may evict best-effort storage.

Display:

- `navigator.storage.estimate()` usage and quota;
- recoverable semantic data and disposable cache separately;
- a Clear Derived Cache action;
- latest `.vshape` export time when it can be determined reliably.

## File System Access as progressive enhancement

When `showOpenFilePicker` and `showSaveFilePicker` are available:

- store handles in IndexedDB only with permission;
- query or request permission during an explicit user action;
- write through staging and close the stream;
- never treat a handle as permanent.

Cross-browser fallback:

- `<input type=file>` or drag and drop for open;
- Blob download for Save As;
- clear messaging when automatic overwrite is unavailable.

The File control offers Save project (.vshape), Open project (.vshape), and the local Projects library.
Native files preserve editable history; 3MF/STEP/STL are separate geometry exports. Open validates a bounded
archive and publishes a fresh copy before activation. File actions reject active drafts, pending persistence,
save errors, or AI work/review, and recheck the active document and revision after asynchronous work. The
library lists exact-revision previews or accessible placeholders, identifies the current project, creates and
opens projects, duplicates verified history, and offers confirmed permanent deletion only for an inactive
project. Switching closes the previous session and rebuilds derived geometry from the selected saved model.
Active-project deletion, silent same-ID restoration, directory mirroring, and persistent file handles remain
outside the implemented file workflow.

Project thumbnails render the complete committed surface mesh through the shared isolated WebGL2
preview renderer, with depth-tested surfaces, one fitted isometric camera, and no tessellation outlines.
New thumbnails are 240 × 160 PNG images bounded to 128 KiB. The image payload validates its media
type, PNG signature, dimensions, and chunk boundaries; the renderer-owned restricted SVG grammar
remains readable for older records. Opening a project regenerates its preview at the current revision,
without a semantic event or storage migration. Stale asynchronous renders are discarded; rendering or
preview persistence failures remain best effort and cannot block the authoritative viewport. Catalog
count and aggregate-byte limits still apply. Model-preview MCP images retain their existing contract.

## Multiple tabs

Alpha allows one writer per document:

- `BroadcastChannel` announces a lease and heartbeat;
- a second tab opens read-only or requests takeover;
- optimistic revision checks prevent lost updates;
- stale leases expire;
- takeover creates a snapshot before writing.

SPK-005 enforces lease owner, epoch, and expiry inside the same transaction as every existing-document commit and clean close. The first creation commit is lease-free because no project exists yet. A former owner cannot commit or remove the recovery marker after takeover.

True multi-writer merge is not simulated and remains P2.

## Service worker and updates

- Precache only versioned application shell, fonts, worker, and WASM.
- Never store project data in Cache Storage.
- Download a new application build alongside the old one.
- Activation incompatible with an open document waits for explicit reload.
- Before reload, save a snapshot or recovery export.
- Rolling back the application shell never rolls back storage schema automatically.
- Migrations are forward-safe; destructive migrations are backup-first.

SPK-005 proves cached-shell offline reopen with a spike-only service worker and records the dirty-document activation decision. A real two-build waiting-worker upgrade remains an installed production release gate; the spike service worker is not the product PWA implementation.

## Backup policy

v1 includes:

- export reminders for projects without an external file copy;
- bulk export of all projects;
- optional mirror to a user-selected directory where File System Access is available;
- no hidden uploads;
- a future sync adapter that is optional, client-side encrypted, and does not change core semantics.

## Browser targets

| Browser | Alpha expectation |
|---|---|
| Chromium desktop | Full baseline, including picker where available |
| Firefox desktop | Core plus OPFS/IndexedDB, with fallback save when picker is unavailable |
| Safari 17+ desktop | Semantic IndexedDB core with fallback save; OPFS is optional until real Safari testing proves it operational |
| Mobile browsers | Best-effort view/export; authoring is not a release gate |

Compatibility is defined by automated and manual test matrices, never by user-agent-only branches.

The recorded Playwright WebKit 26.5 runtime exposes `getDirectory()` but fails to open the OPFS root. Capability probing therefore invokes the API and reports a cache-disabled degraded state rather than relying on method presence.

## Browser project addresses

The web composition layer reads an optional `project` query parameter as a schema-validated document ID before opening a session. Explicit targets override the last-active preference; malformed IDs and missing projects fail visibly without a fallback create. Successful initial activation replaces the current address, while later UI/MCP activation pushes a project address. Browser history navigation invokes the same guarded transition, serializes requests, and restores the actual active address on rejection. URL changes never add document revisions or own editor drafts. The same profile's IndexedDB and existing writer lease remain authoritative; a copied URL is not a cloud-transfer mechanism.
