# ADR-0068: Exact cubic Bezier sketch curves

- Status: Accepted executable curve contract; staged interaction integration
- Date: 2026-10-03
- Extends: [ADR-0014](0014-solvespace-flat-wasm-solver.md), [ADR-0018](0018-deterministic-sketch-profile-extraction.md)

## Context

Editable curved profiles need authored control-point identity, native solving and exact solid inputs.
A display polyline cannot serve as the geometric authority of an extrusion or revolution. The pinned
SolveSpace ABI already exposes cubic entity type `80002`; the pinned OCCT build exposes polynomial
`Geom_BezierCurve`. Neither capability requires a kernel or ABI migration.

## Decision

Add the strict version-0 sketch entity variant `cubic-bezier` with `startPointId`, `control1PointId`,
`control2PointId` and `endPointId`. All four roles reference distinct, independently authored point
UUIDs. Point movement, rigid transformation, mirroring, pattern copies, removal and captured command
Undo/Redo preserve the usual authored identity rules. Construction cubics remain excluded from solid
profile detection. Unsupported consumers reject the new variant instead of interpreting it as an arc.
Older readers that do not recognize the variant fail schema validation; no lossy downgrade is implied.

Compile one native cubic entity with four point handles. Exact worker profile segments carry the four
coordinates and their four authored IDs. Reversing a directed cubic reverses all four roles, including
the two controls. Extrusion, revolve and Loft wires create an exact OCCT Bezier edge. No control
polygon, sampled polyline or inferred B-spline substitutes for this curve.

The native adapter explicitly transfers the raw curve into OCCT's intrusive `Handle_Geom_Curve`.
Before that transfer, failure deletes the raw curve; afterward only the handle is released. Explicitly
deleting the retained raw pointee would invalidate the edge. Pole arrays, copied temporary points,
handles and edge builders are disposed on success and failure; the returned edge is caller-owned.

Profile closure and contact classification use the existing default `1e-7` mm tolerance. Cubic bounds
come from derivative extrema and signed area from the polynomial Green integral. Line and conic
intersections isolate polynomial roots on derivative partitions, including tangent roots. Cubic pairs
use de Casteljau subdivision with control-hull bounds, at most 16,384 subdivisions and depth 96.
Separated hulls prove separation; sufficiently small overlapping hulls identify a tolerance contact.
A budget limit or a coefficient roundoff estimate exceeding one quarter of the contact tolerance emits
`ambiguous-curve-topology` and prevents the uncertain curves from producing a valid profile. This is
bounded numerical topology validation, not a symbolic exact intersection theorem.

Zero extent, negligible endpoint or interior tangents, cusps, self-intersection, unsplit crossing and
ambiguous overlap fail explicitly. Analytical ray containment includes odd-multiplicity horizontal
inflection crossings and excludes tangencies. Cubic-containing loop bounds and area are analytical;
perimeter uses bounded de Casteljau chord/control-polygon approximation (depth 12, gap target `1e-8`
mm). Display and interior candidate samples are disposable and do not become native geometry inputs.

The SVG sketch curve uses the exact cubic path command. Other display buffers share 64-segment
Bernstein sampling; profile presentation uses 128 samples. These counts describe rendering only.
External cubic curve projection, tangent/point-on-curve/equal/offset constraints, and sketch trim,
split or extend are explicitly unsupported in this first contract. Trim/split/extend reject sketches
containing cubics so another curve cannot silently ignore a cubic intersection. Control points remain
ordinary independently selectable points. Cubic Sweep paths are outside this initial profile contract.

## Verification

Domain fixtures cover strict roles, missing and nonfinite points, serialization, control movement,
rigid transformation, removal and captured Undo/Redo/replay. Real pinned SolveSpace WASM fixtures
exercise cubic compilation and a stable-ID control-point drag. Profile fixtures exercise polynomial
area and extrema, crossings and tangencies, self-intersection, degeneracy, hole containment,
inflection parity and bounded intersection failure. Worker fixtures verify role reversal and strict
curve wire rejection. Real OCCT fixtures verify a closed cubic extrusion, a full revolution, analytical
bounds, valid single-solid outputs, volume, source preservation and repeated creation/disposal heap
capacity. Injected native failures verify temporary cleanup and the ownership transfer boundary.
