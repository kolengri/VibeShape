# ADR-0027: Typed orphan model-reference intent

- Status: **Accepted**
- Date: 2026-08-28
- Extends: [ADR-0026](0026-document-dependency-graph-and-interleaved-history.md)

## Context

ADR-0026 requires every durable document dependency to resolve and blocks deletion while incoming
edges exist. That remains the correct default for ordinary edits and untrusted replay. It does not,
however, support the Onshape-style workflow where a user intentionally deletes a source feature,
keeps downstream sketches in a broken but inspectable state, and later repairs their references.

Representing this state as an ordinary version-0 model reference with a missing feature would make
intentional deletion indistinguishable from corruption. Persisting a feature tombstone would also
retain unrelated feature state after deletion and complicate scheduling, export, and body ownership.

## Decision

Version only the affected external-reference record. A model-backed sketch reference may use inner
`schemaVersion: 1` while retaining its existing `model-point`, `model-line`, `model-curve`, or
`model-intersection` kind, topology reference, projected entity identities, and curve metadata. It
adds this strict marker:

```json
{
  "orphanedSource": {
    "kind": "deleted-feature",
    "featureId": "<the retained topology reference featureId>"
  }
}
```

The marker feature ID must equal the retained topology reference feature ID. A version-1 orphan is
valid only when that feature is absent. It contributes no dependency-graph edge and is always a
direct broken reference; later sketch projections propagate that failure transitively.

Ordinary `org.vibeshape.feature.remove` remains strict. Only the explicit revisioned command
`org.vibeshape.feature.remove-preserving-model-reference-intent` may create orphan references. Its
event is `org.vibeshape.feature.removed-preserving-model-reference-intent` and stores the removed
feature, not a caller-supplied list of affected references. Event reduction deterministically finds
every matching live model reference, upgrades it to version 1, and removes the feature atomically.
Ordinary sketch add and update commands and events cannot introduce or mutate orphan records. They
may preserve an existing orphan, remove it, or replace it only with the canonical repair shape that
retains its stable projected identities and compatible geometry metadata.

The preserve-intent command is allowed only when all incoming dependencies are direct model-backed
sketch references to the feature and the dependency model is complete. Sketch support, extrusion
profile, feature dependency, feature-owned topology reference, semantic input, unknown extension
dependency, and graph failures still block deletion. Replay applies the same fail-closed validation.

Repair may retarget an orphan to another feature when the geometry kind and analytical class remain
compatible. A successful repair emits a normal version-0 live reference, removes the orphan marker,
and preserves reference IDs, projected entity IDs, curve metadata, and compatible constraints. A
live version-0 repair remains restricted to the same producing feature.

The document worker protocol advances to version 14. Orphans are accepted as strict wire records,
produce bounded `broken` health evidence without topology or section probes, and are excluded from
feature scheduling dependencies. Affected branches fail in containment while independent feature
branches continue rebuilding.

## Consequences

- Intentional broken references are distinguishable from malformed version-0 documents.
- Deleted feature records do not remain as document nodes or exported bodies.
- Project files and event journals preserve enough stable identity for deterministic repair.
- History can show a source deletion and downstream repair state without inventing graph edges to a
  missing node.
- Persistence, copying, native-format migration, workers, and automation must recognize the new
  command and event before a UI exposes the action.
- The UI must present this as an explicit destructive choice and list the affected sketches; it must
  not silently substitute this behavior for ordinary Delete.

## Rejected alternatives

### Permit missing version-0 references

This would weaken the corruption boundary for every existing document and make replay intent
ambiguous.

### Keep the deleted feature as a tombstone

A document-wide tombstone would retain more state than repair requires and blur feature, body,
scheduling, and export ownership.

### Store the affected reference list in the event

The reducer can derive the exact set from the pre-event snapshot. Persisting a second caller-owned
list would create a mismatch and tampering surface.

### Cascade-delete downstream sketches and features

Cascade deletion discards repairable design intent and is a separate destructive workflow with a
different confirmation contract.
