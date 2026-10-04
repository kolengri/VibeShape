# ADR-0079: Exact Sweep curves, hollow Loft correspondence, and sketch corner treatments

- Status: Accepted core curve and sketch-edit contract
- Date: 2026-10-04
- Extends: [ADR-0018](0018-deterministic-sketch-profile-extraction.md), [ADR-0029](0029-exact-bounded-elliptical-arc-locus.md), [ADR-0068](0068-exact-cubic-bezier-sketch-curves.md)

## Context

Existing exact sketch curves must remain exact when selected as Sweep paths. Hollow Loft cannot infer
hole identity from profile order or transient OCCT edges. Sketch corner treatments must preserve
sketch dimensions and editable constraints rather than introduce downstream solid features.

## Decision

Extend the existing Part Design and Sketch owners. No new computational kernel or feature module is
introduced. The document worker resolves authored selectors; the geometry worker constructs OCCT
geometry; the sketch domain owns one immutable edit and the existing solver owns its constraints.

### Sweep

Sweep retains its version-1 authored selector. Open lines, circular arcs, cubic Bezier curves and
bounded elliptical arcs use the existing analytical segments and exact OCCT wire construction.
Traversal retains entity and point UUIDs. Reversing a cubic swaps both control roles. Reversing an
elliptical arc reverses its handed axis frame while retaining the same bounded locus.

Endpoint derivatives determine path tangents. Singular cubic endpoint tangents, disconnected or
branched selections, non-G1 joins and incompatible initial profile placement fail closed. Display
sampling is never a kernel path. Full circles and ellipses remain closed curves and cannot be Sweep
paths under this open-path contract.

### Hollow Loft

Preserve Loft version 1 and its hole-free replay unchanged. Version 2 adds a required
`holeCorrespondence` array. Each track contains `sectionBoundaryEntityIds`, one exact, sorted stable
hole-boundary ID list for every ordered section. Every section hole must occur exactly once; counts,
missing IDs, duplicate tracks and incomplete columns fail validation. Reordering UI sections
reorders the matching correspondence columns by stable selector identity. The UI requires explicit
choices and does not assign tracks from sorted hole positions.

Construct the outer solid and each corresponding inner solid with OCCT ThruSections. Native common
volume verifies that each entire inner solid stays within the current outer result and does not
cross another track. Exact Boolean subtraction creates the hollow result. The resulting shape must
be valid, contain one solid and have positive volume. This deliberately rejects crossing, touching
or escaping holes rather than changing their correspondence. All temporary shapes and native
builders are released on success and failure. Section and aggregate curve budgets apply to outer
and inner boundaries together. Loft accepts at most 24 scheduled owner dependencies; Sweep retains
its separate limit of eight.

Guide curves and independently constrained Loft ends require a distinct exact surface contract;
version 2 does not accept metadata that the kernel would ignore. OCCT ThruSections continuity is a
global approximation setting and does not implement independent G1/G2 end support constraints.

### Sketch Fillet and Chamfer

A corner treatment accepts two distinct, non-construction authored lines with one shared endpoint.
Collinear, branched, degenerate and oversized cases fail before producing an edit. Original line
UUIDs remain and their corner ends are shortened. Original endpoints and full construction guide
lines retain the virtual sharp corner. Existing line constraints move to the full guides; existing
point constraints retain their point identities. New trimmed points lie on the guides.

Fillet adds an exact circular arc, a radius dimension and one tangent constraint at each end.
Chamfer adds a line and two independent corner-to-trim distance dimensions. Dimensions retain
quantity expressions. Native tangent constraints may specify `at: start | end`; absent `at` retains
the historical start-end behavior for old sketches. SolveSpace receives the explicit arc-end bit for
new fillets. No implicit endpoint inference changes old slot constraints.

The editor shows a disposable corner preview, applies the resulting sketch as one existing draft
undo entry and leaves the source unchanged on cancel. Committing the sketch uses the ordinary
revisioned command and native backup path. The product commands are named Sketch fillet and Sketch
chamfer to distinguish them from solid edge treatments. Transport adapters reuse this domain edit;
manual editor availability alone does not establish an MCP tool contract.

## Verification

Domain and protocol tests cover stable identities, old-version replay, strict correspondence and
invalid input. Real pinned SolveSpace tests verify residuals, degrees of freedom, closed-profile
area and radius/setback edits. Real pinned OCCT tests verify native curve type, validity, volume,
source preservation, hole crossing rejection, cache replay, export and disposal. Browser tests
exercise selection, preview, cancel, apply, draft undo/redo and sketch commit.

Extended by [ADR-0081](0081-constrained-loft-native-patch-networks.md) for bounded native guide and independent end constraints.
