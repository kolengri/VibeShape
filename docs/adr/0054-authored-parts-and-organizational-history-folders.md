# ADR-0054: Authored parts and organizational History folders

- Status: Accepted architecture; domain contract increment, product integration pending
- Date: 2026-10-03
- Extends: [ADR-0026](0026-document-dependency-graph-and-interleaved-history.md),
  [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md)

## Context

A terminal feature output is a geometry handle, not a durable user part identity. Adding a modifier
changes its producing feature. Independently editable parts need stable names, visibility and IDs
across modification, removal, Undo, native backup and external automation. History folders organize
existing dependency order; treating them as model features would introduce false geometry dependencies.

## Decision

The domain package owns an explicit document snapshot version 2, with authored `parts` and `folders`
alongside the unchanged version 1 model and canonical History contract. Version 0 and version 1 schemas,
events, reducers and migration semantics remain unchanged. New authority APIs explicitly dispatch V1
and V2. Unknown future versions fail closed. The V2-to-V1 projection is compatibility data for existing
model consumers and must never overwrite V2 authority.

A part has a separately authored UUIDv7 `PartId`, normalized name, visibility preference, an ordered
body-binding history, explicit `independent` or `fork` origin, and an optional consuming feature. Each binding is the existing semantic
`BodyReference`. Every binding belongs to one part, follows canonical feature order, and corresponds
to a trusted producer or the exact target of its next modifier. This retains the same part identity
when a modifier is removed. Consumed tool parts retain their IDs and metadata so removing the consumer
can restore them. Visibility and consumption are authored intent, not proof that a native result currently exists.
Effective visibility must also inspect the current revision's successful geometry, so a suppressed
or failed consumer cannot hide an otherwise available source body.
Selection and hover remain transient editor state.

The initial policy recognizes existing exact first-party type versions: Box, Cylinder, single-profile
new Extrude/Revolve, target-modifying Extrude/Revolve, Hole, Fillet, Chamfer and Boolean/Subtract.
An authored `result` binding resolves only an exact single-solid result; missing, failed or multi-solid
results never resolve by native enumeration or by substituting another role. Unknown producers and
legacy multi-profile aggregates remain unmanaged in this increment. A future producer with explicit
constituent roles extends the trusted policy before it can allocate parts. Retargeting a modifier
restores the old root's binding and advances the new root while preserving both PartIds. Changing New
to a modifier on a current target retires its former root part in the same event; changing a non-root
modifier to New requires one fresh captured allocation for that existing producer. An existing root
retains its ID when its operation remains independently owned. Undo restores prior identities.
Ordinary dimensional edits preserve feature and part IDs.

A modifier targeting a historical body that another feature already modified or consumed creates an
explicit fork root at its own semantic `result`. The host captures a fresh PartId and `fork` origin;
replay never chooses a native constituent. Existing fork roots remain independent when upstream
suppression or retargeting exposes their former source. An active fork consumes that exposed source
only if it is still the source part's current body; it does not consume a different later modifier.
Suppressed modifiers skip binding advancement and consumption. Suppressed independent/fork roots keep
their IDs, and known suppressed feature dependencies prevent downstream advancement. Unsuppressing an
earlier modifier may make a later modifier a new fork, which requires a captured allocation in that
same command. `requiredPartAllocations` derives these needs for both upgrade and command preparation.

A model command is wrapped by a V2 command carrying captured part allocations. Preparation allocates
IDs and names once; reducers never consult clocks, randomness, geometry or renderer state. One model
command produces one V2 event, one revision and one Undo boundary. The event embeds the unchanged
validated model event and its captured part effects. Both envelopes must match document, command,
transaction, actor, timestamp and revision. Replay recomputes effects from trusted feature semantics
and rejects omitted, surplus or redirected effects. Part metadata and folder changes use typed,
revisioned metadata commands with the same provenance envelope.

Folders have separate UUIDv7 IDs and normalized names. They contain a nonempty, contiguous ordered
slice of canonical History, cannot overlap, and cannot nest. Folder edits never reorder History or
change dependencies. Moving a History item that would split a folder is rejected; callers can edit
membership or ungroup first. Removing a folder ungroups its members. Model deletion prunes folder
membership and removes an empty folder atomically with that model event. Collapse state is transient.

Bounds are 4,096 parts, 100,000 total body bindings, 1,024 folders and 100,256 total folder members.
Existing model bounds also apply. Names remain bounded at 120 characters. Journal replay and complete
copy enforce aggregate event limits and unique command identities.

### Migration and persistence handoff

