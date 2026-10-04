# ADR-0078: Extrusion end conditions and bounded fastener geometry

- Status: Accepted
- Date: 2026-10-04
- Extends: [ADR-0053](0053-independent-extrusion-depths.md), [ADR-0051](0051-body-bound-topology-inspection.md), [ADR-0048](0048-sketch-point-holes.md), [ADR-0064](0064-modeled-custom-threads.md)

## Decision

Keep the existing exact OCCT/replicad worker and first-party feature modules. Extrusion v6,
Hole v3, and Thread v2 add separate versioned contracts. Existing feature schemas remain strict,
registered, readable, and replayable; opening an old project does not migrate its geometric intent.

Extrusion v6 stores a signed start-offset quantity, signed draft-angle quantity within 45 degrees,
and one end condition: distance, through-all, up-to-body, or up-to-face. Dynamic extents are
one-sided. Distance retains the existing reversed, symmetric total-span, and independent second
extent behavior. The sketch plane shifted by the start offset is the draft neutral plane; the
signed draft is continuous across both distance extents. Draft uses OCCT's DraftAngle on an owned
prism and fails when a side cannot be drafted or the result is invalid.

Modifying v6 extrusions bind one exact `BodyReference`, including individual Pattern, Split,
Compound, and imported outputs. Dependencies remain target first, then a distinct sketch support,
then a distinct end support. Geometry input selection and hashing include the end body; body
consumption and authored part ownership consume only the modifying target. One producer cannot
occupy conflicting body roles in this version's canonical input slots.

Dynamic endpoints capture the support's content hash and body role. Preparation resolves current
analytic geometry and rejects a changed revision of that support, missing bodies, ambiguous
faces, parallel planes, and unreachable extents. Through-all reaches beyond the selected body's
projected bounds. Up-to-body cuts an overlong exact prism by the endpoint and retains only the
unique component carrying the complete original start cap and no overrun cap. Partial profile
coverage and wraparound paths fail closed.

Up-to-face currently supports planar faces. The body-bound stable reference is resolved against
the exact current body's topology using the same strict resolver as Shell. Native construction
clips by that analytic plane and verifies the complete end cap lies on the selected finite face.
It does not extend a finite face silently. Curved endpoint faces are unavailable in this version.
No sampled rays, tessellated surfaces, or transient native indices determine an endpoint.

Hole v3 adds simple, counterbore, and countersink treatments to the exact sketch-point hole.
Counterbore diameter exceeds the hole diameter and its positive recess depth stays before a
blind end. Countersink uses a larger entry diameter and an included angle from 10 through 170
degrees; its derived axial recess depth also stays before a blind end. Each recess must remove
material. Native cylinders and revolved conical frusta are disposed on success and failure.

Thread v2 uses the shared origin, datum, linear-edge, or explicit axis contract. Selected axes
retain stable body topology and signed direction; explicit vectors are normalized canonical
values. The target is the first exact body dependency and a distinct axis source follows it.
Unavailable or ambiguous axes block preparation. The canonical projected radial basis retains
v1's X:+Y, Y:+Z, and Z:+X phase-zero convention, so extending a legacy thread does not rotate it.

Thread v1 retains its 16-turn limit and native pipeline. Thread v2 permits 20 total authored turns
for one start and retains 16 for multiple starts. Each native sweep covers at most 20 authored
turns; the aggregate helix budget including overruns is 32. Long single-start bands are partitioned
into non-overlapping axial slabs covering at most 16 turns per cut. Every slab uses the same owned
exact swept surface, avoiding independent pipe approximation at shared boundaries. The result is
restored with exact planar interfaces; global helical phase stays continuous.

A single-start band retains the exact owned CUT result. A second Common against its coincident
helical cutter adds no independent result and can stall OCCT on matching faces; v2 omits that
redundant operation for one start. Multi-start and all v1 paths retain the residual checks.
Validity, effective material removal, unchanged cached sources, phase-continuous seams, owned
result disposal, and bound rejection remain mandatory. The measured oblique 20-turn corpus
completed two external and two internal evaluations in approximately 37 seconds; larger unverified
limits are not exposed.

## Consequences

These are exact geometry capabilities with bounded failure behavior. Draft, endpoint coverage,
and thread geometry can still fail for otherwise schema-valid shapes. Failed previews cannot
commit, and all native temporary ownership follows the existing transaction boundary.

The browser controls author these versions through ordinary disposable preview, Apply/Update,
Undo/Redo, and project persistence. MCP availability is supplied by the corresponding named
adapters and operator bundle; UI presence alone does not establish that contract.
