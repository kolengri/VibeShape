# ADR-0040: Selected-edge Fillet and Chamfer

- Status: Accepted
- Date: 2026-09-05
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md) and
  [ADR-0038](0038-all-edge-fillet-and-chamfer.md)

## Contract

Extend the existing Part Design owner with Fillet and Chamfer schema version 2. Each operation
consumes one single-solid target and 1–256 ordinary `EdgeTopoRef` records in `FeatureRecord.references`.
The size parameters retain the existing Quantity and variable semantics. Version 1 continues to mean
all edges; existing records are never implicitly migrated to a selected set. Repeated durable
selections are invalid. UI and automation use the same feature command and content identity.

Selected references are resolved against the exact dependency's current topology using the existing
pure domain resolver through an application-owned resolution port injected by the document-worker
composition root. The geometry adapter stays independent of domain; it acquires exact edges only
from the resolved candidate IDs in its owned snapshot. The adapter caches topology annotations and
native acquisition keys with the owned shape. A candidate ID and native edge hash are valid only
inside that evaluation. Missing, ambiguous, duplicate, or hash-colliding native selections fail
closed before building. The operation must preserve its source and release native temporary objects
on success and failure.

Primitive and supported extrusion semantic roles follow upstream parameter edits. Other outputs use
the existing conservative signature and lineage policy. This decision does not invent lineage for
Boolean or treatment outputs and does not promise that every upstream topology change can be repaired
automatically. A lost selection remains authored intent until the user explicitly changes it.

## Interaction and derived display

The feature task owns an explicit all-edge or selected-edge scope and a disposable selected set.
The viewport shares the existing geometry reference picker, including hover, overlapping-candidate
choice, and keyboard access. Selected source edges remain highlighted during the exact result
preview. The task lists retained references and identifies missing or ambiguous ones; removing a
broken reference and choosing its replacement is an explicit edit. Apply persists one command and
one committed undo step. Cancel discards the complete task.

Geometry protocol 13 and document protocol 18 add optional bounded edge display polylines to derived
topology candidates. These points support picking of analytical and non-analytical edges without
pretending that tessellation edges have CAD identity. The approximation is disposable, has at most
1,025 points per edge and 65,536 points per feature, and is omitted when sampling cannot satisfy its bounds. It is never persisted
as a topology reference or consumed by exact modeling. Existing analytical reference geometry remains
separate and exact. All adapters strip derived display fields before strict domain validation.

## Required evidence

- v1 compatibility and v2 cardinality, reference ownership, duplicate, variable, dependency, and
  content-identity tests;
- versioned edit/replay/native backup, undo, and reopening with selected intent;
- real OCCT invariants for one and multiple selected edges, differing dimensions, missing or
  ambiguous references, unchanged source after failure, and released native objects;
- graphical selection, explicit repair, keyboard access, preview/Apply/Cancel, and both themes;
- bounded sampling and protocol validation, with no derived fields leaking into durable references.

Tangent-chain controls, variable radius, asymmetric chamfers, independently addressable constituent
solids, and generalized body selection remain separate increments. They must not change version 2's
explicit reference-set meaning silently.

## Implementation evidence

The ordinary document worker and the dedicated geometry spike compose the same application resolver.
Real-kernel cases verify single- and two-edge fillet volumes, equal-distance chamfer volume, source
preservation after rejected intent, and zero retained shapes after disposal. Domain/application tests
cover missing, ambiguous, wrong-input, duplicate, and bounded selection cases. Browser workflows cover
graphical and keyboard selection, explicit replacement on a congruent target, both treatment types,
upstream dimension changes, undo/redo, Cancel, reopen, and replay-validated native backup. Legacy
all-edge workflows remain in the regression matrix. Exact non-analytical modeling does not depend on
the adaptive display approximation; unsupported or over-budget display geometry is omitted.
