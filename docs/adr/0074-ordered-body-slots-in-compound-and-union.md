# ADR-0074: Ordered exact body slots in Compound and Union

- Status: Accepted
- Date: 2026-10-03
- Supersedes for feature schema version 2: [ADR-0057](0057-trusted-body-compound-and-union.md)
- Extends: [ADR-0049](0049-constituent-body-identity-and-solid-patterns.md)

## Decision

Compound and Union schema version 2 select two through eight distinct exact `BodyReference` values.
Several selections may name different output roles of one producer, including Pattern, Split, or
Imported. Uniqueness is the pair `(featureId, outputRole)`. Graph dependencies contain each producer
once, in first-occurrence order. Selected body slots retain their independent authored order.

Schema version 1 retains its distinct-producer restriction. Reading or reopening an archive does
not migrate its features. A new feature uses version 2; an explicit edit Apply may replace an existing
feature record with version 2 through the ordinary `updateFeature` command. Compound slot UUIDs and
output roles remain stable across that update. No separate document mutation or migration path is
introduced.

## Canonical content version 2

The canonical `feature.inputs` array contains the ordered unique producer content hashes. Its
`feature.inputSlots` array contains the ordered selected bodies, each with:

- `inputIndex`: the index of its producer in `feature.inputs`;
- `contentHash`: that producer's exact content hash;
- `outputRole`: the selected semantic body output role.

Each slot hash must equal `inputs[inputIndex]`; each declared producer must contribute a slot, and
an `(inputIndex, outputRole)` pair must appear only once. There are one through eight graph inputs
and two through eight body slots. Producer-level evaluation dependencies carry no `outputRole` in
this version. Domain and protocol schemas independently validate this contract.

Feature, document, and producer UUIDs do not enter canonical input identity. Compound's existing
stable authored output roles still contain its slot UUIDs, as specified in ADR-0057. Union has no
numeric parameters. Changing selected role order or source hashes changes content identity.
Canonical content versions 0 and 1 and their archived payloads remain supported unchanged.

Application rebuild preparation preserves unique producer hashes without collapsing body roles
into a producer-keyed map. The exact shape registry resolves each slot by document, producer ID,
validated hash, and output role before checking the combination's B-Rep cache. Missing roles or stale
producer revisions reject the request even when that combination previously produced a cached result.
Triangle-mesh sources have no exact native output in this registry and remain ineligible.

## Ownership and failure

Compound copies every selected exact single solid into its own authored output role, preserving
selection order and separate solids. Union copies its inputs and requires one valid positive-volume
result; disjoint inputs reject the native operation. Existing native helpers and their failure-safe
cleanup remain authoritative. No cached producer shape is transformed, deleted, or transferred to
the result owner.

Part ownership resolves each exact input independently. Compound advances each input's PartId to
its authored output slot. Union retains the first selected PartId and consumes the remaining
selected parts. Unselected Pattern or imported bodies retain their bindings. Existing suppression,
historical fork, replay, and source-repair policies apply.

Trusted authoring schemas and registries reject duplicate or malformed selections before Apply.
The existing low-level document command contract may preserve invalid registered parameters as
failed authored intent. Such intent does not advance or consume any source PartId; rebuild rejects
it before a native call or successful cached geometry result. This decision preserves archive and
repair behavior rather than adding a new document-command rejection boundary.

## Verification boundary

Tests cover versioned schemas, unique producer dependencies, ordered roles and hashes, UUID-free
source identity, explicit update migration, replay and suppression, unchanged ownership for invalid
or unavailable roles, and rebuild rejection before geometry evaluation. Real pinned OCCT tests
combine two Pattern instances, restore Split sides with Union, select two bodies from a multi-body
STEP import, preserve interleaved inputs from multiple producers, reject disjoint Union, validate
roles and revisions before cache hits, export ordinary STEP/STL, preserve source geometry, and
release all native wrappers on document disposal.

UI and MCP create/edit/preview/Apply/Cancel, browser persistence and undo, and independent integrated
review remain primary integration gates. Native geometry tests do not establish physical fit or print
behavior.
