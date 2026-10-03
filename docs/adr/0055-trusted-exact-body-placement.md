# ADR-0055: Trusted exact-body Placement

- Status: Proposed; foundational implementation awaiting verification and product integration
- Date: 2026-10-03
- Extends: [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md),
  [ADR-0054](0054-authored-parts-and-organizational-history-folders.md)

## Decision

Placement is a trusted first-party solid feature, schema version 1, with exactly one named
`BodyReference` dependency and no topology references. Its target must match its sole producer
feature dependency. The canonical content identity includes the selected output role and dependency
content hash; document-local UUIDs do not enter numeric parameter identity. Missing, suppressed,
failed or unavailable roles cannot fall back to another constituent or an aggregate result.

The authored parameters are translation X/Y/Z length quantities and rotation X/Y/Z angle quantities.
Existing bounded expression resolution supplies canonical millimeters and radians. Translation is
bounded to ±100,000 mm per axis, rotation to ±one revolution per axis; resulting world bounds must
also remain within ±100,000 mm. The feature accepts no matrix, executable code, scale or shear.
Rotations are right-handed about the world origin: apply Rx, then Ry, then Rz (`Rz * Ry * Rx`),
followed by world translation. This is intentionally not rotation about the part centroid.

The kernel requires a valid single positive-volume solid and returns a single exact `result` body.
The pinned generated OCCT binding is `BRepBuilderAPI_Transform_2(source, transform, true)` with three
arguments. Copying retains the original source for dependent rebuilds and historical forks. The
temporary transform, builder and returned raw OCCT wrapper are released on every acquired-object
exit path; the shape registry owns the adopted result. Geometry validation failure releases the
temporary result before publishing a failure. Placement does not mutate its source cache entry.

The existing authored part modifier policy advances the current target's same `PartId` and metadata,
with no consumed tool parts. Suppression/removal restores the preceding binding. Targeting a
historical body follows ADR-0054's explicit captured fork allocation policy. Placement does not add
new allocation or replay semantics. Exact sibling bodies remain terminal when not selected.

This increment registers the feature through domain descriptors, trusted handlers, dependency and
semantic-input projections, protocol validation, and geometry evaluation. The generic document
worker dependency graph rebuilds it after upstream edits. UI tools, MCP schemas, Compound/Union
multi-output identity and same-producer multi-slot dependencies remain separate increments.

## Verification boundary

Focused tests cover dimensional expressions, schema/type/role rejection, canonical identity,
captured PartId advancement and suppression/replay, transform order, and acquired native object
cleanup. Real worker tests cover asymmetric-solid volume and bounds, all three rotations, cache
source preservation, upstream edits, dependent Placement, unavailable roles and stale hashes,
bounded-output rejection, disposal/restart, plus the document worker's rebuild/suppression path.
These tests must run against the pinned real OCCT package before this proposal is accepted.

The transform coefficients follow the documented [gp_Trsf point transform contract](https://occt3d.com/dev/doc/refman/html/classgp___trsf.html).
Constructor arity comes from the repository's pinned generated declarations; the current upstream
[BRepBuilderAPI_Transform documentation](https://occt3d.com/dev/doc/refman/html/class_b_rep_builder_a_p_i___transform.html)
must not override that generated binding.
