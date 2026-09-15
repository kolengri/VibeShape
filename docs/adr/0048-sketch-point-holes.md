# ADR-0048: Sketch-point Hole Features

- Status: Accepted; first Hole delivery gates passed
- Date: 2026-09-07
- Related: [ADR-0003](0003-parametric-dag-and-toporef.md),
  [ADR-0040](0040-selected-edge-treatments.md),
  [ADR-0043](0043-local-stdio-mcp-browser-session.md)

## Decision

Extend the existing first-party Part Design owner with
`org.vibeshape.feature.part-design.hole`, feature schema version 1. A Hole cuts one explicitly
selected single-solid feature output at one or more solved sketch points. It is an ordinary feature
with the existing preview, command, dependency, persistence, undo and export authorities; no package,
extension runtime, direct store mutation or alternative MCP geometry path is introduced.

Authored parameters are `sketchId`, 1–256 distinct `pointIds`, a positive length `diameter`,
`direction` (`forward` or `reverse`) and `extent`. Blind extent requires a positive length `depth`;
through-all forbids an authored depth. Lengths use existing expression and canonical millimetre
semantics and are bounded to 1,000,000 mm. Point IDs are canonicalized in ascending order. Stable
sketch entities, dimensions and constraints own center intent, rather than screen positions or
transient OCCT vertex indices.

Dependencies contain the explicit target first, then the sketch support feature if distinct. Only
the first dependency consumes a body. References retain the source sketch's ordinary support
reference, if any. The selected sketch is a semantic input; its external model references also
participate in scheduling. These declarations must agree with the source sketch, preserve History
ordering and cycle checks, and survive ordinary versioned event replay and native backup.

The document worker solves the sketch once per rebuild, validates solution identity/revision,
resolves its exact frame and looks up every selected point. Missing points, wrong entity kinds,
failed solving and missing/ambiguous support fail explicitly without substituting a nearby point.
A support face defines a coordinate frame, not a containment rule: a center may lie outside that
face if its directional cutter intersects the explicitly selected target.

Prepared content contains a validated right-handed frame, bounded finite solved centers, diameter,
extent, direction, optional blind depth and optional support input index (0 or 1). Authored IDs remain semantic
intent; derived content canonicalization must not introduce UUID-dependent geometry cache identity.
The existing generic geometry feature envelope carries this feature-version-specific payload, so
no outer protocol version changes solely for registering the new feature type.

The geometry worker constructs frame-aligned cylinders and applies deterministic cuts. Through-all
is directional from each sketch center: derive its finite length from the target bounds projected
along the signed frame normal, with a modeling-tolerance margin; do not use an arbitrary giant
cylinder. Blind depth is measured from the sketch plane. Every requested center must remove
material. No-op cuts, invalid geometry, removal of the complete target and multiple-solid outputs
fail without replacing the last good model. Multi-solid targets remain unavailable until durable
constituent-body identity is accepted. All cutters and intermediate native objects are released on
success and failure. Existing conservative topology/lineage handling remains authoritative; a lost
downstream reference requires explicit repair and must never silently retarget.

## Product and automation delivery gates

The UI must provide graphical and keyboard point selection, an explicit target, diameter/depth
expressions, direction and extent, exact preview, Apply/Cancel and edit. Selected point IDs remain
visible and repairable. Changing a sketch constraint or variable recomputes the feature. One Apply
creates one ordinary undo step; native reopen and STEP/STL/3MF export preserve the result.

Named MCP `create_hole` and `update_hole` tools use the same authored feature record and ordinary
draft handling. Clients obtain point IDs from inspected sketch entities. Browser-owned review,
exact draft validation, revision/lease checks and cancellation remain mandatory. Tool discovery
must not advertise a completed Hole capability before the full authoring path is usable.

Required evidence includes schema/expression failures, dependency and support mismatches, point
deletion and solver failures, UUID-independent content identity, replay/undo/native reopen, and
real OCCT volume/bounds/solid-count invariants. Geometry cases cover multiple centers, oblique and
reversed frames, blind and directional through-all, no-op/split/empty results and resource cleanup.
Browser and real-client cases must create, inspect, repair, preview, commit, edit, undo and export
the feature through their ordinary paths. The M0 workflow baseline remains required for shared
task/selection changes. Implementation evidence must be recorded before claiming this slice delivered.

## Implementation evidence: foundation only

