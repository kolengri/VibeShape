# ADR-0077: Mirror copies and draft Shell selection

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0047](0047-local-mcp-draft-inspection.md), [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md), [ADR-0051](0051-body-bound-topology-inspection.md), [ADR-0060](0060-persisted-body-bound-shell-openings.md), [ADR-0076](0076-closed-shells-and-durable-opening-identity.md)

## Context

An enclosure reconstruction needs to reuse symmetric geometry and select Shell openings before
saving an exterior. Legacy Mirror replaces its source and supports only origin planes. Committed
body topology alone forces an intermediate Apply before authoring Shell. Agents also need support
diagnostics when solids evaluate successfully but sketch references cannot resolve.

## Decision

Extend existing Part Design, application preview and automation owners. Retain the same typed
document commands, exact worker evaluation, disposable drafts, consent, persistence and Undo path.
No parallel CAD engine, new package or privileged automation mutation is introduced.

Mirror schema v1, plane-only inputs and canonical identity remain unchanged. Schema v2 adds a signed
length `offset` and `preserveSource`. XY, XZ and YZ offsets follow +Z, +Y and +X respectively; the
reflected normal coordinate is `2 * offset - source`. Offset expressions retain quantity intent.
A source-preserving Mirror leaves the original part and terminal body available, creates a new
part for the reflected feature's one `result` body, and allows explicit later Union. Replacement
retains modifying-operation ownership. Updates preserve feature identity and ordinary schema-upgrade
review rules; old documents do not acquire new defaults or undergo a silent migration.

`draft_body_measurements` and `draft_body_topology` adapt existing registered queries to exact
owned draft evidence. Body roles and topology remain producer-bound, with source content hashes
and revision/rebuild cursor provenance. Detached bounded evidence cannot expose native handles,
meshes, another draft or another document. Reads do not save or renew expiry. Authority is checked
before and after worker evaluation, and edits invalidate stale evidence.

Shell consumes fresh resolved draft opening faces using its existing versioned selection contract.
Version 1 retains conservative stale-hash rejection. Version 2 retains only unique durable
opening identities within the same exact body after source edits; unresolved or ambiguous
openings require explicit reselection. New exterior construction, face discovery, Shell and exact preview can
therefore precede one final Apply.

Model and preview diagnostics expose authoritative evaluation and support-resolution failures
with entity identity and actionable support context. Successful aggregate geometry cannot suppress
an unresolved sketch support. Diagnostic payloads remain bounded and revision-bound; unavailable
evidence is distinguishable from a clean result.

## Consequences

The operator pack teaches a feature plan before construction: analytical sections, symmetry and
constant-thickness Shell where appropriate, with explicit interior construction for variable
thickness or protected mating geometry. This is modeling guidance, not a claim that every source
mesh can be reconstructed using one Shell or Mirror.

Verification covers legacy records, part ownership and replay, offset/copy geometry and disposal,
draft owner/revision/cursor failures, stale Shell selection, support diagnostics, local/remote
tool discovery and a browser draft-to-Shell workflow. Skill bundle validation checks packaging;
it does not measure whether a future agent chooses the simplest valid construction.
