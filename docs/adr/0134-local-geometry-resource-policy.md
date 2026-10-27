# ADR-0134: Local Geometry Resource Policy

- Status: Accepted
- Date: 2026-10-27
- Partially supersedes resource admission policies in [ADR-0101](0101-browser-structural-lightweighting.md), [ADR-0102](0102-lightweighting-task-workflows.md), [ADR-0133](0133-lightweighting-mesh-density.md), [ADR-0062](0062-durable-source-assets-and-portable-closure.md), [ADR-0065](0065-bounded-exchange-geometry-import.md), and [ADR-0073](0073-immutable-local-assembly-library.md)

## Decision

Remove fixed lightweighting execution ceilings for candidate cells, occupied cells, FEM nodes,
filter entries, shells, conditions, requested iterations, Quick sampling resolution and total samples.
Remove automatic computation deadlines in the numerical client and paired local/remote MCP.
The caller's nonnegative iteration budget still controls structural search. Cancellation terminates
its disposable worker; revocation, source revision and body identity still prevent stale publication.

Reuse existing NumPy, SciPy, scikit-fem, trimesh and Three.js algorithms. Stream candidate grid
coordinates in batches; construct the SIMP filter as CSR without a second Python row-index list.
Quick counts triangles from each actual Float32 field using Three's marching-cubes table before
allocating its output capacity. Adaptive proximity batches remain scratch-memory strategies,
without rejecting the complete problem or changing the requested resolution.

Quick accepts positive sampling/lattice scales, nonnegative skin and requested removal strictly
between zero and one hundred percent. A lattice period needs at least six sampling cells, with
no maximum sampling count. Retain minimum preserved skin, positive measured removal, topology,
source containment, exact captured exterior and float32 checks. Numeric controls complement
convenience sliders. Structural material validity, equilibrium, small-strain assumptions and both
baseline/final physical feasibility remain required.

Local STL/3MF geometry serialization/import, source descriptors/materialization/storage, and native
backup no longer impose fixed mesh-count or geometry-byte admission ceilings. Keep the same
source formats, parser policy, immutable source authority and atomic import transaction. Explicit
caller-supplied parser budgets remain available. Preserve malformed-data, finite/index/manifold,
archive traversal, URI/entity/reference/cycle, digest and source-identity checks.
The same policy applies to ordinary document-source materialization, frozen library byte closures,
assembly source and occurrence buffers, assembly export files, prepared print meshes and rectangular
build-volume analysis. Disposable cache eviction budgets and catalogue/selection cardinality remain
separate from geometry admission. Optional experimental support generation retains its documented
unsupported-case warnings and coverage limitations.

Generated MCP candidates use the existing reviewed prepared-import authority directly rather than
uploading their own bytes through the public chunk endpoint. Public network upload/chunk budgets,
pairing/rate admission, metadata/catalog bounds, manual review leases, storage quota failures and
actual JavaScript/WASM or file-format representation constraints remain distinct contracts.
Store retained source archive entries uncompressed so valid repetitive geometry remains readable
under the existing compression-ratio safety policy; metadata retains its normal compression.
This increases backup bytes relative to compressed sources. No new trusted file format, native
service, persisted schema or parallel commit authority is added.

## Alternatives and consequences

Raising each prototype constant leaves the same valid-model failure at the next threshold. Silent
coarsening changes the requested numerical problem and can erase protected geometry. Neither
satisfies the requested resolution. A native numerical service could extend practical capacity,
but requires a separate installation/process boundary and is outside this decision.

Work and memory scale with the actual problem, and browser allocation failure remains possible.
The removal of admission ceilings does not promise infinite capacity or make an infeasible source
pass its physical study. Valid results must survive ordinary serialization, inspection, Apply,
rebuild and backup. Existing source revisions, manual review, Undo and atomicity are unchanged.

Regression coverage crosses the previous thresholds in actual pinned WASM, checks an analytical
larger beam, preserves physical failures/cancellation, and exercises large output through existing
local import/persistence boundaries. See [the product contract](../product/lightweighting.md) and
[testing strategy](../testing-strategy.md).
