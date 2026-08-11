# ADR-0021: Worker-owned transient sketch draft solving

- Status: Accepted
- Date: 2026-08-11

## Context

Interactive sketch authoring needs solved coordinates, degrees of freedom, constraint conflicts, and closed profiles after every meaningful draft change. Committing each pointer move, entity placement, constraint, or dimension to the semantic document would create history noise, persist incomplete geometry, and make Cancel impossible. Solving drafts on the main thread would duplicate SolveSpace ownership and allow first-party UI, extensions, and future MCP automation to observe different behavior.

The document worker already owns the exact reviewed SolveSpace runtime and the last successfully rebuilt semantic snapshot. A transient solve must reuse that runtime while remaining bound to the exact document revision and worker generation.

## Decision

Document protocol version 6 extends `solveSketch` with an optional complete `draftSketch` record. The request remains bound to one exact rebuilt document ID, semantic revision, and worker generation. When present, the draft ID MUST equal the requested sketch ID. The worker resolves variables from the committed snapshot but compiles and solves the supplied draft instead of the committed sketch with that identity.

The draft:

- is validated by the same bounded sketch schema as persisted records;
- is never inserted into worker document state, IndexedDB, event history, `.vshape`, rebuild caches, or feature evaluation;
- may represent a new sketch whose ID is not yet present in the committed snapshot;
- produces the ordinary solved stable-ID response, including status, degrees of freedom, conflicts, residual, exact solver build, and deterministic profile result;
- is discarded after the request settles.

The main-thread sketch editor owns authored transient state and local undo/redo while a sketch command is active. Geometry tools call pure `@vibeshape/domain/sketch-edit` operations so first-party UI, extensions, and future automation can share the same semantic mutations. Live solves are debounced and stale responses are ignored. `Finish sketch` remains the only persistence boundary and uses the ordinary revisioned add or update command under ADR-0016.

Solved coordinates may drive display and drag continuation, but they never replace authored entity records implicitly. Stable profile selectors are derived from boundary entity IDs rather than response-local profile indices.

## Consequences

- Drawing, dragging, constraining, dimensioning, undo, redo, and Cancel do not create semantic revisions.
- A new unsaved sketch receives production solver and profile diagnostics before its first commit.
- Worker replacement still rebuilds only committed semantic state; the editor resends its current draft after recovery.
- UI, extensions, and future MCP tools can share one schema-backed preview behavior without receiving native solver handles.
- Protocol version 6 is incompatible with version 5 clients and workers; the existing exact-version handshake fails closed.
- Command-level document undo/redo remains separate from active-sketch draft undo/redo.

## Rejected alternatives

- **Commit every edit:** creates noisy history, persists invalid intermediate geometry, and breaks Cancel.
- **Keep a mutable draft inside the worker:** makes recovery and ownership ambiguous and risks treating transient state as authoritative.
- **Solve on the main thread:** duplicates native-runtime ownership and can block pointer interaction.
- **Send incremental native-style operations:** couples the protocol to solver handles and complicates deterministic validation and recovery.
- **Persist solved coordinates:** turns disposable derived state into document authority and breaks variable-driven intent.
