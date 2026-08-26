# ADR-0026: Document Dependency Graph and Interleaved History

- Status: Accepted
- Date: 2026-08-21
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md),
  [ADR-0012](0012-capability-based-extension-platform.md),
  [ADR-0019](0019-selector-backed-new-body-extrusion.md),
  [ADR-0024](0024-stable-planar-face-sketch-support.md), and
  [ADR-0025](0025-first-class-offset-datum-planes.md)

## Context

The feature DAG currently schedules B-Rep features and preserves a separate presentation order. Sketches
are stored in another array and participate through command-specific rules: extrusion reads a sketch
profile, a sketch may use a feature face as support, and an external point may use an earlier sketch.
Deletion protection and validation therefore scan different record fields in different reducers. No one
graph can answer which sketches and features are upstream, downstream, or eligible at a history position.

An Onshape-style workflow needs one user-readable sequence containing sketches, reference geometry, and
modeling features. That sequence must not replace the accepted feature DAG. Body ownership, B-Rep inputs,
sketch semantic inputs, and presentation order have different meanings.

Persisting an interleaved array is also a format migration, not an additive UI preference. VibeShape
requires a portable snapshot to equal deterministic replay of its complete event journal. Local recovery
may start from a later snapshot and replay only a suffix. Deriving history only while parsing the final
snapshot could therefore make portable import, recovery, and replay produce different canonical data.

Unavailable extension feature parameters must remain opaque and preserved. A graph cannot discover a
hidden sketch reference by executing a missing handler or inspecting arbitrary JSON heuristically. Allowing
deletion or reorder without a durable declaration could corrupt an extension-owned feature.

## Decision

### Two related graphs retain separate authority

Add a pure `DocumentDependencyGraph` in `@vibeshape/domain` with typed nodes:

```text
DocumentNodeRef
  sketch: SketchId
  feature: FeatureId
```

Edges point from source to consumer and carry a typed relation, initially:

- feature dependency;
- feature topology reference;
- extrusion profile;
- sketch support;
- external sketch reference.

The document graph owns whole-document dependency validation, cross-kind cycle detection, incoming-edge
deletion blockers, parent/child queries, history-order validation, and dirty-root discovery. It remains
independent of React, Three.js, persistence, worker implementations, and native geometry.

The existing `FeatureGraph` remains the B-Rep evaluator and body-input scheduler. The document graph may
project affected feature IDs into its dirty roots, but it does not change body ownership, dependency-slot
order, feature content identity, or terminal-body traversal.

Multiple semantic relations may connect the same source and consumer. Public edge inspection retains those
relations, while evaluation adjacency deduplicates the node pair.

### Dependencies come only from durable declarations

The graph reads stable typed record fields. It never scans arbitrary feature parameter JSON for values that
look like IDs and never relies on executable handlers being installed merely to preserve document integrity.

Current first-party records have deterministic legacy projections:

- `FeatureRecord.dependencies` and `FeatureRecord.references` declare feature sources;
- Extrusion's schema-backed profile selector declares its source sketch;
- a sketch support `TopoRef` declares its source feature;
- an external sketch reference declares its source sketch.

Before third-party feature history mutations are enabled, the next feature-record schema adds a bounded,
schema-validated semantic-input declaration for non-B-Rep document nodes. An installed feature handler MUST
cross-check that declaration against its validated parameters. An unavailable handler leaves the declaration
intact and inspectable.

Schema version 1 defines the declaration precisely: `[]` means that the feature has no additional semantic
document inputs, a non-empty array is the complete set of declared inputs, and `null` means that the dependency
model is unavailable or incomplete. `null` is therefore preserved for legacy extension features and keeps
dependency-sensitive mutations fail-closed; it is not equivalent to an empty declaration.

A legacy or unavailable feature without a complete semantic-input model may be opened in the existing
restricted, non-destructive mode. History reorder, cross-kind deletion, or another mutation that requires
dependency completeness fails closed with an `unavailable-dependency-model` diagnostic. Metadata inspection,
unchanged archive export, and independent safe operations remain available.

### Interleaved History is presentation with a dependency invariant

The next document schema stores a bounded `HistoryItemRef[]`. Each current sketch and feature appears exactly
once. Origins remain a fixed virtual group and are not repeated as document records.

History order is user-readable presentation order and the insertion/rollback boundary. It is valid only when
every dependency source appears before its consumer. The document graph still computes a deterministic
topological evaluation order, using History order as the stable tie-breaker for independent nodes.

The rollback cursor is transient editor state. A committed add or reorder records the resulting semantic
History order through an ordinary revisioned command and event. Visibility remains presentation state;
suppression remains an explicit semantic feature operation.

### Migration and replay are one versioned operation

`DocumentSnapshot` schema version 1 introduces History and the durable semantic-input declaration. Version 0
remains a distinct readable input schema; it is not silently reinterpreted as version 1 by a field default.

Migration is pure, bounded, idempotent, and does not emit a synthetic user command:

