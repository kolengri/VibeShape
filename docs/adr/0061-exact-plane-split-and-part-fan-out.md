# ADR-0061: Exact plane Split and Part fan-out

- Status: Proposed; domain and native slices awaiting product integration
- Date: 2026-10-03
- Extends: [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md),
  [ADR-0054](0054-authored-parts-and-organizational-history-folders.md),
  [ADR-0055](0055-trusted-exact-body-placement.md),
  [ADR-0057](0057-trusted-body-compound-and-union.md)

## Decision

Split is a trusted Part Design feature, schema version 1, selecting one exact `BodyReference`.
Its XY, XZ, or YZ origin plane has a signed length offset, resolved to canonical millimeters and
bounded to +/-100,000 mm. The sole scheduling dependency must match the selected producer.
Canonical content carries its exact body role and source hash; document UUIDs do not enter numeric
parameter identity. Unselected siblings remain terminal.

Exactly two valid, positive-volume, single-solid outputs are published atomically:
`split.negative` on the coordinate-below-offset side and `split.positive` above the offset.
XY addresses Z, XZ addresses Y, and YZ addresses X. These roles persist across plane and offset
edits; they are semantic sides, never OCCT enumeration ordinals. A missing source role cannot fall
back to an aggregate or another sibling.

## Authored Part policy

The internal `fan-out` operation has one target, one required continuation output, and an ordered
array of independently created outputs. It advances its source exactly once. Independent outputs
start their histories with only their own body reference. This policy is reusable without naming
Split inside the binding planner; a consume-and-create policy or optional continuation is deferred.

For Split, the negative output continues the source PartId, name, visibility, and earlier history.
The positive output receives one fresh captured independent PartId and starts with
`split.positive`. Selecting a historical source creates a captured negative fork and an independent
positive root while preserving the later current tip. Missing authored ownership prevents every
fan-out root and advance, rather than creating a partial result.

Suppression retains captured independent and fork roots but skips advancement and consumption.
The source becomes current again; unavailable output geometry leaves new roots dormant. A failed
native evaluation likewise retains authored intent and uses the existing available-history
projection to recover the source. Restoring availability reuses captured identities. Historical
forks remain forks when edits or suppression later expose their source as current.
The binding planner tracks an internal authored tip and exact ownership separately from the
available body history. A suppressed continuation therefore remains a known input for downstream
fan-out allocations; a genuinely absent body role still creates no partial result.

Existing `PartRecord`, `PartAllocation`, and atomic create/replace/remove effects represent this
policy. There is no document or storage migration. Ordinary V2 commands capture allocations once;
Undo, replay, and effect validation preserve their identities and reject tampered effects.
Pattern count changes and dormant-root policy are separate future decisions; no pattern feature is
introduced by this fan-out foundation.

## Native boundary

The pinned OCCT build lacks Splitter and HalfSpace bindings. The adapter instead copies the exact
source and intersects it with two finite analytic boxes covering the source's native analytical
bounds, enlarged only by native tolerance and floating-point scale padding. Their common cut plane
is the requested offset. Boolean builders enable non-destructive mode before building. This uses
exact B-Rep booleans, with no mesh fallback, fixed arbitrary tool extent, or kernel migration.

Each half must be one valid solid meeting its declared plane side. The combined volume must agree
with the source within a relative 1e-8. Tangent or missed planes, disconnected halves, invalid bounds,
or any failed boolean reject the complete result. Every source copy and clip tool is released;
the caller owns both returned solids or neither. Native release failures are reported explicitly.

## Verification boundary

Domain tests cover trusted schemas, variable resolution, exact input identity, dependency projection,
current and historical owners, fresh allocations, independent histories, metadata preservation,
suppression, replay, compensating Undo, and tamper rejection. Real pinned OCCT fixtures cover all
three planes, asymmetric boxes and cylinders, signed offsets, large bounded coordinates, volume and
bounds, source preservation, tangent/missed planes, disconnected halves, and copy disposal.

These bounded slices do not establish product delivery. Worker publication, atomic native role
ownership, downstream rebuild and repair, UI authoring, browser persistence, export, and MCP flows
remain integration gates.
