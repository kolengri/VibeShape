# ADR-0016: Persisted Document Session and Rebuild Sequencing

- Status: **Accepted**
- Date: 2026-08-09

## Context

The domain command path, transactional IndexedDB repository, single-writer lease, and document-worker rebuild session were implemented independently. A product session must compose them without making the application layer depend on Dexie, browser workers, or OCCT. It must also define which state remains authoritative when persistence or derived-geometry work fails.

Rebuilding before persistence risks presenting geometry for a revision that can be lost on reload. Treating a worker failure as a failed semantic command risks discarding valid design intent merely because disposable geometry is temporarily unavailable. Conversely, advancing in-memory state after a failed persistence transaction creates an unsaved authority that recovery cannot reproduce.

## Decision

`@vibeshape/application` owns a port-driven persisted document session. The web composition root injects the trusted command dispatcher, project repository, writer-lease adapter, clock, and document-scoped rebuild-session factory. The application package does not import Dexie, OPFS, a browser `Worker`, or the geometry engine.

A new document is reduced through the ordinary create command and atomically committed before acquiring its writer lease. Opening an existing document recovers and validates the latest semantic snapshot first. The session then attempts to acquire the single-writer lease and rebuilds the recovered snapshot in either read-write or read-only mode. Lease contention does not block inspection or geometry rebuild; it blocks mutation and remains visible as a stable diagnostic.

Every mutation is serialized and follows this order:

1. acquire or renew the writer lease;
2. dispatch and validate the ordinary domain command against the current committed snapshot;
3. atomically persist the event, resulting snapshot, project head, and recovery marker;
4. advance the in-memory committed snapshot;
5. rebuild derived geometry from that saved snapshot.

The session also supports bounded multi-command drafts. Every command is dispatched through the trusted registry against the preceding draft snapshot and receives one shared transaction ID. The repository verifies the complete replay, then stores every event plus the final snapshot, project head, and recovery marker in one IndexedDB transaction. Only the final saved revision is rebuilt. A rejected command or failed storage transaction exposes no partial semantic revision.

If command validation or persistence fails, the session does not advance and does not request a rebuild. If infrastructure-level rebuild fails after persistence, the semantic revision remains committed and the session exposes a retryable rebuild diagnostic. Feature-level modeling failures remain normal rebuild records rather than persistence failures. A later retry or reopen rebuilds from semantic state; native shapes and meshes never become authoritative.

A clean close renews the lease, marks the current revision clean, removes the recovery marker, releases the lease, disposes document-owned worker state, and terminates the worker client. An interrupted page leaves the recovery marker intact. Reopening after interruption recovers and rebuilds the same committed revision; reopening after a clean close reports a clean state.

The initial implementation does not add an autosave timer. Each accepted command is saved immediately. Debounced editor buffers and previews remain transient and cannot enter the repository until an ordinary command is committed.

## Consequences

- Page reload and save/reopen rebuilds use one production-oriented application contract rather than coordinating adapters inside React components.
- IndexedDB is the semantic authority before any derived geometry is presented as belonging to a committed revision.
- Temporary OCCT or worker failure cannot erase a valid saved command.
- Lease contention has a useful read-only fallback and can later transition to read-write after a successful acquisition.
- The contract is reusable by future UI, automation, and headless hosts without giving those adapters direct storage authority.
- Autosave scheduling, `.vshape`, persistent derived caches, BroadcastChannel ownership UX, backup workflows, migrations, and installed-build update handling remain separate gates.
