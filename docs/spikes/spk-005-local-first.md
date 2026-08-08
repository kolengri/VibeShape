# SPK-005: Local-first persistence and recovery

- Status: **Pass — semantic persistence and recovery gate cleared; installed-build update validation remains**
- Recorded: 2026-08-08
- Scope: transactional IndexedDB history, checksum recovery, one-writer leases, disposable OPFS cache, service-worker offline reopen, and progressive storage capabilities

## Decision

Use Dexie over IndexedDB for semantic project state and use OPFS only for disposable derived files. The semantic commit boundary is a single Dexie transaction. A missing or failed OPFS implementation must disable the derived cache without preventing document create, commit, recovery, or export fallback.

The initial persistence contract lives in `@vibeshape/persistence`. Dexie 4.4.4 is the selected adapter. The package depends on the pure domain event reducer, but the domain package remains independent of persistence and browser APIs.

SPK-005 clears the storage and recovery architecture gate required by the feature DAG and extension package work. It does not promote the spike service worker into the product shell or claim that browser-local data is a backup.

## Storage schema v0

Dexie schema version 1 stores versioned v0 records:

| Store | Key | Purpose |
|---|---|---|
| `projects` | `documentId` | Name, head revision, latest snapshot revision, clean-close revision, and backup metadata |
| `snapshots` | `[documentId+revision]` | Strict serialized domain snapshot plus SHA-256 checksum |
| `events` | `[documentId+revision]` | Strict serialized domain event plus SHA-256 checksum and unique command ID |
| `recovery` | `documentId` | Open-session marker and last confirmed revision |
| `leases` | `documentId` | Writer owner, monotonic epoch, and expiry |
| `cacheIndex` | `contentHash` | Verified OPFS path, size, engine build, and access time |

All schemas are strict Zod boundaries. Unknown record fields, unsafe cache paths, malformed identifiers, invalid revisions, and inconsistent event/snapshot relationships fail closed.

The spike writes a snapshot for every command to establish a simple one-revision recovery bound. Production autosave may move to periodic snapshots only after a journal-size policy and equivalent loss-bound tests exist.

## Atomic commit and lease protocol

A commit:

1. validates the input, base snapshot, domain event, and reduced result;
2. serializes and hashes the event and snapshot before opening the IndexedDB transaction;
3. checks the persisted head revision inside the transaction;
4. requires a live matching lease owner and epoch for every existing document;
5. adds the event and snapshot, advances the project head, and updates the recovery marker in one transaction;
6. publishes the committed revision only after Dexie confirms the transaction.

The first document-creation commit has no pre-existing lease. Later commits require one. A stale revision rolls back without leaving a partial event. An expired lease can be taken over only when the latest snapshot equals the current head, and an old owner cannot release, commit, or remove the recovery marker through clean close after the epoch changes.

## Recovery behavior

Recovery searches snapshots from newest to oldest, validates each record and payload checksum, and replays later validated events through the ordinary domain reducer. Stored metadata must match the payload document and revision.

The result is explicit:

- `clean` when no recovery marker exists;
- `recovered` when an unclean session is present and the full head is reconstructed;
- `recovered-with-loss` when corruption prevents replay to the recorded head.

The fixture corrupts the revision-2 snapshot and recovers revision 2 from the revision-1 snapshot plus event 2. It then corrupts event 2 and recovers revision 1 with an exact one-revision loss report. It restores both checksums before the clean-close scenario.

## OPFS cache boundary

Derived-cache writes use a temporary OPFS file, verify its SHA-256 digest, write and verify the final content-addressed file, and publish the IndexedDB cache index only after both checks pass. Temporary and unindexed files are removable orphans. Missing files and engine-build mismatches become cache misses; they do not damage semantic history.

Capability detection invokes `navigator.storage.getDirectory()` rather than treating method presence as proof. The recorded Playwright WebKit 26.5 runtime exposes the method but rejects the root request with a transient platform error. VibeShape therefore reports OPFS as unavailable and continues with IndexedDB. This is the required degraded mode, not a user-agent exception.

## Local evidence

Run:

```bash
bun run persistence:evidence
```

The runner rejects every truthy `CI` environment. No GitHub Actions workflow invokes it. Reports, screenshots, traces, and the HTML report remain ignored under `.artifacts`.

Each browser scenario:

1. installs a spike-only service worker and loads the controlled shell;
2. commits two revisions, leaves the recovery marker dirty, and closes the page;
3. opens a new page in the same browser context and recovers revision 2 with zero loss;
4. proves stale-write rollback and a synthetic `QuotaExceededError` rollback after a transaction write;
5. corrupts snapshot and event checksums to prove full replay and the one-revision loss bound;
6. blocks a second live writer, takes over an expired lease, and rejects the former writer;
7. verifies OPFS publish, read, checksum, and orphan cleanup when the root is operational;
8. cleanly closes revision 2;
9. forces the service worker to reject network fetches and reopens revision 2 from cached application assets and IndexedDB;
10. records picker, quota, persistence, update, and fallback policy decisions.

| Browser runtime | IndexedDB commit/recovery | Forced-page recovery | Offline reopen | OPFS cache | File System Access capability |
|---|---|---|---|---|---|
| Chromium 151.0.7922.34 | Pass | Revision 2, zero loss | Pass | Pass | Available |
| Firefox 153.0 | Pass | Revision 2, zero loss | Pass | Pass | Unavailable; download fallback |
| WebKit 26.5 | Pass | Revision 2, zero loss | Pass | Graceful unavailable state | Unavailable; download fallback |

The network-outage step is injected at the service-worker fetch boundary so the same deterministic test works across the three Playwright engines. It proves the cached-shell fallback and offline IndexedDB reopen path. A release still requires a separately installed production build to be disconnected from the network manually or by platform automation.

## Failure and UX contract

- `QuotaExceededError` maps to a retryable `quota-exceeded` diagnostic that directs the application to offer a recovery export.
- `AbortError` maps to a retryable `transaction-aborted` diagnostic.
- Unknown browser storage failures map to `storage-unavailable` without exposing browser or device details.
- A dirty document defers service-worker activation; a clean application may activate it.
- Persistent storage is requested only after a saved project and from a user gesture.
- `showSaveFilePicker` is capability-selected; Blob download remains the baseline Save As path.
- Internal browser storage is never described as an external backup.

## Known limits and production follow-up

- The committed service worker is a dedicated spike harness. The production PWA shell, versioned asset manifest, update prompt, and two-build migration test are not implemented.
- The update decision function is covered, but a real waiting-worker upgrade with an open dirty document remains an installed-build release gate.
- The quota failure is injected inside a real Dexie transaction; the test does not fill a developer machine's storage allocation.
- The forced-termination scenario closes the browser page after confirmed revision 2. Termination during an in-flight browser process write still needs a fault-injection harness.
- WebKit automation did not provide an operational OPFS root on the recorded machine. Real Safari release testing must confirm whether cache support is available; semantic authoring must remain independent of that result.
- `.vshape` import/export, backup reminders, bulk export, migrations, settings, imports, and user-approved file-handle persistence remain Phase 1 work.
- BroadcastChannel heartbeat and read-only second-tab UX are not part of this package-level spike.
- Storage and recovery performance budgets need representative large semantic projects.

These limits do not change the selected boundary: semantic state is transactional IndexedDB data, OPFS is disposable, and user-controlled files remain the backup and exchange mechanism.
