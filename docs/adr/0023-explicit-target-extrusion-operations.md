# ADR-0023: Explicit-target extrusion operations

- Status: Accepted
- Date: 2026-08-16
- Extends: [ADR-0019](0019-selector-backed-new-body-extrusion.md)

## Context

ADR-0019 deliberately limited selector-backed extrusion to a new body until body ownership and target selection had durable semantics. Add, remove, and intersect cannot safely infer a target from feature-tree order, current selection, a transient viewport body, or an implicit active-body flag. Those sources are presentation state and would make rebuild, replay, automation, and extension behavior ambiguous.

The existing feature DAG already owns exact ordered B-Rep dependencies and terminal-body derivation. Reusing that contract keeps modifying extrusion inside the ordinary command, hashing, worker, persistence, and future MCP paths.

## Decision

Introduce `org.vibeshape.feature.part-design.extrusion#2` with operation `new`, `add`, `remove`, or `intersect`.

- `new` declares no feature dependency and returns the exact profile prism as a new terminal body.
- `add`, `remove`, and `intersect` declare exactly one dependency: the target body's current terminal feature.
- The sketch profile remains a stable semantic `SketchProfileSelector`, not a feature dependency.
- The target is never inferred from tree order, viewport selection, or mutable application state.
- The domain feature handler validates the operation/dependency invariant before a command can commit.
- Schema-version-1 extrusion remains registered for read and rebuild compatibility. Editing it writes schema version 2 while preserving the feature ID, label, selector, authored distance expression, symmetric state, references, and suppression state.

The document worker resolves the same selector-backed analytical profile content for every operation. Prepared content and the ordered target content hash participate in canonical feature identity. The geometry worker validates the same dependency cardinality independently, constructs one disposable exact prism, and applies OCCT Fuse, Cut, or Common to the document-owned target shape. The prism, builders, progress ranges, and returned native shapes retain lexical ownership. Every successful result must still be one valid positive-volume solid; disjoint add, empty remove, and empty intersect fail closed as invalid feature geometry.

The product form exposes `New body`, `Add to body`, `Remove from body`, and `Intersect with body`. A target field appears only for a modifying operation. Creation offers unsuppressed terminal first-party solid features. Editing also retains its current target as a valid option and excludes the edited feature plus transitive dependents that would create a cycle. The state-agnostic panel remains separate from its TanStack Form adapter, and asynchronous submission keeps the shared single-flight behavior.

This decision keeps one profile selector per extrusion. Selecting several disjoint profiles in one feature and interactive unsaved B-Rep preview remain separate gates because they require explicit multi-body result and transient evaluation contracts.

## Consequences

- Body ownership is explicit, persisted, deterministic, and available to automation without UI state.
- A modifying extrusion becomes the new terminal feature for its target branch, so export and viewport terminal filtering need no special case.
- Updating the target or operation changes canonical inputs and rebuilds the affected DAG branch.
- Old new-body documents remain readable without rewriting persisted history.
- Branching from the same earlier target remains representable; each branch has an independent terminal result.
- Boolean failures are contained as ordinary derived diagnostics and do not alter the committed semantic revision.

## Rejected alternatives

- **Implicit active body:** presentation state is not replayable and is unavailable to headless automation.
- **Nearest or intersecting body:** geometric heuristics become ambiguous as the model changes and can silently retarget intent.
- **Tree predecessor as target:** presentation order is not body ownership and prevents safe branching.
- **Store a target ID inside parameters:** duplicates feature-DAG ownership and risks disagreement with ordered content hashes.
- **Rewrite schema version 1 in place:** older runtimes would accept the identity but reject the newly persisted operation values.