1. When a complete legacy event journal is available, add-event order derives the interleaved History. The
   migrated final snapshot and migration-aware full replay use the same derivation.
2. Local recovery attempts to load and verify the complete legacy event prefix for History derivation even
   when semantic recovery starts from a later valid snapshot and replays only a suffix.
3. When the complete verified event prefix is unavailable, corrupt, or inconsistent with the selected valid
   snapshot, migration uses a stable snapshot-topological merge of feature dependencies, sketch supports,
   extrusion profiles, and external references. Existing sketch and feature array order is the final
   tie-breaker. This fallback also covers genuinely snapshot-only archives. The result is labeled as
   `snapshot-derived` degraded recovery in diagnostics so callers do not mistake inferred presentation order
   for recovered journal order.
4. Impossible, cyclic, missing, or incomplete graphs fail migration. Migration never retargets a reference,
   changes body ownership, or guesses an extension dependency.
5. New add/reorder event schemas carry stable History insertion intent. Replay validates the complete History
   after every candidate reduction.

Portable import compares the migrated snapshot with migration-aware replay whenever the archive contains a
complete verified journal. Persistence stores schema-version-1 records only after the complete migration
transaction succeeds; a failed migration never overwrites the source archive, selected recovery snapshot, or
old records. A snapshot-derived recovery remains explicitly marked until a successful schema-version-1 save
commits the inferred History.

### Incremental delivery boundary

Implementation proceeds in integrity-first slices:

1. Add the pure document graph, schemas, diagnostics, deterministic order, and focused tests without changing
   persistence, worker protocols, or product behavior.
2. Invoke the graph after candidate command reduction and during replay; replace command-specific deletion
   scans and project sketch changes into feature dirty roots.
3. Add the multi-version snapshot/event migration, old-format fixtures, persistence recovery, `.vshape`
   round-trip, and interleaved History commands.
4. Expose History, rollback, dependency inspection, and insertion workflows in the UI.

The pure schema and migration foundation from step 3 is implemented. It keeps the strict schema-version-0
snapshot and feature parsers as compatibility APIs, adds strict schema-version-1 records, and provides a bounded
pure migration with verified full-journal replay and an explicit snapshot-derived degraded fallback. Persistence,
portable-format, command, and application adoption remain separate transactions so an unsuccessful integration
cannot overwrite legacy data.

The graph is not treated as authoritative for deletion, reorder, scheduling, or UI eligibility until the
corresponding integration slice and its migration tests are complete.

## Failure and resource contract

- Duplicate, missing, self, forward, and cyclic references fail with stable bounded diagnostics.
- Diagnostic paths identify the owning history item or durable record field without exposing raw exceptions.
- Node, edge, issue, and cycle-report limits are explicit before allocation-intensive traversal.
- An ambiguous or missing `TopoRef` remains a rebuild/reference failure; the graph validates ownership and
  ordering, not geometric resolution.
- Independent branches remain inspectable when one branch fails.

## Verification

The implementation requires:

- pure graph tests for every relation, duplicate/missing/self/forward/cycle failures, deterministic ordering,
  and parent/child queries;
- command and replay tests proving graph validation on add, update, remove, suppression, and tampered events;
- sketch and feature deletion tests using graph-owned incoming edges;
- dirty-propagation tests from sketches through dependent features while preserving independent cache reuse;
- full-journal, late-snapshot-plus-suffix, and snapshot-only v0 migration fixtures;
- missing, corrupt, and snapshot-inconsistent journal-prefix recovery fixtures that exercise the explicitly
  degraded snapshot-derived path;
- migration idempotence and canonical byte equality;
- persistence recovery, interrupted migration, document copy, and `.vshape` import/export round-trips;
- restricted-mode fixtures for unavailable feature dependency models;
- Fallow and the domain/public-consumer verification scope for every implementation slice.

## Consequences

- Sketch and feature relationships become inspectable through one pure authority.
- The product can add History and rollback without making array position the evaluation source of truth.
- Existing feature evaluation, body ownership, topology identity, and worker isolation stay intact.
- Schema/event migration work is larger but cannot be skipped without risking unrecoverable or non-replayable
  projects.
- Extension features gain an explicit compatibility responsibility for semantic document inputs.
- The first implementation slice is intentionally non-user-visible until command, persistence, and UI gates
  are satisfied.

## Rejected alternatives

- **Replace the feature DAG with History order:** presentation cannot safely express B-Rep dependency slots,
  independent branches, or body ownership.
- **Add optional History to schema version 0:** snapshot parsing and journal replay could produce different
  canonical documents.
- **Derive History only from the latest snapshot:** separate arrays have already lost sketch/feature
  interleaving, and late-snapshot recovery could disagree with full replay.
- **Discover extension references by running handlers:** unavailable code would make document integrity and
  safe deletion depend on execution.
- **Scan opaque JSON for IDs:** string resemblance is not a typed semantic contract and can create false
  dependencies or miss encoded ones.
- **Keep command-specific dependency scans:** they cannot prove cross-kind acyclicity, complete deletion
  protection, or general dirty propagation.
