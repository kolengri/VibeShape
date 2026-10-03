# ADR-0067: Captured exact source imports

- Status: Accepted leaf architecture; product integration is separately verified
- Date: 2026-10-03
- Extends: [ADR-0060](0062-durable-source-assets-and-portable-closure.md),
  [ADR-0054](0054-authored-parts-and-organizational-history-folders.md)

## Decision

The first-party `org.vibeshape.feature.part-design.imported` feature is an independent exact
source producer. Its parameters bind a persisted source asset UUID to immutable digest, byte
length, format, normalization, reader policy and an ordered manifest of captured output UUIDs
with geometric signatures. Every output receives its own ordinary authored Part rooted at
`import.<output UUID>`. The feature has no fictitious target, feature dependency or parallel body
ownership collection. The source asset record UUID is excluded from canonical worker content;
the digest, policies, normalization, output UUIDs and signatures are included. Source bytes travel
as separately bounded materialization inputs and never inflate semantic content or snapshots.

Document V4 validates that each imported feature matches an existing exact-solid descriptor and
declares all of its outputs in their original order. The historical V2 projection still accepts
the structural authored feature record. Product writers must explicitly upgrade authority before
publishing imports; a compatibility projection cannot become persisted source authority.

Initial inspection reads the source, validates each closed positive-volume solid and captures its
signature before the command assigns output UUIDs. Rebuild matches the recorded signatures
one-to-one. There is no OCCT enumeration-index fallback. Signatures contain volume, area, centroid,
finite bounding box, face count and edge-incidence count; these are reader-policy metrics, never
persistent face or edge IDs. Coincident solids and any other signature collision are rejected with
an actionable ambiguity diagnostic. This conservative policy can reject distinguishable solids
whose signatures collide; it cannot silently choose one of them.

Matching policy 1 uses absolute tolerance `1e-9` and relative tolerance `1e-7` for volume/area;
coordinate matching uses absolute tolerance `1e-6` mm and relative tolerance `1e-10`. Counts must
match exactly. These modest tolerances accommodate repeat reads of the same immutable source;
they are not permission to match an edited file. The byte digest and descriptor are verified before
native parsing and missing, repeated or mismatched outputs reject the whole import.

## Native reader and units

The implementation uses the repository's pinned Replicad OCCT bindings, including
`STEPControl_Reader_1`, `BRepToolsWrapper.Read`, native exact transforms, `BRepCheck_Analyzer`,
closed-shell checks and `BRepGProp`. STEP bytes use a temporary file only inside the WASM virtual
filesystem, removed on both success and failure. No source URL or host filesystem path is accepted.
Malformed files, loose curves/faces/shells, open or invalid solids, nonpositive metrics and geometry
outside +/-100,000 mm fail without a partial output set. The per-source limit is 32 MiB and 128
solids; native topology traversals have a 500,000-entity budget.

STEP reader policy 1 calls `SetSystemLengthUnit(1)` after reading the model and before transferring
roots, so declared STEP units are converted by OCCT into millimeters. The recorded original unit
factor is provenance and is never applied a second time. BREP reader policy 1 applies the recorded
source-to-millimeter scale exactly once through a native copied transform. There is no implicit
post-reader user scaling in this version. The native transform also avoids Replicad's consuming
shape-scale operation.

The current [OCCT reader documentation](https://occt3d.com/dev/doc/refman/html/class_s_t_e_p_control___reader.html)
describes the model-dependent system-unit setting and unit-query API. Actual overloads and available
exports come from the installed pinned bindings and native tests. Although `FileUnits` is declared,
the required sequence constructor is unavailable in those WASM exports. Import therefore requires
explicit source-unit metadata and reports `unitEvidence: "explicit-source-metadata"`; it does not
claim to have measured that metadata from the file. Native fixtures verify both a millimeter STEP
and a STEP containing an actual declared inch conversion unit, with unchanged millimeter geometry.

Owned temporary wrappers and candidates have explicit cleanup scopes. Each candidate is transferred
only after source-root cleanup succeeds. Matching failure releases every acquired candidate once;
cleanup continues if a candidate destructor fails. Results cannot escape after reader, transform or
virtual-file cleanup failure. Returned shapes are owned by the caller and must be released after
preview, export or failed integration.

## Verification boundary

Domain and protocol tests cover strict metadata and version parsing, canonical content, complete V4
asset binding, independent Part allocations, mixed journal replay, Undo/Redo, copied wire buffers,
duplicate identities, conflicting digest materializations and byte budgets. Native fixtures cover
STEP/BREP, declared inch conversion, one-time BREP normalization, reordered manifest matching,
malformed and mismatched sources, coincident ambiguity, loose/open geometry, world/solid limits,
virtual-file cleanup and repeated failure followed by successful rebuild.

This leaf does not reconstruct STL/3MF meshes as exact BREP, author SVG/DXF sketches, infer assembly
joints or implement a library workflow. Browser commands, atomic source publication, restart,
rebuild, preview and native export remain integration acceptance owned by their existing adapters.
The source reader has no physical manufacturing or independent external interchange claim.
