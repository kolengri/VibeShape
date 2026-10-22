# ADR-0127: Exact planar Press Pull

- Status: Accepted with planar-face scope
- Date: 2026-10-22
- Extends: [ADR-0003](0003-parametric-dag-and-toporef.md) and
  [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md)

## Decision

Register Press Pull schema version 1 in the existing first-party Part Design module. Persist one
named `targetBody`, a stable `BodyFaceRef`, its `sourceContentHash`, and a signed length quantity.
Its sole dependency is the producing feature of the exact target body; generic topology references
remain empty. Canonical content removes document-local UUIDs and retains the exact output role,
face signature, source hash, and resolved signed distance. No existing feature is migrated.

The initial implementation sweeps the complete selected trimmed planar face, including inner wires,
along its oriented outward normal. Positive distances fuse this exact prism with the target;
negative distances subtract it. OCCT prism and Boolean builders already exported by the installed
WASM runtime provide this operation. Geometry remains in the ordinary worker evaluation path.
No native bindings or alternate mesh geometry path are introduced.

This operation does not offset neighboring surfaces, extend their analytic supports, or propagate
across tangent faces. A planar cap adjacent to a cylinder is supported, but selecting the curved
wall is rejected. The result must change volume in the requested direction and retain exactly one
valid positive-volume solid. A collapsing, splitting, invalid, or ineffective operation fails.
Distance magnitude is bounded to 0.001 through 100000 mm, with existing workspace bounds also
applied to the result.

## Topology and ownership

The current viewer pick is resolved through revision-bound exact body topology evidence before
opening the tool. Mesh face IDs and native enumeration positions are transient lookup data and
never enter persisted parameters. The worker checks the source content hash and body role before
resolving the persisted face against that exact body. Missing or ambiguous references fail; source
changes require explicit reselection instead of silent geometric rebinding.

Kernel operations use a deep copy of the borrowed target and a mapped selected face. All native
builders, vectors, copy handles, and temporary prisms are disposed on success and failure. The
result transfers into normal worker shape ownership. Source and result validity and solid count
are checked, and failed results are disposed.

## Interaction and availability

Create and edit use the existing parameter task panel, disposable exact preview, revision-checked
feature add/update commands, and committed Undo/Redo. Apply waits for a ready preview; Cancel and
unmount clear the draft preview. Editing changes the same feature record and references the same
upstream named body.

The local editor exposes this operation. A registered feature is not automatically an MCP tool:
no new named MCP authoring surface is introduced by this decision.

## Evidence

Native kernel tests cover signed top/bottom face direction, exact volume, through-hole retention,
planar caps next to curved walls, foreign/curved face rejection, collapse, invalid distances, and
unchanged borrowed source bodies. Production-engine tests cover exact body-role output, stale
hashes, missing/ambiguous topology, and document disposal. Domain/protocol tests cover registration,
quantities, ownership, stable references and content. Form tests cover draft previews, one Apply
mutation, Cancel cleanup, pending/stale blocking, and retained identity during edits. Committed
session tests cover creation and parameter-update Undo/Redo independently of native geometry.
