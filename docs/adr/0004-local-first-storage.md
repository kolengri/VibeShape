# ADR-0004: IndexedDB, OPFS, and `.vshape`

- Status: **Accepted**
- Date: 2026-08-07

## Decision

Store semantic snapshots and events transactionally in IndexedDB through Dexie, and store large disposable caches in OPFS. The portable `.vshape` ZIP container is the user-controlled backup and exchange format.

## Consequences

- No mandatory backend is required.
- Browser storage can be cleared, so the UI must distinguish internal saves from file backups.
- File System Access is a progressive enhancement.
- The alpha uses a single-writer lease across tabs.
- SQLite WASM is deferred until a demonstrated need exists.
