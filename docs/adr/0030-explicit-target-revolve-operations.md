# ADR-0030: Explicit-target Revolve operations

- Status: **Accepted**
- Date: 2026-08-31
- Extends: [ADR-0023](0023-explicit-target-extrusion-operations.md) and [ADR-0028](0028-selector-backed-origin-axis-revolve.md)

## Context

ADR-0028 proved exact selector-backed Revolve as a new-body feature while deliberately deferring
merge scope. Add, Remove, and Intersect require the same durable body ownership already accepted for
Extrude: a modifying feature must name one target terminal feature instead of inferring an active
body, a tree predecessor, or the closest intersecting solid.

Widening `org.vibeshape.feature.part-design.revolve#1` in place would change persisted semantics for a
feature type whose accepted contract allows only `operation: "new"`. Older runtimes must continue to
recognize the exact contract they were built to evaluate.

## Decision

Introduce `org.vibeshape.feature.part-design.revolve#2` with operation `new`, `add`, `remove`, or
`intersect`.

- `new` has no body dependency and may retain only the source sketch's distinct support-feature
  dependency.
- `add`, `remove`, and `intersect` declare exactly one target terminal feature as their first ordered
  dependency, followed by the distinct sketch-support feature when one exists.
- The source sketch remains a semantic profile input. Its support `TopoRef` positions the profile but
  does not become body ownership.
- The target is never inferred from presentation state. Create and edit use the same cycle-safe,
  unsuppressed terminal-solid eligibility contract as modifying Extrude.
- Revolve schema version 1 remains registered for read and rebuild compatibility. Editing it writes
  schema version 2 while preserving feature identity, label, profile selector, axis intent, authored
  angle expression, references, and suppression state.

The document worker continues to materialize one exact analytical profile and world-space axis. The
geometry worker independently validates operation-specific dependency cardinality, builds one
disposable revolved tool solid, and applies OCCT Fuse, Cut, or Common to the document-owned target.
Every successful result must remain exactly one valid positive-volume solid. Disjoint Add, empty
Remove, empty Intersect, missing targets, and support/target ordering mismatches fail closed as derived
feature diagnostics.

Prepared feature content retains the operation, while ordered dependency hashes retain target
identity. Preview, persistence-first commit, worker recovery, export, History, and automation continue
through the ordinary feature command and rebuild paths.

Selected stable axes, multi-body merge scope, additional end conditions, stable Revolve output roles,
and sketch support on Revolve-produced faces remain separate gates.

## Consequences

- Revolve and Extrude share one explicit, replayable body-ownership rule without sharing feature
  terminology or parameter schemas.
- A modifying Revolve becomes the terminal feature of its target branch and participates in existing
  viewport, export, deletion, and dependency-cycle behavior.
- Changing the operation or target changes canonical feature inputs and rebuilds the affected branch.
- Existing version-1 Revolve records remain readable without a semantic migration.
- Boolean failure never mutates the committed semantic revision or replaces the last valid derived
  result.

## Rejected alternatives

- **Implicit active body:** editor state is not replayable and is unavailable to automation.
- **Nearest intersecting body:** geometry can become ambiguous or silently retarget after edits.
- **Tree predecessor:** History order is not body ownership and cannot represent safe branching.
- **Target ID inside parameters:** this duplicates the feature DAG and can disagree with ordered
  content hashes.
- **Widen schema version 1:** older runtimes would accept the type identity but reject or misinterpret
  the new operation values.