Domain and document-worker tests cover stable intent, expressions, support/dependency consistency,
semantic input declarations, external-reference scheduling, missing or wrong-kind point entities,
solver identity/revision failures, finite distinct world centers, support input slots, and actual
UUID-independent feature content hashes. The geometry corpus lives in
[`hole-worker.spec.ts`](../../tests/e2e/hole-worker.spec.ts), using the ordinary production worker.
Its fixtures cover blind and directional through-all in both directions, multiple centers, an
oblique frame, a small positive volume reduction, direction-away/no-op, split and empty rejection,
source preservation, and document shape disposal. Validity, volume, solid count, and bounds are
checked independently of mesh or face ordering.

The final foundation corpus passed 1,825 unit tests in 225 files. After the analytical bounds
correction, one uninterrupted Chromium/Firefox/WebKit run passed all 18 cases across `hole-worker`,
`geometry-worker`, `edge-treatment-worker`, `finished-sketch-features`, and `model-measurements`.
Types, formatting/lint, the production build, and the changed-code audit passed; the audit retains
only the two pre-existing dependency-override warnings. Earlier failed runs exposed incorrect
fixture coordinates and the oversized analytical body bounds; neither failed run is counted as
passing evidence.

This evidence does not certify the product Hole workflow, broad topology stability, or native
allocator performance budgets. At this foundation stage, UI authoring/editing, named MCP tools, and end-to-end undo/native
reopen/export verification remained open.

## Authoring and automation implementation: 2026-09-07

The editor now routes create/edit Hole through the registered modeling command, shared task
lifecycle, exact debounced preview, and ordinary feature mutation. Centers can be toggled in the
model or selected with keyboard controls. Missing point IDs remain repairable; support references
and target-first dependencies are retained. Busy and preview gates prevent stale or duplicate
submission, failed saves unlock retry, and task-scoped monotonic pick requests cannot replay after
cleanup or a sketch change.

Document protocol 19 adds disposable solved-point display metadata, separately from the existing
render buffers. Only current successful solver evidence with complete authored-point coverage may
produce selectable IDs and world positions. No fallback coordinates, projected entity IDs, or
transient buffer ordering become authored Hole intent. This protocol change is for the new display
contract, not solely for registering the Hole feature type.

The local MCP server now advertises `create_hole` and `update_hole`. The real-client scenario creates
and repairs invalid point/direction intent, previews, reviews, commits, inspects the retained point
ID and expression, changes a sketch dimension, changes the diameter variable, exports, and undoes
each committed draft. A changed sketch dimension changes the exact content hash while preserving
the expected cut volume; a diameter-variable change produces the independently calculated volume.
Exports are read through MCP resource links, with exact STEP surface evidence, binary STL volume
within the mesh tolerance, and a single-body millimetre 3MF archive.

The full unit suite passes 1,846 tests in 228 files. One uninterrupted Chromium/Firefox/WebKit run
passes 39 cases covering Hole, native reopen in a clean browser, local MCP discovery and workflows,
selected-edge picking/treatments, export, measurements, and the production geometry worker.
Workspace types, formatting, lint, production build, and the changed-code audit pass. The audit
retains only the two known Bun dependency-override warnings; build-size warnings remain release work.
A further six-case cross-browser run verifies both compact themes, reduced motion, point picking,
and native reopen. The mandatory M0 regression baseline passes all 93 discovered cases in one
uninterrupted 8.2-minute Chromium/Firefox/WebKit run with no retries or concurrent test/build load.
The exact command is the [CAD workflow baseline gate](../testing-strategy.md#cad-workflow-baseline-gate).

Evidence is retained in `.artifacts/hole-ui-unit-final.log`, `.artifacts/hole-ui-browser-final.log`,
`.artifacts/hole-ui-compact-final.log`, and `.artifacts/hole-m0-browser-final.log`. The source/configuration
manifest `.artifacts/hole-ui-source-final.json` records 751 file hashes from the uncommitted working
tree over `83405e84b391f2b73117e0c70a1e65145f57931b`; all remain unchanged throughout the M0 run.
Earlier failed browser traces remain separate: one run used an outdated built MCP frontend, and
another test incorrectly expected inline export bytes instead of MCP resource links. Neither is
counted as passing evidence.

This first Hole contract has flat-bottom cylindrical blind cuts and directional through-all cuts.
Countersink, counterbore, threads, drill tips, multi-solid target selection, broad downstream topology
stability, and release performance budgets are separate work. Completing this slice does not close
the local CAD/MCP development plan.
