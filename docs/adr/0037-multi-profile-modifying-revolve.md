# ADR-0037: Multi-profile modifying Revolve

- Status: Accepted
- Date: 2026-09-01
- Extends: [ADR-0030](0030-explicit-target-revolve-operations.md), [ADR-0034](0034-versioned-multi-profile-feature-input.md), [ADR-0036](0036-multi-profile-modifying-extrusion.md)

## Context

ADR-0034 introduced canonical same-sketch multi-profile Revolve for New results only. Add, Remove, and
Intersect remained closed because their saved contract did not bind an explicit target and the geometry
worker admitted one-to-many results. Widening that feature version would change the meaning of existing
project records.

Revolve also has axis-source dependencies that Extrude does not. A modifying multi-profile contract must
retain one exact origin, sketch-line, or model-edge axis while keeping body ownership distinct from sketch
support and axis-source evaluation dependencies.

## Decision

Add a new multi-profile Revolve feature schema version that accepts only `add`, `remove`, and `intersect`.
The existing multi-profile New version remains unchanged and readable.

The new version retains the canonical same-sketch `SketchProfileSet`, one stable `RevolveAxis`, bounded
angle, and modifying operation. Its first dependency is one explicit ordinary single-solid target. A
distinct sketch-support owner follows, then a distinct model-edge axis source. Repeated owners are stored
once in first-occurrence order. No active-body, overlap, recent-feature, or renderer selection state may
replace this authored dependency order.

The document worker solves the source sketch once, materializes every selector independently in canonical
order, and resolves the selected axis once. The geometry worker validates every profile against that axis,
builds one disposable revolution tool per profile, combines the tools in canonical order, then applies
exactly one Fuse, Cut, or Common operation to the explicit target.

A successful modifying result must contain exactly one valid positive-volume solid. Empty results,
multi-solid results, profiles crossing the axis, invalid topology, missing targets, and invalid support or
axis-source ordering fail closed and cannot replace the last valid derived result. Multi-profile New keeps
its separate bounded one-to-many result rule.

The resulting feature is eligible as an ordinary downstream Boolean or modifying target because its
single-solid invariant leaves one unambiguous result. Multi-profile New remains excluded until stable
per-solid identity and merge scope exist.

The viewport keeps the existing spatial selection grammar: primary click replaces the profile set and
`Shift` plus primary click toggles a region. Selecting several regions no longer resets or disables the
operation. The ordinary operation, target, axis, and angle controls drive one disposable preview, and Apply
persists one feature revision.

## Consequences

- Existing schema-version-5 multi-profile Revolve records remain New-only and require no migration.
- New and edited multi-profile modifying Revolves use a distinct schema identity and target-first graph
  contract.
- Selection order cannot change the saved profile set, combined tool, or Boolean result.
- Target ownership, sketch support, and model-edge axis sources remain separately auditable dependencies.
- One failed constituent profile or one invalid final result fails the complete feature; regions are never
  dropped silently.
- The implementation does not introduce renderer, OCCT, profile-index, or per-solid persisted identity.
- Cross-sketch sets and individually addressable multi-profile New result solids remain open.

## Rejected alternatives

- **Widen schema-version 5 in place:** older runtimes would interpret the same type identity with a
  different operation and dependency contract.
- **Apply one Boolean per selected profile:** intermediate order and partial success would become visible
  semantics.
- **Resolve one axis per profile:** a single Revolve feature must retain one shared authored axis.
- **Infer the target from overlap or recency:** rebuild would depend on presentation state rather than
  persisted design intent.
- **Accept a compound modifying result:** downstream consumers still require one unambiguous body.

## References

- [Onshape Revolve](https://cad.onshape.com/help/Content/PartStudio/revolve.htm)
- [Onshape selection](https://cad.onshape.com/help/Content/Home/selection.htm)
