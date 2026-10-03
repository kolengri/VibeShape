# ADR-0069: Frozen assembly source authority

- Status: Accepted domain contract; staged product integration
- Date: 2026-10-03
- Extends: [ADR-0064](0066-grounded-assembly-definitions-and-kinematics.md),
  [ADR-0060](0062-durable-source-assets-and-portable-closure.md)

## Decision

Document V4 owns one typed `assembly` collection containing definitions, occurrences and joints.
Previously captured source-only V4 snapshots normalize a missing collection to the valid empty
version-1 assembly. Historical V2 schemas remain unchanged. Compatibility projection removes
assembly authority along with asset descriptors and cannot replace the persisted V4 snapshot.

Persisted definitions extend the pure assembly definition with `pinRevision` and ordered
`pinnedModels`. Every source has exactly one model tied to its `sources` array index and an explicit
`selectedBody` reference. Local Part pins retain their selected producer and output role. Direct
asset-output pins capture the exact or mesh import producer containing that output UUID, including
its full canonical signature or parser-node manifest. An asset without an imported producer must
be imported before it can become an assembly source. Equivalent producer manifests choose the
smallest stable feature UUID; conflicting manifests reject capture and require an explicit Part
selection. Native enumeration order never determines a selected output.
That model is a strict version-1 document snapshot containing only the selected producer and its
transitive feature/sketch dependency closure, in source-history order. Referenced quantity variables
and their transitive expression dependencies are frozen with it. Typed source descriptors required
by exact or mesh imported features are also retained. Original document metadata records provenance;
there is no unvalidated arbitrary record or cached native-shape blob.

Local Part capture requires that the current Part owns the selected body reference. The frozen producer must
declare that exact output role; each selected feature must be available, registered, valid and have
canonical semantic inputs. The dependency closure must be complete and contain no unrelated nodes.
Each model is bounded to 4096 history nodes and all pinned models together to 16,384 nodes. Existing
definition, occurrence, joint and source-binding budgets from ADR-0064 remain in force.

The Part ID, body reference and claimed content hash are immutable source declarations, rather than
a lookup of a live Part tip. Later feature, variable or Part removal does not mutate saved occurrence
geometry. The geometry boundary must rebuild the frozen model and verify its claimed content hash
before using native or cached output. Domain validation proves typed semantic intent and identity,
not a cryptographic relationship between that intent and a particular kernel result.

Asset-output sources require the original asset ID, digest and captured output ID. Imported source
descriptors inside every frozen model must match document asset authority exactly. Triangle meshes
remain typed mesh sources; their presence does not imply an exact BREP or exact interference support.

## Commands, replay and removal

`org.vibeshape.document.assembly-command` accepts a bounded atomic list of definition, occurrence
and joint mutations. Its `assembly-changed` event captures frozen definitions and stable UUIDs.
Definition creation starts pin revision 1. A metadata update may change only name and source frame;
it cannot reorder sources or replace pins. Explicit `definition.relink` captures new source intent
and advances the pin revision by exactly one while retaining definition and occurrence identities.

The complete final collection is validated before publication, so a new ungrounded child and its
joint can be authored in one transaction. Directed forests, grounded roots, unique identities,
typed poses, exact inclusive joint limits and composed world bounds use the existing pure solver.
Invalid commands, stale revisions and semantic no-ops publish no partial collection. Drives are
never clamped. Removing a joint requires grounding or removing its child in the same atomic list.

Occurrence removal also removes incident joints. Removing an occurrence with children or a used
definition requires explicit cascade; cascade removes the full dependent occurrence subtree and
its incident joints, including descendants using other definitions. Surviving definitions remain
available for reuse. Ordinary authored Parts are not multiplied by assembly occurrences.

Replay recaptures each create or relink from the then-current semantic authority and rejects forged
feature/sketch/variable/source closure. Copying a project preserves frozen source provenance;
replay compares actual geometry intent rather than requiring original document IDs or timestamps
to equal the copied project's metadata. Definitions, pin revisions, occurrences and joints are
restored with the whole V4 snapshot through Undo and Redo. Historical imported descriptors inside
assembly events join the existing immutable source closure, including after definition removal.
Portable backup must retain their verified bytes even when the final assembly is empty.

## Verification boundary

Domain fixtures cover prior V4 normalization, narrow closures, transitive variables, independent
occurrence identity, live Part edits/removal, explicit relink, strict source roles and asset pins,
forged replay, exact joint limits, cycles, cascade cleanup, stale atomic rejection, mixed replay,
Undo/Redo and complete copied history. Existing assembly math fixtures remain authoritative for
frame convention and deterministic kinematics.

Rendered occurrences, worker content-hash verification, native interference, browser publication,
restart and UI workflows are separate integration gates. The domain leaf does not claim those
behaviors or physical fit from pure schema and replay tests.
