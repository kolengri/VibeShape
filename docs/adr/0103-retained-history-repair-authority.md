# ADR-0103: Retained History repair authority

- Status: Accepted
- Date: 2026-10-07
- Supersedes the deletion restrictions in [ADR-0026](0026-document-dependency-graph-and-interleaved-history.md) and [ADR-0027](0027-typed-orphan-model-reference-intent.md) for the new explicit History removal command
- Extends: [ADR-0035](0035-versioned-portable-history.md), [ADR-0054](0054-authored-parts-and-organizational-history-folders.md), [ADR-0062](0062-durable-source-assets-and-portable-closure.md)

## Context

Removing a History source must preserve downstream operations so their inputs can be repaired through
ordinary forms. Missing IDs in existing snapshot versions mean corruption, and cannot safely represent
intentional detachment. Feature inputs, sketch support, and external sketch references must fail before
geometry evaluation, while independent branches remain usable.

## Decision

Introduce strict document authority V5. It retains the V4 model, textures, source assets, and assembly,
and adds bounded typed `repairIntents` and `suspendedParts`. Published V0–V4 schemas remain unchanged.
The revisioned command `org.vibeshape.history.remove-retaining-dependents` removes exactly one sketch
or feature and deterministically detaches its affected authored descendant closure in one event.
Its schema-5 event is `org.vibeshape.history.removed-retaining-dependents`.

Each repair intent keeps the original authored feature or sketch record and its unavailable input
nodes. The active feature becomes the first-party `org.vibeshape.feature.history.missing-input`
sentinel: it retains surviving feature dependency edges, clears topology and semantic inputs, and fails
before feature handlers, content hashes, caches, or kernel work. A detached sketch clears support,
external references, entities, and constraints in its active projection. Its original record remains
editor input; the persisted session refuses to solve the disconnected committed sketch. Descendants
remain unavailable and independent branches continue evaluating.

An explicit typed `org.vibeshape.history.repair` command removes that item's repair marker, even when a repaired empty sketch matches its disconnected active projection. Its event captures the validated authored record and Part allocations. Metadata-only rename or suppression preserves the retained recipe. A legacy update with genuinely changed recipe inputs also clears its matching marker. The reducer then
restores other authored descendants in History order whenever all their original inputs are available
and the complete graph and part ownership validate. Users need repair only genuinely missing inputs.
Suspended parts retain their UUID, name, visibility, and body history while their authored root remains
available for repair; deleting that root discards its suspension. Restoration reuses retained identities.
Deletion prunes only the deleted item's folder membership and feature-owned texture layers.

The removal event may atomically adopt V2, V3, or V4 into V5. Subsequent writes use a V5 authored-event
envelope around strict earlier authored commands. Undo and Redo retain V5 authority, lifting earlier
verified targets rather than downgrading. Persistence stores explicit texture, source, and repair
adoption revisions; recovery and replay refuse historical authority fallback across these boundaries.

Native archive format 6 preserves V5 snapshots, the complete mixed-version journal, adoption boundaries,
and the exact historical source-asset closure. Writable import and copy require strict checksum and replay
proof. Copies remap document, command, and transaction identities while retaining local History and part
identities. Older format readers reject unsupported format 6; formats 0–5 keep their published contracts.

The older strict removal and model-reference orphan commands retain their contracts, including existing
MCP adapters. Editor availability does not advertise this new command through MCP.

## Consequences

- Disconnected authored intent is explicit, bounded, durable, undoable, and repairable.
- Compatibility projections remain disposable evaluation inputs and cannot replace V5 authority.
- Restoring a direct input also restores valid descendants atomically without allocating new part IDs.
- Older runtimes must refuse V5 authority and format 6 instead of overwriting or downgrading them.
- Tests cover dependency isolation, normal repair, identity preservation, replay, Undo/Redo, write failure,
  checksums, malformed adoption provenance, and writable portable round trips.

## Alternatives

Relaxing old graph parsers would conflate corruption with intentional deletion. Cascading deletion would
discard repairable intent. Persisting deleted source tombstones would retain unrelated source state and
blur ownership. Typed V5 repair authority preserves intent while keeping each active graph strict.
