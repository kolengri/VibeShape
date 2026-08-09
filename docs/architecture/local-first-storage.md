# Local-first persistence and recovery

## Decision

Use three independent layers:

1. **IndexedDB/Dexie** for projects, domain snapshots, event journals, metadata, and small blobs.
2. **OPFS** for large B-Rep and mesh caches plus export staging.
3. **User-controlled `.vshape` files** for portable backups and exchange.

OPFS is not a user document. Clearing site data can remove it. The application must explicitly offer `.vshape` export and show when a project exists only inside browser storage.

## IndexedDB stores

Proposed tables:

- `projects`: ID, name, timestamps, head revision, dirty/clean marker, thumbnail key;
- `snapshots`: document ID and revision, schema version, compressed domain state, checksum;
- `events`: document ID and revision/sequence, command or event payload;
- `imports`: source metadata and optional small embedded blob or OPFS key;
- `settings`: local application preferences and printer profiles;
- `recovery`: active transaction markers;
- `cacheIndex`: content hash to OPFS path, size, last access, and engine build;
- `migrations`: applied storage migrations.

SPK-005 implements the first six active stores: `projects`, `snapshots`, `events`, `recovery`, `leases`, and `cacheIndex`. Imports, settings, and explicit migration history remain production additions. See [SPK-005 evidence](../spikes/spk-005-local-first.md).

## Commit protocol

A user command becomes committed only after:

1. Domain validation.
2. Successful geometry rebuild, or explicit storage of an error-state feature when the UX permits it.
3. One IndexedDB transaction records the event, snapshot, new head revision, recovery marker, and writer-lease check.
4. The transaction is confirmed.
5. The UI swaps to the new committed state.

OPFS cache writes are independent of semantic atomicity. Publish a cache-index entry only after a complete write and checksum. Orphan cleanup removes unregistered temporary files.

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

That memory is intentionally not durable. After a page reload, browser crash, or full application restart, the persistence layer must first complete checksum verification and event replay, then pass the recovered committed `DocumentSnapshot` to a new document-worker session. The session does not write IndexedDB, and the persistence package does not import worker or OCCT code. This handoff is the next product-integration gate.

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
