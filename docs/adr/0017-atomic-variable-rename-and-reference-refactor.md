# ADR-0017: Atomic Variable Rename and Reference Refactor

- Status: Accepted
- Date: 2026-08-09
- Deciders: VibeShape maintainers

## Context

ADR-0015 establishes stable UUIDv7 variable identity and human-readable `#name` references, while intentionally leaving rename/refactor for later. A committed name cannot be edited safely as an ordinary table cell: changing it without updating every dependent expression would temporarily invalidate the document, and blind text replacement could corrupt unrelated identifiers or opaque extension data.

Rename must participate in the same deterministic command, event, persistence, worker-rebuild, and future automation paths as other semantic document changes. It must also remain replayable when a contributing feature runtime is unavailable.

## Decision

VibeShape implements `org.vibeshape.variable.rename` schema version 1 with payload `{ variableId, name }`. The accepted command emits one `org.vibeshape.variable.renamed` event containing the stable variable ID, previous name, and resulting name. The variable UUID, feature UUIDs, presentation order, and unrelated feature fields do not change.

Command handling and event replay perform the same deterministic refactor:

- validate existence, a changed name, and uniqueness before mutation;
- tokenize expressions with the project grammar and replace only exact variable tokens;
- preserve original whitespace, operators, literals, and unrelated references;
- treat `#width_extra` as distinct from `#width`;
- validate the complete resulting variable table;
- traverse nested JSON feature parameters and sketch constraints iteratively and rewrite only objects accepted by the project Quantity schema whose `source.expression` contains the exact token;
- validate every rewritten Quantity, FeatureRecord, and SketchRecord before exposing an event or snapshot;
- reject the entire operation when a rewritten expression exceeds a schema limit or any resulting semantic record is invalid.

Arbitrary strings are never searched or replaced. Core analytical sketch constraints and extension features automatically participate when they store expressions through the project Quantity schema. An extension-specific expression format remains opaque until a future extension contract can declare a bounded, deterministic refactor contribution; the host must fail closed instead of guessing how to rewrite it.

The product Variables table keeps committed names read-only during ordinary table editing. Rename is a separate, explicit row action with its own validation, asynchronous single-flight state, cancel path, stale-revision handling, and preserved input on failure. While rename is active, Apply and conflicting row mutations are disabled. A successful rename is persisted before the document worker receives the resulting snapshot.

## Consequences

- Configurable models can expose readable variable names without using those names as identity.
- One accepted command produces one semantic revision and no intermediate broken state.
- Deterministic replay needs no React, persistence adapter, network access, geometry kernel, or feature runtime.
- A rename that preserves resolved values may reuse existing geometry even though the authored feature source changes.
- Sketch dimensions retain their stable sketch, entity, and constraint identities while their exact authored token changes atomically.
- Extension authors should use project Quantity values for parameter expressions until declared refactor contributions exist.
- Undo/redo can later invert the event by stable ID and the recorded previous name, subject to the ordinary revision policy.

## Verification

Domain tests cover stable identity, dependent-variable, feature Quantity, and sketch-dimension rewrites, referenced-removal protection, exact-token matching, arbitrary-string preservation, source immutability, expression-limit rejection, name conflicts, no-op and missing-variable rejection, deterministic replay, and tampered-event rejection. Component tests cover explicit edit mode, focus, table locking, async double-activation suppression, and cancel/error behavior. Product browser scenarios rename variables driving a persisted Box and a persisted rectangle sketch, verify the authored sources and derived geometry/profile, and reload the document to prove persistence.
