# ADR-0034: Versioned multi-profile feature input

- Status: Accepted
- Date: 2026-08-31
- Extends: [ADR-0018](0018-deterministic-sketch-profile-extraction.md), [ADR-0019](0019-selector-backed-new-body-extrusion.md), [ADR-0023](0023-explicit-target-extrusion-operations.md), [ADR-0030](0030-explicit-target-revolve-operations.md), [ADR-0033](0033-selector-backed-saved-profile-picking.md)

## Context

Extrude and Revolve currently persist one canonical `SketchProfileSelector`. The 3D viewport can display
and identify multiple saved regions, but selecting another region replaces the current task input. CAD
workflows also need one feature to consume several explicitly selected regions, including adjacent regions
that share an analytical boundary.

Changing the existing Extrude or Revolve parameter schema in place would alter persisted semantics for
already accepted feature type versions. The geometry protocol also prepares one outer loop with holes,
while ordinary feature evaluation requires exactly one valid positive-volume solid. Applying that invariant
unchanged would make multi-profile New nearly unusable: distinct same-plane regions normally produce
distinct solids, while touching regions are usually recognized as one region before feature creation.

## Decision

Introduce a versioned, bounded `SketchProfileSet` as the persistent multi-profile intent:

- the set stores only canonical `SketchProfileSelector` values;
- selectors are unique and sorted by their complete stable identity;
- at most 64 profiles and 2,000 aggregate boundary-entity occurrences are accepted;
- profile indices, loop indices, samples, pointer order, renderer identities, and OCCT objects are never
  persisted;
- each selector retains its own holes, while an island remains a separate selected profile;
- adjacent selected regions MAY share boundary entity IDs because the shared curve describes two distinct
  regions and may disappear only in derived Boolean geometry.

Multi-profile Extrude and Revolve use new feature type schema versions. Existing single-profile versions
remain registered and readable without migration. Editing a legacy feature may promote it only through an
explicit update that preserves feature identity and converts its single selector into a one-item set.

The first executable delivery accepts multiple profiles from one sketch support frame. The document worker
solves that sketch once, materializes every selector independently, and sends a bounded ordered array of
analytical profiles. The geometry worker builds one disposable tool per profile and combines them in
canonical order. A successful multi-profile New result contains between one and the selected profile count
of valid positive-volume solids. The solids remain one bounded feature result and one tessellated
presentation mesh; no transient kernel or per-solid identity is persisted.

Primary click replaces the task-local profile set. `Shift` plus primary click toggles one region. The task
panel reports the count and provides removal and clear actions, while the viewport remains the spatial
selection authority. Apply persists the canonical set in one ordinary feature command; Cancel discards the
task-local set.

The following cases fail closed in the first delivery:

- selectors from different sketches or non-coplanar support frames;
- invalid, missing, ambiguous, duplicate, or over-budget selectors;
- multi-profile modifying operations until combined-tool Add, Remove, and Intersect invariants are proven;
- using a multi-profile result as a Boolean or modifying-feature target until stable per-result selection and
  merge scope are proven;
- Revolve inputs that cross the selected axis or cannot use one exact axis for every profile.

Later slices may admit same-plane cross-sketch sets, explicit-target modifying operations, and stable
individually addressable part results only through separately tested protocol and body-model changes. They
MUST NOT infer a target, silently discard a selected region, or collapse several semantic selectors into a
sampled outline.

## Consequences

- Selection order cannot alter persisted identity, rebuild hashes, or worker execution order.
- Connected regions may reduce to one solid; disjoint regions remain multiple solids without changing their
  canonical authored selection intent.
- Ordinary features retain the one-solid invariant. Only bounded multi-profile New feature versions admit
  up to one positive-volume solid per selected profile.
- The current model tree treats the output collection as one feature result. Stable per-solid names, colors,
  selection, and downstream merge scope remain explicit follow-up work.
- Native project files need no document migration because old feature records remain valid and new feature
  versions are preserved through the ordinary strict snapshot contract.
- Automation and future MCP surfaces use the same bounded selector set and feature command; no renderer or
  kernel identity enters the public command boundary.

## Rejected alternatives

- **Widen existing feature schemas:** older runtimes could accept the type identity while rejecting or
  misinterpreting its parameters.
- **Store displayed profile indices:** solve order and presentation are derived and cannot carry design
  intent.
- **Reject every shared boundary:** adjacent selectable regions legitimately share analytical curves and are
  required for connected multi-profile results.
- **Persist kernel compound or subshape identity:** transient OCCT ownership cannot define durable parts;
  persisted per-solid identity requires a separate stable body-result contract.
- **Infer a target or active body:** editor presentation state is not deterministic document intent.

## References

- [Onshape Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm)
- [Onshape Revolve](https://cad.onshape.com/help/Content/PartStudio/revolve.htm)
- [Onshape selection](https://cad.onshape.com/help/Content/Home/selection.htm)
