# ADR-0036: Multi-profile modifying Extrude

- Status: Accepted
- Date: 2026-09-01
- Extends: [ADR-0023](0023-explicit-target-extrusion-operations.md), [ADR-0034](0034-versioned-multi-profile-feature-input.md)

## Context

ADR-0034 introduced a canonical bounded profile set for same-sketch multi-profile New operations. It
deliberately rejected Add, Remove, and Intersect because the first worker contract admitted one-to-many
solid results and had no combined-tool modifying invariant. Widening that saved feature version would
change the meaning of existing records.

Users still need one Extrude feature to modify an ordinary target body with several spatially selected
regions. Requiring separate features for every region adds avoidable History entries, duplicates the
distance intent, and makes later edits harder to audit.

## Decision

Add a new multi-profile Extrude feature schema version that accepts only `add`, `remove`, and `intersect`.
The existing multi-profile New version remains unchanged and readable.

The new version retains the canonical same-sketch `SketchProfileSet`, distance, and symmetric intent. Its
first dependency is one explicit ordinary single-solid target. A distinct sketch-support feature follows
the target; when the target also owns the support, the dependency is stored once. No active-body or
geometric-overlap inference may replace that authored target.

The document worker solves the source sketch once, resolves every selector independently in canonical
order, and sends a bounded analytical profile array plus the modifying operation. The geometry worker
builds one disposable tool per profile, combines the tools in canonical order, then applies exactly one
Fuse, Cut, or Common operation to the explicit target.

A successful modifying result must contain exactly one valid positive-volume solid. Disjoint Add,
multi-solid Intersect, empty results, invalid topology, missing targets, and ambiguous or missing profile
selectors fail closed without replacing the last valid derived model. Multi-profile New retains its
separate bounded one-to-many result rule.

The resulting feature is eligible as an ordinary downstream Boolean or modifying target because the
single-solid invariant leaves exactly one feature-owned result to select. Multi-profile New remains
excluded because it may own several solids without stable per-solid identity. Multi-profile Revolve
remains a separate delivery.

The viewport keeps the existing selection grammar: primary click replaces the profile set and `Shift`
plus primary click toggles a region. Selecting several regions no longer forces the operation back to New.
The ordinary operation and target controls drive the disposable preview, and Apply persists one feature
revision.

## Consequences

- Existing schema-version-3 multi-profile Extrude records remain New-only and require no migration.
- New and edited multi-profile modifying Extrudes use a distinct schema identity and target-first graph
  contract.
- Selection order cannot change the saved profile set, combined tool, or Boolean result.
- One failed constituent profile or one invalid final result fails the complete feature; regions are never
  dropped silently.
- The implementation does not introduce persisted OCCT, renderer, profile-index, or per-solid identity.
- Multi-profile Revolve, downstream use of multi-solid New results, cross-sketch profile sets, and
  individually addressable result solids remain open.

## Rejected alternatives

- **Widen schema-version 3 in place:** older runtimes would interpret the same type identity with a
  different operation contract.
- **Apply one Boolean per selected profile:** intermediate order and partial success would become visible
  semantics and could produce a different result from one canonical combined tool.
- **Infer the target from overlap or recency:** rebuild would depend on presentation state rather than
  persisted design intent.
- **Accept a compound modifying result:** ordinary feature consumers still require one unambiguous body.

## References

- [Onshape Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm)
- [Onshape selection](https://cad.onshape.com/help/Content/Home/selection.htm)
