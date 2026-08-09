# ADR-0004: IndexedDB, OPFS, and `.vshape`

- Status: **Accepted**
- Date: 2026-08-07

## Decision

Store semantic snapshots and events transactionally in IndexedDB through Dexie, and store large disposable caches in OPFS. The portable `.vshape` ZIP container is the user-controlled backup and exchange format.

The first production implementation uses `.vshape` format version 0 with exactly `manifest.json`, canonical `document.json`, and the complete canonical JSONL event journal. Export verifies persisted checksums and replay before writing. Import verifies bounded ZIP structure, semantic SHA-256 digests, strict schemas, and exact journal-to-snapshot replay before one IndexedDB transaction publishes a new document. A same-ID project is rejected rather than overwritten; migrations, restore/copy policy, and optional entries require later versioned decisions.

## Consequences

- No mandatory backend is required.
- Browser storage can be cleared, so the UI must distinguish internal saves from file backups.
- File System Access is a progressive enhancement.
- The alpha uses a single-writer lease across tabs.
- SQLite WASM is deferred until a demonstrated need exists.

## Evidence

[SPK-005](../spikes/spk-005-local-first.md) validates the decision with strict Dexie schema-v0 records, atomic history and recovery transactions, checksum replay, one-writer lease epochs, disposable OPFS publishing, forced-page recovery, quota rollback, and cached-shell offline reopen across Chromium, Firefox, and WebKit. The recorded WebKit runtime demonstrates the required OPFS-unavailable mode without blocking semantic recovery.
