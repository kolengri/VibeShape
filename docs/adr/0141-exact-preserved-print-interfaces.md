# ADR-0141: Exact Preserved Interfaces in Print Optimization

- Status: Accepted
- Date: 2026-10-29
- Extends: [ADR-0140](0140-automatic-print-topology-optimization.md)
- Supersedes: ADR-0140's voxel-only output and approximate interface-preservation scope for the automatic editor workflow
- Related: [ADR-0002](0002-geometry-worker-boundary.md), [ADR-0134](0134-local-geometry-resource-policy.md)

## Decision

The automatic print task reconstructs a separate exact CAD solid before Apply. Selected original
faces, including holes and mating surfaces, must remain unchanged in the native kernel. A finer
voxel approximation is not evidence of exact preservation. Manual structural and paired MCP
workflows retain their existing voxel snapshot contract.

The numerical worker optionally returns its independently verified occupied lattice. This private
worker contract includes finite origin, spacing and unique safe integer cells, bound by the client
to the source, final cell count and the complete oriented voxel boundary. An optional lattice phase
aligns fixed-design reanalysis with the original cell planes, even when reconstructed bounds change.
Neither option is an advertised MCP setting.

A source-bound read-only request reaches the active geometry cache through document protocol 28.
It captures document, producer, output role and content hash, the print frame, selected disposable
native face hashes, retained cells, and automatically protected support/load boxes. An isolated
rebuild cannot resolve the existing native face hashes, so reconstruction uses the active cache
without restart recovery. Stale, missing or ambiguous face identities fail explicitly. Changes to
the display face catalog invalidate the editor's selections and pending result.

The kernel constructs the complement of the retained lattice over the source envelope. It protects
selected faces by exact distance, with a conservative spatial prefilter, rather than freezing their
entire bounding boxes. Remaining cells are streamed into coalesced cutting boxes and rigidly copied
into source coordinates. A non-destructive native batch cut retains the original analytical
surfaces; every selected face must still be `IsSame` in the result. A lost face, invalid or multiple
solids, or absence of actual material reduction rejects the candidate. Temporary native objects
are released on success and failure. Source geometry and authored history remain unchanged.

Support/load boxes select patches on the original source boundary. Reconstruction protects that
boundary within each selector, rather than freezing its complete interior volume: FEM clamps
exterior nodes and applies exterior tractions, so an internal cavity behind an unchanged interface
remains admissible. User-preserved faces retain their separate exact-distance skin and identity proof.

The result returns STEP bytes from that exact solid, double-precision verification geometry,
exact source/result volumes and the preserved-face proof count. The editor reanalyzes the actual
reconstructed geometry with fixed design, the original lattice phase, all compound loads and FDM
constraints. Every case must still meet the original source's stiffness and stress-retention gates;
self-comparison against the reconstructed baseline is insufficient. STEP is independently inspected
through the ordinary exact-import reader, with source identity, proof count and volume checks.
Only that inspected exact source becomes preview and the ordinary atomic import/Undo transaction.

Fixed-design verification carries the captured original print-frame boundary-reference mesh. The
numerical worker resolves original fixed-node and loaded-facet lattice keys against that mesh and
maps them onto the reconstructed lattice. Lost original interfaces reject verification; newly
exposed cavity surfaces never acquire additional clamps or tractions from the selector boxes.
This private reference is not an advertised MCP setting or an authored document feature.

Reports distinguish the voxel optimization proposal from exact CAD volumes and the fixed-body
verification. Actual material savings use exact CAD volume, not voxel count. Source/output placement
is unchanged; print preparation must reproduce the selected orientation. The numerical checks
remain conservative voxel approximations of the exact body and do not certify physical strength.

## Alternatives and consequences

Mesh snapping or retaining additional voxels cannot preserve analytical hole and mating surfaces.
Reconstructing every voxel as authored History features would add large dependency graphs and
unnecessary command authority. One disposable native operation and ordinary STEP capture reuse
existing kernel, import, persistence, preview and Undo owners.

Conservative face skins may prevent useful material removal; failure remains explicit. Native
Boolean cost scales with cutting topology and selected geometry. There are no fixed local cell,
cut-tool, face, triangle or STEP-byte admission ceilings; finite arithmetic, safe indices, valid
geometry, exact identity, actual resource failures and source-bound publication remain controlling.
This operation does not smooth all unprotected voxel boundaries or infer real service loads.

Ordinary exact-source capture, inspection and authored signatures follow the same geometry
admission policy: remove their inherited 32 MiB local source-byte and 500,000 topology-count
ceilings. Safe integer counts and byte lengths, digest/length association, native validity and
the existing output-catalog cardinality remain required. Network upload budgets remain separate.
