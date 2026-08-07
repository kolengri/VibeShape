# ADR-0006: 3MF as the Primary Print Export

- Status: **Accepted**
- Date: 2026-08-07

## Decision

Use 3MF Core as the primary slicer-exchange format, STEP as the exact CAD-exchange format, and STL for compatibility. A complete integrated slicer is outside the v1 scope.

## Consequences

- The writer must comply with OPC, XML, and 3MF requirements and pass tests in independent slicers.
- Multiple objects, units, and metadata have explicit representations.
- Print meshes are generated separately from display meshes.
- Vendor-specific slicer settings are not promised.
- Future slicer integration requires a new ADR and license review.