V1 adoption is an explicit upgrade event at revision N+1. Captured allocations derive the initial
part collection in canonical History order; the V1 snapshot at N and its journal bytes remain intact.
Replaying the event is deterministic. Applying it to an already upgraded document fails closed;
the persistence caller implements idempotent retry through the existing command ID and head check.

No new IndexedDB store or database version is required by this contract. Existing native snapshot,
event and project stores have compatible document/revision indexes. Integration must use an explicit
V1/V2 stored-snapshot and project-head union and commit upgrade event, V2 snapshot, head and recovery
state in the existing lease-checked transaction. An old runtime must reject a V2 project head before
recovery can select an older snapshot. Unsupported versions must not enter corruption fallback.
These storage and old-runtime acceptance checks remain integration work.

V2 compensating restore events restore the complete V2 model, parts and folders. Upgrade establishes
the first V2 Undo baseline; a V2 restore never downgrades to a V1 target. Mixed replay retains only
historical target revisions referenced by the suffix. A checkpoint replay does not establish complete
history by itself.

Complete-history copy accepts either a native mixed journal from document creation or the existing
complete legacy prefix and replay-verified V1 migration seed followed by a mixed suffix. It remaps
document, command and transaction IDs, including both envelopes of nested model events, and preserves
local feature, part and folder IDs plus original actor provenance. A final revisioned rename records
the actor creating the copy. Seed-only recovery cannot be presented as a complete copy.

Native archive integration requires a new archive version because archive version 2 already denotes
the full-history V1 format. The existing seed, legacy-prefix and versioned-suffix layout can carry the
explicit upgrade without rewriting old events. Checksums, replay equality and aggregate resource
limits apply across all segments.

### Same-store persistence and portable archive V3

The database remains at version 3. Existing `projectsV1`, `snapshotsV1`, `eventsV1` and `recoveryV1`
indexes do not change. Strict V2 record variants share those stores; a V2 project head records the
first `upgradeRevision`. The old V1 repository methods retain their strict V1 parsers and refuse a
V2 head before publishing anything. Legacy writers already refuse any versioned head. Unknown
authority versions stop recovery and lease acquisition, rather than falling back to an older
snapshot. Catalog and shared lease acquisition explicitly dispatch supported head versions.

Authority commits validate mixed replay against the canonical supplied result, verify the persisted
base, then recheck revision and writer lease in the transaction that adds events, snapshot, project
head and recovery marker. Upgrade is the same atomic path as later metadata or model changes.
Recovery may replay a V1 prefix through its explicit upgrade but never report a V1 writable result
under a V2 head. Historical restore targets can be rebuilt from the retained mixed journal, including
after portable import that retains only the seed and final snapshots.

Archive format 3 requires reader version 3 and uses the existing five-entry archive layout. Its
manifest records both promotion and upgrade boundaries. Full replay must reproduce the authored
snapshot; complete legacy prefixes must also reproduce their original V1 migration seed. Per-entry
SHA-256, canonical UTF-8, bounded ZIP expansion and the aggregate 100,000-event budget apply.
`readAuthoredVShape` dispatches formats 0–3; existing readers and writers for 0–2 remain unchanged.
An evidenced checkpoint can be preserved as an archive, but cannot be imported or copied into
writable authority. Copy preserves local part/folder identities and remaps document/command/
transaction identities through the existing domain copy contract.

### Remaining complete product slice

Application authority, persistence, native archives, the part and History tree, typed MCP CRUD/list,
and revision-bound export must adopt these contracts. AI editing continues to update the same human
feature IDs through ordinary preview, revision and consent policy, with its MCP actor recorded in the
normal event journal.

Placement must be a trusted exact transform feature advancing the same part binding. Rendering,
picking, downstream modeling and export must share that geometry authority; a second display-only
placement is insufficient. Per-part STL and positioned multipart 3MF/STEP must resolve these exact
bodies. Compound must retain constituent solids and identities; Union must explicitly consume its
sources and produce the declared result. Their feature semantics, native ownership and role policies
require the next bounded implementation increments. The domain increment is not completion of the
multipart product task.

## Validation

Focused domain tests cover explicit upgrade, frozen V1 validation, deterministic replay, captured
allocation rejection, one-command atomicity, source identity and actor preservation, modifier rewind,
consumed-tool restoration, malicious effects, mismatched nested provenance, folder invariants,
compensating restore and native/legacy-promoted history copies. Storage interruption, old-runtime
refusal, real geometry, export interchange and browser workflows remain integration gates.
