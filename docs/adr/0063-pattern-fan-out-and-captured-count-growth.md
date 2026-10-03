# ADR-0063: Pattern fan-out and captured count growth

- Status: Proposed; domain and native slices awaiting product integration
- Date: 2026-10-03
- Extends: [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md),
  [ADR-0054](0054-authored-parts-and-organizational-history-folders.md),
  [ADR-0059](0061-exact-plane-split-and-part-fan-out.md)

## Decision

Pattern is one trusted Part Design feature, schema version 1, with linear and circular kinds.
It selects one exact body and publishes independently owned native solids under deterministic
`pattern.instance.0` through `pattern.instance.N` roles. Instance indices express authored pattern
positions; native enumeration is never identity. Count is a scalar quantity, integer 2 through 256,
including the seed. Linear spacing and circular angle/center remain bounded dimensional quantities.
Copies may intersect and are not fused.

The internal fan-out continuation is `pattern.instance.0`. It keeps the seed PartId, name, visibility,
and available history. Every other active instance starts an independent captured PartId with only
its own role in its history. A historical seed produces a captured continuation fork without
consuming the later current tip. Missing exact authored ownership prevents partial fan-out.

## Count changes and capture policy

Allocation planning evaluates the post-command document variable definitions and resolves the count
expression before computing new roots. The authored numeric fallback cannot determine cardinality.
Invalid, missing, non-scalar, fractional, or out-of-range resolved count rejects the model command
atomically. It does not delete captured IDs, names, visibility, or variable definitions.

Every ordinary V2 model command already carries captured Part allocations. This includes a variable
update: growth allocates only previously uncaptured active roles in numeric instance order, and the
same variable-update event persists their create effects. Replay uses those captured IDs and rejects
missing or substituted effects. It does not generate identities or silently expand an old event.

Shrinking retains previously captured independent copy roots, including their metadata, as dormant
authored records. Restoring or growing into a captured role reuses its identity. This retention is
restricted to the exact registered Pattern1 producer and canonical `pattern.instance.1` through
`pattern.instance.255` roles. No arbitrary producer role or leading-zero alias qualifies. The
planner never creates uncaptured dormant capacity. Existing Part and document budgets still apply.

We do not reserve 256 IDs at feature creation. Unused allocations cannot be persisted by the existing
event shape without creating Part records or introducing a separate capacity format; neither is
needed when post-command capture already supports variable-driven growth. No document migration or
new capacity schema is introduced.

## Availability and ownership

Suppression preserves captured roots and skips available advancement and consumption. Internal
authored ownership still identifies downstream continuation inputs. An inactive copy is absent from
the current native role catalog and is not exportable. Its independent history has no seed fallback.
Failed native evaluation recovers the seed through its earlier available history while copies remain
dormant. Geometry expression failures use the existing rebuild diagnostics; allocation cardinality
requires a valid resolved count independently of spacing or angle availability.

V4 authority retains the same variables and Part records through its compatibility projection to
V2. That projection does not replace V4 persistence authority. Undo and replay restore count, model,
and captured metadata together.

## Verification boundary

Domain fixtures cover current and historical seeds, independent histories, exact allocation capture,
count shrink/restore, suppression, bounded canonical dormant roles, scalar count expressions,
variable-update growth and replay, invalid-count atomic rejection, maximum count, V4 variable
projection, and effect tampering. Native fixtures separately prove owned copies, placement, bounded
coordinates, source preservation, volume, full/partial circular endpoints, and disposal.

These slices do not certify product delivery. Worker atomic publication and role validation, current
native catalogs, downstream unavailable-copy diagnostics, UI authoring and dormant display,
persistence reopen, export, and MCP workflows remain integration gates.
