# ADR 0070: Derived assembly geometry and exact interference

Status: Accepted

## Decision

Assembly authority remains the frozen definitions, instances, joints, limits and drives from ADRs
0064 and 0067. Derived occurrence geometry rebuilds each selected frozen dependency closure under
an ephemeral document cache identity. Producer UUIDs, body roles and semantic content remain
unchanged. Native scopes are disposed after the read-only operation and never resolve through a
live document's mutable geometry cache.

The application materializer validates the entire frozen closure, selected body claims, current
environment, mesh policy and source bytes before publishing occurrences. Caller-owned caches
contain defensive copies and check immutable source bytes even on hits. Missing assets, mismatched
hashes, incomplete producers and resource overflow return one diagnostic, never a partial assembly.

Kinematics determines each occurrence's rigid frame. The response mesh and bounds already occupy
world coordinates; rendering must not apply that frame a second time. Occurrence selection uses
instance UUIDs independently of authored Part selection.

## Exact material intersections

Bounds provide a broad phase. Overlapping exact instances copy and transform their native solids,
union each instance's selected solids to avoid counting overlapping pins twice, and measure native
Common material with signed volume and BREP validity checks. Touching faces have zero material;
disconnected positive intersection components remain part of the result. Original bodies remain
owned by their source scopes.

An overlapping mesh pair reports `unsupported-mesh`; bounds alone do not prove material collision.
Exact queries support at most sixteen solids per selected instance, 1,024 unique unordered pairs,
and the established frozen-model and transfer budgets. The UI reports failed or unsupported checks
explicitly instead of presenting an approximate result as exact evidence.

## Disposable assembly export

Export selects all current occurrences or explicit unique instance UUIDs. STEP resolves verified
named native body roles, copies their rigid placements and writes a compound with independent
solids, preserving disconnected or overlapping sources. STL flattens the already placed meshes
into one triangle stream; 3MF retains named occurrence objects. Neither export transforms source
cache geometry or changes assembly authority.

Optional 3MF print preparation uses the ordinary combined-copy rotation, XY centering, Z seating,
support generation and printer-envelope checks. It is bounded to eight source bodies and the
existing print triangle budget. Ordinary exports keep their independent source/mesh/file budgets.
A mixed mesh selection cannot export STEP and receives an explicit diagnostic. Worker cancellation
and revision changes discard the disposable result. Native tests reimport placed STEP solids and
verify volume, bounds, source preservation and cleanup on failure.

## Acceptance

Real kernel tests cover translated and rotated intersections, separated/touching solids,
overlapping-pin deduplication, disconnected intersections, invalid poses, repeated operations and
source preservation. Integrated frozen rebuild tests delete the original Part, verify claimed
content hashes, check world placement and prove disposal does not invalidate the editor cache.
UI persistence and occurrence/joint workflows remain additional integrated delivery gates.
