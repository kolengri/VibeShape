# ADR-0139: Precise Imported Mesh Coordinates

- Status: Accepted
- Date: 2026-10-28
- Related: [ADR-0002](0002-geometry-worker-boundary.md), [ADR-0071](0071-explicit-triangle-mesh-source-features.md), [ADR-0101](0101-browser-structural-lightweighting.md)

## Decision

Keep Float32 display positions and allow an optional `precisePositions: Float64Array` in the
derived mesh payload. The sidecar preserves transformed imported coordinates for numerical
source capture and mesh export. Its length must match display positions, every value must be
finite, and each display coordinate must equal `Math.fround` of its precise counterpart.
Rendering keeps the existing Float32 representation. Neither channel invents B-Rep topology or
an exact-solid volume claim.

Immutable STL/3MF source assets remain canonical. Rebuild derives both channels from verified
source bytes; the sidecar is not a second authored geometry store. Copies, worker transfers,
disposable previews, assembly transforms, cache ownership and memory accounting preserve it.
Mesh export and numerical capture prefer precise coordinates when present. Geometry protocol
18, document protocol 27 and updated adapter identities invalidate older derived payloads.

Structural analysis retains its original double-precision FEM cells, boundaries, volume and
mass-target policy. Snapshot encoding uses binary STL only when the existing coordinate-rounding,
volume and manufacturing-solid checks pass. Otherwise the existing 3MF writer stores the analyzed
double coordinates with declared millimeter units. The ordinary import inspection, review,
atomic commit, Undo, native backup and source revision checks remain authoritative. A 3MF input
uses no caller-selected source unit; inspection reports its embedded millimeter normalization.

## Alternatives and consequences

Replacing all display positions with Float64 would widen GPU, preview, section and texture
contracts. Rounding FEM cells to Float32 would change the analyzed geometry, source containment,
boundary selection and mass-target accounting. Raising the STL rounding threshold alone could
move material into a protected or excluded region without analyzing that geometry. None is
needed when the existing 3MF/source pipeline retains the numerical coordinates.

Precise imported meshes use an additional eight bytes per coordinate, including owned copies.
This memory is included in assembly cache accounting. Legacy payloads without a sidecar keep
their existing Float32 behavior. Binary STL export remains a Float32 format; use 3MF to retain
precise coordinates. No native numerical service, new file format or import authority is added.

## Acceptance

Protocol fixtures reject malformed or stale dual geometry. Import, rebuild, worker transfer,
preview, cache and assembly tests prove ownership and exact transformed-coordinate preservation.
Structural fixtures cover decimal grids, translated models, strict STL rejection and exact 3MF
fallback. UI and MCP fixtures use real source inspection and the existing reviewed import path.
The built numerical workers and the captured fine-grid model receive separate runtime checks.
